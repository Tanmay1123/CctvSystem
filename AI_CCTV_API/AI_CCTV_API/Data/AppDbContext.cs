using Microsoft.EntityFrameworkCore;
using AI_CCTV_API.Models;

namespace AI_CCTV_API.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options)
            : base(options)
        {

        }

        public DbSet<Alert> Alerts { get; set; }
    }
}










