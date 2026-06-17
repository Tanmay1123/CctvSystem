using AI_CCTV_API.Data;
using AI_CCTV_API.Hubs;
using AI_CCTV_API.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Net;
using System.Net.Mail;

namespace AI_CCTV_API.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class AlertsController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IHubContext<AlertHub> _hubContext;
        private readonly IConfiguration _configuration;
        private readonly IWebHostEnvironment _env;

        public AlertsController(
    AppDbContext context,
    IHubContext<AlertHub> hubContext,
    IConfiguration configuration,
    IWebHostEnvironment env)
        {
            _context = context;
            _hubContext = hubContext;
            _configuration = configuration;
            _env = env;
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<Alert>>> GetAlerts()
        {
            return await _context.Alerts
                .OrderByDescending(x => x.AlertId)
                .ToListAsync();
        }
        [HttpPut("{id}/close")]
        public async Task<IActionResult> CloseAlert(int id)
        {
            var alert = await _context.Alerts.FindAsync(id);

            if (alert == null)
            {
                return NotFound();
            }

            alert.Status = "Closed";

            await _context.SaveChangesAsync();
            await _hubContext.Clients.All.SendAsync("AlertUpdated", alert);

            return Ok(alert);
        }
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteAlert(int id)
        {
            var alert = await _context.Alerts.FindAsync(id);

            if (alert == null)
            {
                return NotFound();
            }

            DeleteMediaFor(alert.ScreenshotPath);

            _context.Alerts.Remove(alert);
            await _context.SaveChangesAsync();
            await _hubContext.Clients.All.SendAsync("AlertDeleted", id);

            return Ok(new { deleted = id });
        }
        [HttpDelete]
        public async Task<IActionResult> DeleteAllAlerts()
        {
            var all = await _context.Alerts.ToListAsync();

            foreach (var a in all)
            {
                DeleteMediaFor(a.ScreenshotPath);
            }

            _context.Alerts.RemoveRange(all);
            await _context.SaveChangesAsync();
            await _hubContext.Clients.All.SendAsync("AlertsCleared");

            return Ok(new { deleted = all.Count });
        }
        private void DeleteMediaFor(string? screenshotPath)
        {
            if (string.IsNullOrWhiteSpace(screenshotPath))
                return;

            try
            {
                var alertsDir = Path.Combine(
                    _env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"),
                    "alerts");

                var fileName = Path.GetFileName(screenshotPath);
                var stem = Path.GetFileNameWithoutExtension(fileName);

                // Remove the alert's clip + its matching .jpg poster (same base name).
                foreach (var name in new[] { fileName, stem + ".jpg", stem + ".mp4" })
                {
                    var path = Path.Combine(alertsDir, name);
                    if (System.IO.File.Exists(path))
                        System.IO.File.Delete(path);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Delete media error: " + ex.Message);
            }
        }
        [HttpPost]
        public async Task<IActionResult> CreateAlert(Alert alert)
        {
            alert.CreatedDate = DateTime.Now;

            _context.Alerts.Add(alert);

            await _context.SaveChangesAsync();

            // Send email alert
            SendEmailAlert(alert);

            // Send SignalR notification
            await _hubContext.Clients.All.SendAsync("NewAlert", alert);

            return Ok(alert);
        }
        [HttpGet("~/alerts/{fileName}")]
        public IActionResult GetAlertImage(string fileName)
        {
            var rootPath = Path.Combine(
                AppContext.BaseDirectory,
                "..",
                "..",
                "..",
                "wwwroot",
                "alerts"
            );

            rootPath = Path.GetFullPath(rootPath);

            var files = Directory.Exists(rootPath)
                ? Directory.GetFiles(rootPath).Select(Path.GetFileName).ToList()
                : new List<string>();

            var matchedFile = files.FirstOrDefault(x =>
                string.Equals(x, fileName, StringComparison.OrdinalIgnoreCase)
            );

            if (matchedFile == null)
            {
                return NotFound(new
                {
                    SearchingFor = fileName,
                    FolderPath = rootPath,
                    AvailableFiles = files
                });
            }

            var filePath = Path.Combine(rootPath, matchedFile);

            return PhysicalFile(filePath, "image/jpeg");
        }
        private void SendEmailAlert(Alert alert)
        {
            try
            {
                var mail = _configuration["EmailSettings:Mail"];
                var password = _configuration["EmailSettings:Password"];
                var host = _configuration["EmailSettings:Host"];
                var port = Convert.ToInt32(_configuration["EmailSettings:Port"]);
                var to = _configuration["EmailSettings:To"];

                var message = new MailMessage();

                message.From = new MailAddress(mail!, "AI CCTV");

                foreach (var addr in (to ?? "").Split(
                    ',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    message.To.Add(addr);
                }

                // Also notify the recognized employee, if any.
                if (!string.IsNullOrWhiteSpace(alert.EmployeeEmail) &&
                    alert.EmployeeEmail.Contains('@'))
                {
                    try { message.To.Add(alert.EmployeeEmail.Trim()); } catch { /* ignore bad addr */ }
                }

                message.Subject = $"\U0001F6A8 AI CCTV Alert — {alert.AlertType}";
                message.IsBodyHtml = true;

                // Locate media: clip (mp4/jpg) + its .jpg poster for an inline preview
                var alertsDir = Path.Combine(
                    _env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"),
                    "alerts");
                var fileName = Path.GetFileName(alert.ScreenshotPath ?? "");
                var stem = Path.GetFileNameWithoutExtension(fileName);
                var posterPath = Path.Combine(alertsDir, stem + ".jpg");
                var clipPath = Path.Combine(alertsDir, fileName);

                var type = (alert.AlertType ?? "").ToLowerInvariant();
                var accent = type.Contains("intrusion") ? "#f0455f"
                           : type.Contains("sleep") ? "#f5a623" : "#2f6bff";

                var posterTag = System.IO.File.Exists(posterPath)
                    ? "<img src=\"cid:snapshot\" width=\"100%\" style=\"display:block;border-radius:10px;border:1px solid #eef1f6;\" alt=\"snapshot\"/>"
                    : "";

                // Identified-employee rows (only when face recognition matched someone).
                var rowStyle = "padding:10px 0;color:#8a93a6;border-top:1px solid #eef1f6;";
                var valStyle = "padding:10px 0;text-align:right;font-weight:bold;border-top:1px solid #eef1f6;";
                var employeeRows = !string.IsNullOrWhiteSpace(alert.EmployeeName)
                    ? $@"
        <tr><td style=""{rowStyle}"">Employee</td><td style=""{valStyle}"">{alert.EmployeeName}</td></tr>
        <tr><td style=""{rowStyle}"">Employee ID</td><td style=""{valStyle}"">#{alert.EmployeeId}</td></tr>
        <tr><td style=""{rowStyle}"">Employee Email</td><td style=""{valStyle}"">{alert.EmployeeEmail}</td></tr>"
                    : (type.Contains("intrusion")
                        ? $@"<tr><td style=""{rowStyle}"">Person</td><td style=""{valStyle}color:#f0455f;"">Unknown (not a registered employee)</td></tr>"
                        : "");

                var html = $@"
<div style=""background:#f3f5f9;padding:24px;font-family:'Segoe UI',Arial,sans-serif;"">
  <div style=""max-width:460px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(31,36,48,.10);"">
    <div style=""background:{accent};padding:20px 24px;color:#ffffff;"">
      <div style=""font-size:12px;letter-spacing:.08em;opacity:.85;"">AI CCTV SECURITY</div>
      <div style=""font-size:22px;font-weight:bold;margin-top:3px;"">&#128680; {alert.AlertType}</div>
    </div>
    <div style=""padding:22px 24px;"">
      {posterTag}
      <table style=""width:100%;border-collapse:collapse;margin-top:18px;font-size:14px;color:#1f2430;"">
        <tr><td style=""padding:10px 0;color:#8a93a6;"">Camera</td><td style=""padding:10px 0;text-align:right;font-weight:bold;"">{alert.CameraName}</td></tr>
        <tr><td style=""padding:10px 0;color:#8a93a6;border-top:1px solid #eef1f6;"">Time</td><td style=""padding:10px 0;text-align:right;font-weight:bold;border-top:1px solid #eef1f6;"">{alert.AlertTime:dd MMM yyyy, hh:mm tt}</td></tr>
        <tr><td style=""padding:10px 0;color:#8a93a6;border-top:1px solid #eef1f6;"">Status</td><td style=""padding:10px 0;text-align:right;font-weight:bold;border-top:1px solid #eef1f6;color:{accent};"">{alert.Status}</td></tr>
        {employeeRows}
      </table>
      <div style=""margin-top:16px;font-size:13px;color:#8a93a6;text-align:center;"">&#128206; Full video clip attached to this email</div>
    </div>
    <div style=""padding:16px 24px;background:#fafbfe;color:#8a93a6;font-size:12px;text-align:center;border-top:1px solid #eef1f6;"">
      Automated alert from your AI CCTV system
    </div>
  </div>
</div>";

                var htmlView = AlternateView.CreateAlternateViewFromString(
                    html, null, "text/html");

                // Embed the poster inline (cid:snapshot)
                if (System.IO.File.Exists(posterPath))
                {
                    var inline = new LinkedResource(posterPath, "image/jpeg")
                    {
                        ContentId = "snapshot",
                        TransferEncoding = System.Net.Mime.TransferEncoding.Base64
                    };
                    htmlView.LinkedResources.Add(inline);
                }
                message.AlternateViews.Add(htmlView);

                // Attach the actual footage (clip or screenshot) as evidence
                try
                {
                    if (System.IO.File.Exists(clipPath))
                        message.Attachments.Add(new Attachment(clipPath));
                }
                catch (Exception ex)
                {
                    Console.WriteLine(ex.Message);
                }

                using var smtp = new SmtpClient(host, port);

                smtp.Credentials = new NetworkCredential(mail, password);

                smtp.EnableSsl = true;

                smtp.Send(message);

                Console.WriteLine("Email Alert Sent Successfully");
            }
            catch (Exception ex)
            {
                Console.WriteLine("Email Error: " + ex.Message);
            }
        }
    }

}