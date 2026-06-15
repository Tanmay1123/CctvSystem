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
builder.Services.AddControllersWithViews();
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAngular",
        policy =>
        {
            policy.WithOrigins("http://localhost:4200")
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
}

app.UseSwagger();
app.UseSwaggerUI();
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();

app.UseStaticFiles();

app.UseRouting();

app.UseCors("AllowAngular");

app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.MapControllers();
app.MapHub<AlertHub>("/alerthub");
app.Run();