using System;

namespace AI_CCTV_API.Models
{
    public class Camera
    {
        public int CameraId { get; set; }

        public string Name { get; set; } = "";

        public string Location { get; set; } = "";

        public string IpAddress { get; set; } = "";

        // MJPEG / stream URL for the live feed (the Python Flask server exposes
        // the AI-annotated feed at http://localhost:5000/video).
        public string StreamUrl { get; set; } = "";

        public string Status { get; set; } = "online"; // "online" | "offline"

        public string Resolution { get; set; } = "1920x1080";

        public int Fps { get; set; }

        public bool Ptz { get; set; }

        public bool Recording { get; set; }

        // Stored uptime % (last 30 days) — editable operational metric.
        public double Uptime { get; set; } = 100;

        public DateTime CreatedDate { get; set; }
    }
}
