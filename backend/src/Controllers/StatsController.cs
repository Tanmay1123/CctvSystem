using AI_CCTV_API.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace AI_CCTV_API.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class StatsController : ControllerBase
    {
        private readonly AppDbContext _context;

        public StatsController(AppDbContext context)
        {
            _context = context;
        }

        private static string Category(string? type)
        {
            var t = (type ?? "").ToLowerInvariant();
            if (t.Contains("intrusion")) return "intrusion";
            if (t.Contains("sleep")) return "sleeping";
            if (t.Contains("mobile")) return "mobile";
            if (t.Contains("crowd")) return "crowd";
            return "other";
        }

        // Dashboard summary cards.
        [HttpGet]
        public async Task<IActionResult> GetSummary()
        {
            var cameras = await _context.Cameras.ToListAsync();
            var alerts = await _context.Alerts.ToListAsync();

            var today = DateTime.Now.Date;
            int totalCameras = cameras.Count;
            int activeCameras = cameras.Count(c => c.Status == "online");
            int dailyAlerts = alerts.Count(a => a.AlertTime.Date == today);
            int unresolved = alerts.Count(a => (a.Status ?? "") != "Closed");
            double avgUptime = cameras.Count > 0 ? Math.Round(cameras.Average(c => c.Uptime), 1) : 0;

            // Deterministic "security score": healthy uptime minus a penalty for
            // unresolved alerts, clamped to 0-100.
            int securityScore = (int)Math.Clamp(Math.Round(avgUptime) - Math.Min(unresolved, 8) * 1.0, 0, 100);

            return Ok(new
            {
                totalCameras,
                activeCameras,
                offlineCameras = totalCameras - activeCameras,
                peopleDetected = alerts.Count,        // total AI detections recorded
                dailyAlerts,
                unresolvedAlerts = unresolved,
                avgUptime,
                securityScore
            });
        }

        // Charts + performance table.
        [HttpGet("analytics")]
        public async Task<IActionResult> GetAnalytics()
        {
            var cameras = await _context.Cameras.ToListAsync();
            var alerts = await _context.Alerts.ToListAsync();

            // Activity over the last 7 days, split by detection category.
            var days = Enumerable.Range(0, 7)
                .Select(i => DateTime.Now.Date.AddDays(-6 + i))
                .ToList();

            var activity = days.Select(d => new
            {
                label = d.ToString("ddd"),
                intrusion = alerts.Count(a => a.AlertTime.Date == d && Category(a.AlertType) == "intrusion"),
                sleeping = alerts.Count(a => a.AlertTime.Date == d && Category(a.AlertType) == "sleeping"),
                mobile = alerts.Count(a => a.AlertTime.Date == d && Category(a.AlertType) == "mobile"),
            }).ToList();

            var byDay = days.Select(d => new
            {
                day = d.ToString("ddd"),
                count = alerts.Count(a => a.AlertTime.Date == d)
            }).ToList();

            var byType = alerts
                .GroupBy(a => a.AlertType ?? "Unknown")
                .Select(g => new { type = g.Key, count = g.Count() })
                .OrderByDescending(x => x.count)
                .ToList();

            var performance = cameras.Select(c =>
            {
                int detections = alerts.Count(a => a.CameraName == c.Name);
                return new
                {
                    camera = c.Name,
                    detections,
                    uptime = c.Uptime,
                    alerts = detections,
                    resolution = c.Resolution,
                    status = c.Status
                };
            }).ToList();

            var cameraUptime = cameras
                .Select(c => new { camera = c.Name, uptime = c.Uptime })
                .ToList();

            return Ok(new { activity, byDay, byType, performance, cameraUptime });
        }
    }
}
