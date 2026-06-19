using AI_CCTV_API.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace AI_CCTV_API.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class UsersController : ControllerBase
    {
        private readonly AppDbContext _context;

        public UsersController(AppDbContext context)
        {
            _context = context;
        }

        // Returns the real user accounts (never the password hash).
        [HttpGet]
        public async Task<IActionResult> GetUsers()
        {
            var users = await _context.Users
                .OrderBy(u => u.UserId)
                .Select(u => new
                {
                    u.UserId,
                    u.Email,
                    u.Role,
                    u.CreatedDate
                })
                .ToListAsync();

            return Ok(users);
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteUser(int id)
        {
            var user = await _context.Users.FindAsync(id);
            if (user == null) return NotFound();

            _context.Users.Remove(user);
            await _context.SaveChangesAsync();
            return Ok(new { deleted = id });
        }
    }
}
