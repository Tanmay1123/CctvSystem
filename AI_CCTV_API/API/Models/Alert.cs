using System;

namespace AI_CCTV_API.Models
{
    public class Alert
    {
        public int AlertId { get; set; }

        public string AlertType { get; set; }

        public string CameraName { get; set; }

        public DateTime AlertTime { get; set; }

        public string ScreenshotPath { get; set; }

        public string Status { get; set; }

        public DateTime CreatedDate { get; set; }
    }
}