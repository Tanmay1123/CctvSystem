using AI_CCTV_API.Data;
using Microsoft.EntityFrameworkCore;

namespace AI_CCTV_API.Services
{
    /// <summary>
    /// Background job that removes alerts (and their screenshot/clip files) older
    /// than the retention window, so the dashboard and disk stay clean.
    /// Runs shortly after startup and then on a fixed interval.
    /// Uses Console for its own logging to avoid the Windows EventLog provider,
    /// which throws if touched during host shutdown.
    /// </summary>
    public class AlertCleanupService : BackgroundService
    {
        private static readonly TimeSpan Retention = TimeSpan.FromDays(7);
        private static readonly TimeSpan Interval = TimeSpan.FromHours(6);
        private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(15);

        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IWebHostEnvironment _env;

        public AlertCleanupService(IServiceScopeFactory scopeFactory, IWebHostEnvironment env)
        {
            _scopeFactory = scopeFactory;
            _env = env;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            // Let the host finish starting before the first sweep.
            try { await Task.Delay(StartupDelay, stoppingToken); }
            catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await CleanupAsync(stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break; // shutting down — exit quietly
                }
                catch (Exception ex)
                {
                    Console.WriteLine("Alert cleanup failed: " + ex.Message);
                }

                try { await Task.Delay(Interval, stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }

        private async Task CleanupAsync(CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var cutoff = DateTime.Now - Retention;

            var stale = await db.Alerts
                .Where(a => a.CreatedDate < cutoff)
                .ToListAsync(ct);

            if (stale.Count == 0)
                return;

            var alertsDir = Path.Combine(
                _env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"),
                "alerts");

            foreach (var alert in stale)
            {
                DeleteMediaFor(alert.ScreenshotPath, alertsDir);
            }

            db.Alerts.RemoveRange(stale);
            await db.SaveChangesAsync(ct);

            Console.WriteLine($"Alert cleanup: removed {stale.Count} alerts older than {Retention.TotalDays} days");
        }

        private void DeleteMediaFor(string? screenshotPath, string alertsDir)
        {
            if (string.IsNullOrWhiteSpace(screenshotPath))
                return;

            // ScreenshotPath is a URL like http://localhost:5237/alerts/xxx.mp4
            var fileName = Path.GetFileName(screenshotPath);
            if (string.IsNullOrWhiteSpace(fileName))
                return;

            var stem = Path.GetFileNameWithoutExtension(fileName);

            // Remove the clip and its matching .jpg poster (same base name).
            foreach (var name in new[] { fileName, stem + ".jpg", stem + ".mp4" })
            {
                try
                {
                    var path = Path.Combine(alertsDir, name);
                    if (File.Exists(path))
                        File.Delete(path);
                }
                catch (Exception ex)
                {
                    Console.WriteLine("Could not delete alert media " + name + ": " + ex.Message);
                }
            }
        }
    }
}
