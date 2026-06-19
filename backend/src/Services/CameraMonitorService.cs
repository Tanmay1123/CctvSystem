using System.Net;
using System.Net.Mail;
using System.Net.Sockets;
using System.Text.Json;
using AI_CCTV_API.Data;
using AI_CCTV_API.Hubs;
using AI_CCTV_API.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace AI_CCTV_API.Services
{
    /// <summary>
    /// Periodically probes each camera's stream URL. When a camera transitions
    /// online -> offline it updates the DB status, records a "Camera Offline"
    /// alert, pushes a SignalR update, and emails the configured recipients.
    /// A per-camera cooldown prevents flapping cameras from spamming emails.
    /// </summary>
    public class CameraMonitorService : BackgroundService
    {
        private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);
        private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(12);
        private static readonly TimeSpan EmailCooldown = TimeSpan.FromMinutes(5);

        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(6) };
        private readonly Dictionary<int, DateTime> _lastEmailAt = new();

        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IConfiguration _config;
        private readonly IHubContext<AlertHub> _hub;

        public CameraMonitorService(
            IServiceScopeFactory scopeFactory,
            IConfiguration config,
            IHubContext<AlertHub> hub)
        {
            _scopeFactory = scopeFactory;
            _config = config;
            _hub = hub;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try { await Task.Delay(StartupDelay, stoppingToken); }
            catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await CheckCamerasAsync(stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    Console.WriteLine("Camera monitor failed: " + ex.Message);
                }

                try { await Task.Delay(Interval, stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }

        private async Task CheckCamerasAsync(CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var cameras = await db.Cameras.ToListAsync(ct);

            foreach (var cam in cameras)
            {
                // Can only health-check cameras that expose a stream URL.
                if (string.IsNullOrWhiteSpace(cam.StreamUrl))
                    continue;

                // Prefer the real camera-liveness signal from the Flask /health
                // endpoint (knows when the camera feed itself is disconnected,
                // even though the stream server keeps running). If that endpoint
                // isn't available, fall back to plain stream reachability.
                var healthUrl = DeriveHealthUrl(cam.StreamUrl);
                bool? healthy = healthUrl != null ? await CheckHealthAsync(healthUrl, ct) : null;
                bool online = healthy ?? await IsReachableAsync(cam.StreamUrl, ct);
                string newStatus = online ? "online" : "offline";

                if (newStatus == cam.Status)
                    continue;

                bool wentOffline = newStatus == "offline";
                cam.Status = newStatus;
                await db.SaveChangesAsync(ct);

                await _hub.Clients.All.SendAsync(
                    "CameraStatusChanged",
                    new { cam.CameraId, cam.Name, cam.Status },
                    ct);

                if (wentOffline)
                    await HandleOfflineAsync(db, cam, ct);
                else
                    Console.WriteLine($"✅ Camera back online: {cam.Name}");
            }
        }

        private async Task HandleOfflineAsync(AppDbContext db, Camera cam, CancellationToken ct)
        {
            Console.WriteLine($"⚠️ Camera offline: {cam.Name}");

            // Record an alert so it shows on the dashboard / alerts / bell.
            var alert = new Alert
            {
                AlertType = "Camera Offline",
                CameraName = cam.Name,
                AlertTime = DateTime.Now,
                ScreenshotPath = "",
                Status = "Open",
                CreatedDate = DateTime.Now
            };
            db.Alerts.Add(alert);
            await db.SaveChangesAsync(ct);
            await _hub.Clients.All.SendAsync("NewAlert", alert, ct);

            // Email (throttled per camera).
            var now = DateTime.Now;
            if (_lastEmailAt.TryGetValue(cam.CameraId, out var last) && now - last < EmailCooldown)
                return;
            _lastEmailAt[cam.CameraId] = now;

            SendOfflineEmail(cam);
        }

        // The Flask stream server exposes /health next to /video.
        private static string? DeriveHealthUrl(string streamUrl)
        {
            const string suffix = "/video";
            if (streamUrl.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
                return streamUrl[..^suffix.Length] + "/health";
            return null;
        }

        // Returns true/false from the /health camera status, or null if the
        // endpoint is unavailable/unparseable (so the caller can fall back).
        private static async Task<bool?> CheckHealthAsync(string healthUrl, CancellationToken ct)
        {
            try
            {
                using var resp = await Http.GetAsync(healthUrl, ct);
                if (!resp.IsSuccessStatusCode) return null; // e.g. 404 on old server
                var body = await resp.Content.ReadAsStringAsync(ct);
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("camera", out var cam))
                    return string.Equals(cam.GetString(), "online", StringComparison.OrdinalIgnoreCase);
                return null;
            }
            catch
            {
                // Stream server itself is unreachable -> definitely offline.
                return false;
            }
        }

        private static async Task<bool> IsReachableAsync(string url, CancellationToken ct)
        {
            // RTSP/RTMP can't be probed over HttpClient (it throws). Instead check
            // that the camera's TCP port is open — a reliable liveness signal that
            // doesn't depend on the Python relay being up.
            if (Uri.TryCreate(url, UriKind.Absolute, out var uri)
                && (uri.Scheme is "rtsp" or "rtmp"))
            {
                int port = uri.Port > 0 ? uri.Port : (uri.Scheme == "rtsp" ? 554 : 1935);
                return await IsTcpOpenAsync(uri.Host, port, ct);
            }

            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                // Only read headers — for an MJPEG stream the body never ends.
                using var resp = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
                return resp.IsSuccessStatusCode;
            }
            catch
            {
                return false;
            }
        }

        // True if a TCP connection to host:port succeeds within a short timeout.
        private static async Task<bool> IsTcpOpenAsync(string host, int port, CancellationToken ct)
        {
            try
            {
                using var client = new TcpClient();
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                await client.ConnectAsync(host, port, timeout.Token);
                return client.Connected;
            }
            catch
            {
                return false;
            }
        }

        private void SendOfflineEmail(Camera cam)
        {
            try
            {
                var mail = _config["EmailSettings:Mail"];
                var password = _config["EmailSettings:Password"];
                var host = _config["EmailSettings:Host"];
                var port = Convert.ToInt32(_config["EmailSettings:Port"]);
                var to = _config["EmailSettings:To"];

                if (string.IsNullOrWhiteSpace(mail) || string.IsNullOrWhiteSpace(to))
                {
                    Console.WriteLine("Offline email skipped — EmailSettings not configured.");
                    return;
                }

                var message = new MailMessage { From = new MailAddress(mail, "AI CCTV") };
                foreach (var addr in to.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    message.To.Add(addr);

                message.Subject = $"⚠️ Camera Offline — {cam.Name}";
                message.IsBodyHtml = true;
                message.Body = $@"
<div style=""background:#f3f5f9;padding:24px;font-family:'Segoe UI',Arial,sans-serif;"">
  <div style=""max-width:460px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(31,36,48,.10);"">
    <div style=""background:#f0455f;padding:20px 24px;color:#ffffff;"">
      <div style=""font-size:12px;letter-spacing:.08em;opacity:.85;"">AI CCTV SECURITY</div>
      <div style=""font-size:22px;font-weight:bold;margin-top:3px;"">&#9888; Camera Offline</div>
    </div>
    <div style=""padding:22px 24px;font-size:14px;color:#1f2430;"">
      <p style=""margin:0 0 14px;"">A camera has gone offline / disconnected:</p>
      <table style=""width:100%;border-collapse:collapse;"">
        <tr><td style=""padding:8px 0;color:#8a93a6;"">Camera</td><td style=""padding:8px 0;text-align:right;font-weight:bold;"">{cam.Name}</td></tr>
        <tr><td style=""padding:8px 0;color:#8a93a6;border-top:1px solid #eef1f6;"">Location</td><td style=""padding:8px 0;text-align:right;font-weight:bold;border-top:1px solid #eef1f6;"">{cam.Location}</td></tr>
        <tr><td style=""padding:8px 0;color:#8a93a6;border-top:1px solid #eef1f6;"">IP</td><td style=""padding:8px 0;text-align:right;font-weight:bold;border-top:1px solid #eef1f6;"">{cam.IpAddress}</td></tr>
        <tr><td style=""padding:8px 0;color:#8a93a6;border-top:1px solid #eef1f6;"">Time</td><td style=""padding:8px 0;text-align:right;font-weight:bold;border-top:1px solid #eef1f6;"">{DateTime.Now:dd MMM yyyy, hh:mm tt}</td></tr>
      </table>
    </div>
    <div style=""padding:16px 24px;background:#fafbfe;color:#8a93a6;font-size:12px;text-align:center;border-top:1px solid #eef1f6;"">
      Automated alert from your AI CCTV system
    </div>
  </div>
</div>";

                using var smtp = new SmtpClient(host, port)
                {
                    Credentials = new NetworkCredential(mail, password),
                    EnableSsl = true
                };
                smtp.Send(message);

                Console.WriteLine($"\U0001F4E7 Offline email sent for {cam.Name}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("Offline email error: " + ex.Message);
            }
        }
    }
}
