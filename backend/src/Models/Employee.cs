using System;
using System.ComponentModel.DataAnnotations.Schema;

namespace AI_CCTV_API.Models
{
    /// <summary>
    /// A person the AI engine recognises (the "face database"). Distinct from
    /// <see cref="User"/>, which is a dashboard login account.
    ///
    /// <c>Id</c> is the business employee id supplied by the operator (not an
    /// auto-increment) so it stays stable across exports/imports and matches the
    /// <c>EmployeeId</c> stored on alerts.
    /// </summary>
    public class Employee
    {
        [DatabaseGenerated(DatabaseGeneratedOption.None)]
        public int Id { get; set; }

        public string Name { get; set; } = "";

        public string Email { get; set; } = "";

        // Optional — may be null/empty.
        public string? Phone { get; set; }

        // Relative URL of the reference photo, e.g. "/employees/1.jpg". Empty when
        // no photo has been uploaded yet (record exists but isn't recognisable).
        public string PhotoPath { get; set; } = "";

        public DateTime CreatedDate { get; set; }
    }
}
