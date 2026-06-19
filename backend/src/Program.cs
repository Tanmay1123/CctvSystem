using AI_CCTV_API.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;
using AI_CCTV_API.Hubs;
using AI_CCTV_API.Services;
using Microsoft.Extensions.FileProviders;

// The "Alerts" table uses `timestamp without time zone` columns and the app stores
// local DateTime values (DateTime.Now). Npgsql 6+ otherwise maps DateTime to
// `timestamptz` and rejects non-UTC values. Opt into legacy behavior so local
// timestamps round-trip correctly.
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

var builder = WebApplication.CreateBuilder(args);

// ADD SERVICES
builder.Services.AddControllers();
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend",
        policy =>
        {
            // Next.js dev frontend (frontend/) runs on port 3001.
            policy.WithOrigins("http://localhost:3001", "http://localhost:3000")
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .AllowCredentials();
        });
});

// Database Connection
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("DefaultConnection")
    ));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddSignalR();

// Background job: delete alerts + their media older than 7 days
builder.Services.AddHostedService<AlertCleanupService>();

// Background job: monitor camera reachability and email when one goes offline
builder.Services.AddHostedService<CameraMonitorService>();

var app = builder.Build();

// Ensure the Users table exists (matches the manual-SQL pattern used for Alerts)
// and seed the admin account.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.ExecuteSqlRaw(@"
        CREATE TABLE IF NOT EXISTS ""Users"" (
            ""UserId""       SERIAL PRIMARY KEY,
            ""Email""        VARCHAR(200) UNIQUE NOT NULL,
            ""PasswordHash"" VARCHAR(500) NOT NULL,
            ""Role""         VARCHAR(50)  NOT NULL DEFAULT 'User',
            ""CreatedDate""  TIMESTAMP    NOT NULL
        );");

    const string adminEmail = "abhimorework@gmail.com";
    if (!db.Users.Any(u => u.Email == adminEmail))
    {
        db.Users.Add(new AI_CCTV_API.Models.User
        {
            Email = adminEmail,
            PasswordHash = AI_CCTV_API.Services.PasswordHasher.Hash("123456"),
            Role = "Admin",
            CreatedDate = DateTime.Now
        });
        db.SaveChanges();
    }

    // Ensure the Alerts table exists and has the employee (face-recognition)
    // columns. ADD COLUMN IF NOT EXISTS keeps it safe on an existing table.
    db.Database.ExecuteSqlRaw(@"
        CREATE TABLE IF NOT EXISTS ""Alerts"" (
            ""AlertId""        SERIAL PRIMARY KEY,
            ""AlertType""      VARCHAR(200),
            ""CameraName""     VARCHAR(200),
            ""AlertTime""      TIMESTAMP,
            ""ScreenshotPath"" VARCHAR(500),
            ""Status""         VARCHAR(50),
            ""CreatedDate""    TIMESTAMP
        );
        ALTER TABLE ""Alerts"" ADD COLUMN IF NOT EXISTS ""EmployeeName""  VARCHAR(200);
        ALTER TABLE ""Alerts"" ADD COLUMN IF NOT EXISTS ""EmployeeId""    INTEGER;
        ALTER TABLE ""Alerts"" ADD COLUMN IF NOT EXISTS ""EmployeeEmail"" VARCHAR(200);
    ");

    // Cameras table (manual-SQL pattern, same as Users above).
    db.Database.ExecuteSqlRaw(@"
        CREATE TABLE IF NOT EXISTS ""Cameras"" (
            ""CameraId""    SERIAL PRIMARY KEY,
            ""Name""        VARCHAR(200) NOT NULL,
            ""Location""    VARCHAR(200) NOT NULL DEFAULT '',
            ""IpAddress""   VARCHAR(100) NOT NULL DEFAULT '',
            ""StreamUrl""   VARCHAR(500) NOT NULL DEFAULT '',
            ""Status""      VARCHAR(50)  NOT NULL DEFAULT 'online',
            ""Resolution""  VARCHAR(50)  NOT NULL DEFAULT '1920x1080',
            ""Fps""         INTEGER      NOT NULL DEFAULT 0,
            ""Ptz""         BOOLEAN      NOT NULL DEFAULT FALSE,
            ""Recording""   BOOLEAN      NOT NULL DEFAULT FALSE,
            ""Uptime""      DOUBLE PRECISION NOT NULL DEFAULT 100,
            ""CreatedDate"" TIMESTAMP    NOT NULL
        );");

    // Seed the one real camera — the Python Flask server streams the AI-annotated
    // feed at http://localhost:5000/video. Operators can add more via the UI.
    if (!db.Cameras.Any())
    {
        db.Cameras.Add(new AI_CCTV_API.Models.Camera
        {
            Name = "Main Camera",
            Location = "Office Floor",
            IpAddress = "192.168.29.89",
            StreamUrl = "http://localhost:5000/video",
            Status = "online",
            Resolution = "640x360",
            Fps = 20,
            Ptz = false,
            Recording = true,
            Uptime = 99.2,
            CreatedDate = DateTime.Now
        });
        db.SaveChanges();
    }

    // Employees table (the AI face-recognition registry — distinct from Users).
    db.Database.ExecuteSqlRaw(@"
        CREATE TABLE IF NOT EXISTS ""Employees"" (
            ""Id""          INTEGER      PRIMARY KEY,
            ""Name""        VARCHAR(200) NOT NULL,
            ""Email""       VARCHAR(200) NOT NULL,
            ""Phone""       VARCHAR(50),
            ""PhotoPath""   VARCHAR(500) NOT NULL DEFAULT '',
            ""CreatedDate"" TIMESTAMP    NOT NULL
        );");

    // One-time migration: import the engine's existing employees.json + photos so
    // the people already registered for face recognition show up in the new
    // Employee Management UI. Best-effort and same-machine only (the engine lives
    // beside the API in this repo); skipped silently if not found.
    if (!db.Employees.Any())
    {
        try
        {
            var engineDir = Path.GetFullPath(Path.Combine(
                app.Environment.ContentRootPath, "..", "..", "ai-engine", "employees"));
            var jsonPath = Path.Combine(engineDir, "employees.json");
            var photoDir = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "employees");
            Directory.CreateDirectory(photoDir);

            if (File.Exists(jsonPath))
            {
                using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(jsonPath));
                foreach (var el in doc.RootElement.EnumerateArray())
                {
                    if (!el.TryGetProperty("id", out var idEl)) continue;
                    int id = idEl.GetInt32();
                    string photoFile = el.TryGetProperty("photo", out var pEl) ? (pEl.GetString() ?? "") : "";
                    string photoPath = "";
                    var srcPhoto = Path.Combine(engineDir, photoFile);
                    if (!string.IsNullOrWhiteSpace(photoFile) && File.Exists(srcPhoto))
                    {
                        var dest = Path.Combine(photoDir, $"{id}.jpg");
                        File.Copy(srcPhoto, dest, overwrite: true);
                        photoPath = $"/employees/{id}.jpg";
                    }
                    db.Employees.Add(new AI_CCTV_API.Models.Employee
                    {
                        Id = id,
                        Name = el.TryGetProperty("name", out var nEl) ? (nEl.GetString() ?? "") : "",
                        Email = el.TryGetProperty("email", out var eEl) ? (eEl.GetString() ?? "") : "",
                        Phone = el.TryGetProperty("phone", out var phEl) ? phEl.GetString() : null,
                        PhotoPath = photoPath,
                        CreatedDate = DateTime.Now
                    });
                }
                db.SaveChanges();
                Console.WriteLine($"Seeded {db.Employees.Count()} employees from the engine registry.");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("Employee seed skipped: " + ex.Message);
        }
    }
}

app.UseSwagger();
app.UseSwaggerUI();
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}

app.UseHttpsRedirection();

// Serve alert media (screenshots / clips) from wwwroot/alerts.
app.UseStaticFiles();

app.UseRouting();

app.UseCors("AllowFrontend");

app.UseAuthorization();

app.MapControllers();
app.MapHub<AlertHub>("/alerthub");
app.Run();