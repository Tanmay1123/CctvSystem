// Shared display types for the AI CCTV frontend.
// All real data now comes from the .NET API (see lib/api.ts) — no mock arrays.

export type Severity = "critical" | "warning" | "normal";
export type CamStatus = "online" | "offline";
export type AlertStatus = "Resolved" | "Unresolved";

export interface AlertItem {
  id: string;
  type: string;
  camera: string;
  location: string;
  severity: Severity;
  time: string;
  status: AlertStatus;
}

// Derive a severity bucket from a detection/alert type string.
export function severityFor(alertType: string): Severity {
  const t = (alertType || "").toLowerCase();
  if (t.includes("intrusion")) return "critical";
  if (t.includes("sleep") || t.includes("mobile") || t.includes("suspicious") || t.includes("crowd"))
    return "warning";
  return "normal";
}
