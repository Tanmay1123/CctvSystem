using System.Text.RegularExpressions;
using AI_CCTV_API.Data;
using AI_CCTV_API.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace AI_CCTV_API.Controllers
{
    /// <summary>
    /// Manages the employee face-recognition registry: CRUD with a reference
    /// photo (.jpg/.jpeg), plus a bulk import that validates each spreadsheet row
    /// and skips the bad ones. Photos are stored under wwwroot/employees and
    /// served statically at /employees/{id}.jpg. The Python engine reads this
    /// list to recognise faces (see ai-engine/face_db.py).
    /// </summary>
    [Route("api/[controller]")]
    [ApiController]
    public class EmployeesController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IWebHostEnvironment _env;

        public EmployeesController(AppDbContext context, IWebHostEnvironment env)
        {
            _context = context;
            _env = env;
        }

        private static readonly Regex EmailRx =
            new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);

        [HttpGet]
        public async Task<ActionResult<IEnumerable<Employee>>> GetEmployees()
            => await _context.Employees.OrderBy(e => e.Id).ToListAsync();

        [HttpGet("{id}")]
        public async Task<ActionResult<Employee>> GetEmployee(int id)
        {
            var emp = await _context.Employees.FindAsync(id);
            return emp == null ? NotFound() : Ok(emp);
        }

        // multipart/form-data: id, name, email, phone?, photo(file)
        [HttpPost]
        public async Task<IActionResult> Create(
            [FromForm] int id,
            [FromForm] string name,
            [FromForm] string email,
            [FromForm] string? phone,
            IFormFile? photo)
        {
            var err = ValidateCore(id, name, email);
            if (err != null) return BadRequest(new { message = err });

            if (await _context.Employees.AnyAsync(e => e.Id == id))
                return Conflict(new { message = $"An employee with id {id} already exists." });

            if (photo == null || !IsJpeg(photo))
                return BadRequest(new { message = "A .jpg or .jpeg photo is required." });

            var emp = new Employee
            {
                Id = id,
                Name = name.Trim(),
                Email = email.Trim(),
                Phone = CleanPhone(phone),
                PhotoPath = await SavePhotoAsync(id, photo),
                CreatedDate = DateTime.Now
            };

            _context.Employees.Add(emp);
            await _context.SaveChangesAsync();
            return Ok(emp);
        }

        // multipart/form-data: name, email, phone?, photo?(file — only replaces if sent)
        [HttpPut("{id}")]
        public async Task<IActionResult> Update(
            int id,
            [FromForm] string name,
            [FromForm] string email,
            [FromForm] string? phone,
            IFormFile? photo)
        {
            var emp = await _context.Employees.FindAsync(id);
            if (emp == null) return NotFound();

            var err = ValidateCore(id, name, email);
            if (err != null) return BadRequest(new { message = err });

            if (photo != null)
            {
                if (!IsJpeg(photo))
                    return BadRequest(new { message = "Photo must be a .jpg or .jpeg image." });
                emp.PhotoPath = await SavePhotoAsync(id, photo);
            }

            emp.Name = name.Trim();
            emp.Email = email.Trim();
            emp.Phone = CleanPhone(phone);

            await _context.SaveChangesAsync();
            return Ok(emp);
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(int id)
        {
            var emp = await _context.Employees.FindAsync(id);
            if (emp == null) return NotFound();

            _context.Employees.Remove(emp);
            await _context.SaveChangesAsync();

            try
            {
                var file = Path.Combine(PhotoDir(), $"{id}.jpg");
                if (System.IO.File.Exists(file)) System.IO.File.Delete(file);
            }
            catch (Exception ex) { Console.WriteLine("Delete photo error: " + ex.Message); }

            return Ok(new { deleted = id });
        }

        public record BulkRow(int? Id, string? Name, string? Email, string? Phone);

        /// <summary>
        /// Bulk import/update from a parsed spreadsheet (CSV/Excel parsed on the
        /// client into JSON rows). Valid rows are inserted, or — if the id already
        /// exists — updated (name/email/phone; photos are left untouched). Invalid
        /// rows are skipped and reported with a reason, so a partial sheet still
        /// imports its good rows.
        /// </summary>
        [HttpPost("bulk")]
        public async Task<IActionResult> Bulk([FromBody] List<BulkRow> rows)
        {
            if (rows == null || rows.Count == 0)
                return BadRequest(new { message = "No rows provided." });

            var existing = await _context.Employees.ToDictionaryAsync(e => e.Id);
            int inserted = 0, updated = 0;
            var skipped = new List<object>();
            var seenIds = new HashSet<int>();

            for (int i = 0; i < rows.Count; i++)
            {
                var r = rows[i];
                int rowNum = i + 1; // 1-based data row (header excluded client-side)

                if (r.Id is null || r.Id <= 0)
                { skipped.Add(new { row = rowNum, reason = "Missing or invalid id" }); continue; }

                var err = ValidateCore(r.Id.Value, r.Name ?? "", r.Email ?? "");
                if (err != null) { skipped.Add(new { row = rowNum, id = r.Id, reason = err }); continue; }

                if (!seenIds.Add(r.Id.Value))
                { skipped.Add(new { row = rowNum, id = r.Id, reason = "Duplicate id within file" }); continue; }

                if (existing.TryGetValue(r.Id.Value, out var emp))
                {
                    emp.Name = r.Name!.Trim();
                    emp.Email = r.Email!.Trim();
                    emp.Phone = CleanPhone(r.Phone);
                    updated++;
                }
                else
                {
                    var newEmp = new Employee
                    {
                        Id = r.Id.Value,
                        Name = r.Name!.Trim(),
                        Email = r.Email!.Trim(),
                        Phone = CleanPhone(r.Phone),
                        PhotoPath = "",
                        CreatedDate = DateTime.Now
                    };
                    _context.Employees.Add(newEmp);
                    existing[newEmp.Id] = newEmp;
                    inserted++;
                }
            }

            await _context.SaveChangesAsync();
            return Ok(new { inserted, updated, skipped, skippedCount = skipped.Count });
        }

        /* ---------------------------- helpers ---------------------------- */

        private static string? ValidateCore(int id, string name, string email)
        {
            if (id <= 0) return "Id must be a positive number.";
            if (string.IsNullOrWhiteSpace(name)) return "Name is required.";
            if (string.IsNullOrWhiteSpace(email) || !EmailRx.IsMatch(email.Trim()))
                return "A valid email is required.";
            return null;
        }

        private static string? CleanPhone(string? phone)
        {
            phone = phone?.Trim();
            return string.IsNullOrWhiteSpace(phone) ? null : phone;
        }

        private static bool IsJpeg(IFormFile file)
        {
            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            return (ext is ".jpg" or ".jpeg")
                && (file.ContentType.Contains("jpeg", StringComparison.OrdinalIgnoreCase)
                    || file.ContentType.Contains("jpg", StringComparison.OrdinalIgnoreCase));
        }

        private string PhotoDir()
        {
            var dir = Path.Combine(
                _env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"),
                "employees");
            Directory.CreateDirectory(dir);
            return dir;
        }

        // Saves the photo as wwwroot/employees/{id}.jpg and returns its served URL.
        private async Task<string> SavePhotoAsync(int id, IFormFile photo)
        {
            var path = Path.Combine(PhotoDir(), $"{id}.jpg");
            using (var stream = new FileStream(path, FileMode.Create))
                await photo.CopyToAsync(stream);
            return $"/employees/{id}.jpg";
        }
    }
}
