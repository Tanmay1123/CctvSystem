using System;

namespace AI_CCTV_API.Models
{
    public class User
    {
        public int UserId { get; set; }

        public string Email { get; set; } = "";

        public string PasswordHash { get; set; } = "";

        public string Role { get; set; } = "User";

        public DateTime CreatedDate { get; set; }
    }
}
