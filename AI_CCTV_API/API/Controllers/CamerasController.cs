using AI_CCTV_API.Data;
using AI_CCTV_API.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace AI_CCTV_API.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class CamerasController : ControllerBase
    {
        private readonly AppDbContext _context;

        public CamerasController(AppDbContext context)
        {
            _context = context;
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<Camera>>> GetCameras()
        {
            return await _context.Cameras.OrderBy(c => c.CameraId).ToListAsync();
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<Camera>> GetCamera(int id)
        {
            var cam = await _context.Cameras.FindAsync(id);
            return cam == null ? NotFound() : Ok(cam);
        }

        [HttpPost]
        public async Task<IActionResult> CreateCamera(Camera camera)
        {
            camera.CameraId = 0;
            camera.CreatedDate = DateTime.Now;
            _context.Cameras.Add(camera);
            await _context.SaveChangesAsync();
            return Ok(camera);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> UpdateCamera(int id, Camera input)
        {
            var cam = await _context.Cameras.FindAsync(id);
            if (cam == null) return NotFound();

            cam.Name = input.Name;
            cam.Location = input.Location;
            cam.IpAddress = input.IpAddress;
            cam.StreamUrl = input.StreamUrl;
            cam.Status = input.Status;
            cam.Resolution = input.Resolution;
            cam.Fps = input.Fps;
            cam.Ptz = input.Ptz;
            cam.Recording = input.Recording;
            cam.Uptime = input.Uptime;

            await _context.SaveChangesAsync();
            return Ok(cam);
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteCamera(int id)
        {
            var cam = await _context.Cameras.FindAsync(id);
            if (cam == null) return NotFound();

            _context.Cameras.Remove(cam);
            await _context.SaveChangesAsync();
            return Ok(new { deleted = id });
        }
    }
}
