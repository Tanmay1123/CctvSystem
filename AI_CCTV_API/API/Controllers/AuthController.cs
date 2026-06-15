using AI_CCTV_API.Data;
using AI_CCTV_API.Models;
using AI_CCTV_API.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace AI_CCTV_API.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class AuthController : ControllerBase
    {
        private readonly AppDbContext _context;

        public AuthController(AppDbContext context)
        {
            _context = context;
        }

        public record AuthRequest(string Email, string Password);

        [HttpPost("register")]
        public async Task<IActionResult> Register(AuthRequest req)
        {
            var email = (req.Email ?? "").Trim().ToLowerInvariant();

            if (string.IsNullOrWhiteSpace(email) || !email.Contains('@'))
                return BadRequest(new { message = "Please enter a valid email address." });

            if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 6)
                return BadRequest(new { message = "Password must be at least 6 characters." });

            if (await _context.Users.AnyAsync(u => u.Email == email))
                return Conflict(new { message = "An account with this email already exists." });

            var user = new User
            {
                Email = email,
                PasswordHash = PasswordHasher.Hash(req.Password),
                Role = "User",
                CreatedDate = DateTime.Now
            };

            _context.Users.Add(user);
            await _context.SaveChangesAsync();

            return Ok(new { email = user.Email, role = user.Role, token = NewToken() });
        }

        [HttpPost("login")]
        public async Task<IActionResult> Login(AuthRequest req)
        {
            var email = (req.Email ?? "").Trim().ToLowerInvariant();
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == email);

            if (user == null || !PasswordHasher.Verify(req.Password ?? "", user.PasswordHash))
                return Unauthorized(new { message = "Invalid email or password." });

            return Ok(new { email = user.Email, role = user.Role, token = NewToken() });
        }

        private static string NewToken() =>
            Convert.ToBase64String(Guid.NewGuid().ToByteArray());
    }
}
