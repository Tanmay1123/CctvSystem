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

        public AlertsController(
    AppDbContext context,
    IHubContext<AlertHub> hubContext,
    IConfiguration configuration)
        {
            _context = context;
            _hubContext = hubContext;
            _configuration = configuration;
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

                message.From = new MailAddress(mail);

                message.To.Add(to);

                message.Subject = $"AI CCTV Alert - {alert.AlertType}";

                message.Body =
                    $"Alert Type: {alert.AlertType}\n" +
                    $"Camera: {alert.CameraName}\n" +
                    $"Time: {alert.AlertTime}";

                // Attach Screenshot
                try
                {
                    var fileName = Path.GetFileName(alert.ScreenshotPath);

                    var imagePath = Path.Combine(
                        Directory.GetCurrentDirectory(),
                        "wwwroot",
                        "alerts",
                        fileName
                    );

                    if (System.IO.File.Exists(imagePath))
                    {
                        Attachment attachment = new Attachment(imagePath);

                        message.Attachments.Add(attachment);
                    }
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