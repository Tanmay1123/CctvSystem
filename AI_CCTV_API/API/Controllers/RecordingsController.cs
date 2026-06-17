using System.Globalization;
using AI_CCTV_API.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace AI_CCTV_API.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class RecordingsController : ControllerBase
    {
        private readonly IWebHostEnvironment _env;
        private readonly AppDbContext _context;

        public RecordingsController(IWebHostEnvironment env, AppDbContext context)
        {
            _env = env;
            _context = context;
        }

        // Lists the real footage captured in wwwroot/alerts. Each alert clip is a
        // .mp4 plus a matching .jpg poster (same base name); older alerts may be a
        // .jpg snapshot only.
        [HttpGet]
        public async Task<IActionResult> GetRecordings()
        {
            var alertsDir = Path.Combine(
                _env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"),
                "alerts");

            if (!Directory.Exists(alertsDir))
                return Ok(Array.Empty<object>());

            // Map filename stem -> alert (for camera name) where possible.
            var alerts = await _context.Alerts.ToListAsync();
            string StemOf(string? path) =>
                Path.GetFileNameWithoutExtension(path ?? "").ToLowerInvariant();
            var alertByStem = alerts
                .Where(a => !string.IsNullOrEmpty(a.ScreenshotPath))
                .GroupBy(a => StemOf(a.ScreenshotPath))
                .ToDictionary(g => g.Key, g => g.First());

            var files = Directory.GetFiles(alertsDir);

            var recordings = files
                .GroupBy(f => Path.GetFileNameWithoutExtension(f))
                .Select(g =>
                {
                    var stem = g.Key;
                    var mp4 = g.FirstOrDefault(f => f.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase));
                    var jpg = g.FirstOrDefault(f => f.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase));
                    var primary = mp4 ?? jpg ?? g.First();

                    long size = g.Sum(f => new FileInfo(f).Length);
                    var (date, time) = ParseStamp(stem);

                    alertByStem.TryGetValue(stem.ToLowerInvariant(), out var alert);

                    return new
                    {
                        id = stem,
                        camera = alert?.CameraName ?? "Main Camera",
                        type = PrettyType(stem),
                        kind = mp4 != null ? "video" : "image",
                        date,
                        time,
                        sizeBytes = size,
                        size = HumanSize(size),
                        url = $"/alerts/{Path.GetFileName(primary)}",
                        poster = jpg != null ? $"/alerts/{Path.GetFileName(jpg)}" : null,
                        sortKey = new FileInfo(primary).LastWriteTime
                    };
                })
                .OrderByDescending(r => r.sortKey)
                .Select(r => new
                {
                    r.id, r.camera, r.type, r.kind, r.date, r.time, r.size, r.sizeBytes, r.url, r.poster
                })
                .ToList();

            return Ok(recordings);
        }

        private static (string date, string time) ParseStamp(string stem)
        {
            // Expect *_YYYYMMDD_HHMMSS
            var parts = stem.Split('_');
            if (parts.Length >= 2)
            {
                var datePart = parts[^2];
                var timePart = parts[^1];
                if (DateTime.TryParseExact(
                        datePart + timePart, "yyyyMMddHHmmss",
                        CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
                {
                    return (dt.ToString("dd MMM yyyy"), dt.ToString("HH:mm:ss"));
                }
            }
            return ("—", "—");
        }

        private static string PrettyType(string stem)
        {
            var parts = stem.Split('_');
            // strip the trailing date + time tokens
            var nameTokens = parts.Length > 2 ? parts[..^2] : parts;
            var name = string.Join(' ', nameTokens);
            return CultureInfo.CurrentCulture.TextInfo.ToTitleCase(name.Replace('-', ' '));
        }

        private static string HumanSize(long bytes)
        {
            string[] units = { "B", "KB", "MB", "GB" };
            double len = bytes;
            int u = 0;
            while (len >= 1024 && u < units.Length - 1) { len /= 1024; u++; }
            return $"{len:0.#} {units[u]}";
        }
    }
}
