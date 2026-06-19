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
        public DbSet<User> Users { get; set; }
        public DbSet<Camera> Cameras { get; set; }
        public DbSet<Employee> Employees { get; set; }
    }
}










