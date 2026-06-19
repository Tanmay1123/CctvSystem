// Client for the .NET backend API (everything is real data).

import { severityFor, type AlertItem, type AlertStatus } from "@/lib/data";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "http://localhost:5237";

// Base URL of the Python AI engine (Flask). It serves the AI-annotated primary
// feed at /video and relays any other camera source as MJPEG at /stream.
export const ENGINE_BASE =
  process.env.NEXT_PUBLIC_ENGINE_BASE?.replace(/\/$/, "") || "http://localhost:5000";

// Turn a relative ("/alerts/x.mp4") path into an absolute backend URL.
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

/* ----------------------------- Alerts ----------------------------- */

export interface ApiAlert {
  alertId: number;
  alertType: string;
  cameraName: string;
  alertTime: string;
  screenshotPath: string | null;
  status: string;
  createdDate: string;
  employeeName?: string | null;
  employeeId?: number | null;
  employeeEmail?: string | null;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr > 1 ? "s" : ""} ago`;
  const d = Math.round(hr / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

export type DisplayAlert = AlertItem & {
  confidence: number | null;
  screenshot: string | null;
  isVideo: boolean;
  employeeName: string | null;
  employeeId: number | null;
};

export function mapAlert(a: ApiAlert): DisplayAlert {
  const status: AlertStatus =
    (a.status || "").toLowerCase() === "closed" ? "Resolved" : "Unresolved";
  const media = mediaUrl(a.screenshotPath);
  return {
    id: String(a.alertId),
    type: a.alertType,
    camera: a.cameraName,
    location: a.cameraName,
    severity: severityFor(a.alertType),
    time: timeAgo(a.alertTime || a.createdDate),
    status,
    confidence: null,
    screenshot: media,
    isVideo: !!media && /\.mp4($|\?)/i.test(media),
    employeeName: a.employeeName ?? null,
    employeeId: a.employeeId ?? null,
  };
}

export const getAlerts = () => get<ApiAlert[]>("/api/alerts");

export async function closeAlert(id: string | number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/alerts/${id}/close`, { method: "PUT" });
  if (!res.ok) throw new Error(`close ${id} -> ${res.status}`);
}

export async function deleteAlert(id: string | number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/alerts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete ${id} -> ${res.status}`);
}

/* ----------------------------- Cameras ----------------------------- */

export interface ApiCamera {
  cameraId: number;
  name: string;
  location: string;
  ipAddress: string;
  streamUrl: string;
  status: "online" | "offline";
  resolution: string;
  fps: number;
  ptz: boolean;
  recording: boolean;
  uptime: number;
  createdDate?: string;
}

// Resolve a camera's browser-playable feed URL. Browsers cannot render rtsp://
// (or rtmp://) directly, so those sources are routed through the engine's MJPEG
// relay. Plain http(s) MJPEG URLs — like the AI-annotated /video — are used as-is.
export function cameraFeedUrl(
  cam: Pick<ApiCamera, "streamUrl">
): string | null {
  const url = (cam.streamUrl || "").trim();
  if (!url) return null;
  if (/^(rtsp|rtmp):\/\//i.test(url)) {
    return `${ENGINE_BASE}/stream?src=${encodeURIComponent(url)}`;
  }
  return url;
}

export const getCameras = () => get<ApiCamera[]>("/api/cameras");

export async function createCamera(cam: Partial<ApiCamera>): Promise<ApiCamera> {
  const res = await fetch(`${API_BASE}/api/cameras`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cam),
  });
  if (!res.ok) throw new Error(`create camera -> ${res.status}`);
  return res.json();
}

export async function updateCamera(id: number, cam: Partial<ApiCamera>): Promise<ApiCamera> {
  const res = await fetch(`${API_BASE}/api/cameras/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cam),
  });
  if (!res.ok) throw new Error(`update camera -> ${res.status}`);
  return res.json();
}

export async function deleteCamera(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/cameras/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete camera -> ${res.status}`);
}

/* ----------------------------- Employees ----------------------------- */

export interface ApiEmployee {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  photoPath: string; // "/employees/1.jpg" or "" when none uploaded
  createdDate?: string;
}

export const getEmployees = () => get<ApiEmployee[]>("/api/employees");

// Absolute URL of an employee's photo, or null when none.
export function employeePhotoUrl(e: Pick<ApiEmployee, "photoPath">): string | null {
  return e.photoPath ? mediaUrl(e.photoPath) : null;
}

// Create with a mandatory photo (multipart/form-data).
export async function createEmployee(fields: {
  id: number;
  name: string;
  email: string;
  phone?: string;
  photo: File;
}): Promise<ApiEmployee> {
  const fd = new FormData();
  fd.append("id", String(fields.id));
  fd.append("name", fields.name);
  fd.append("email", fields.email);
  if (fields.phone) fd.append("phone", fields.phone);
  fd.append("photo", fields.photo);

  const res = await fetch(`${API_BASE}/api/employees`, { method: "POST", body: fd });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `create employee -> ${res.status}`);
  return res.json();
}

// Update details; photo optional (only replaced when a new file is supplied).
export async function updateEmployee(
  id: number,
  fields: { name: string; email: string; phone?: string; photo?: File | null }
): Promise<ApiEmployee> {
  const fd = new FormData();
  fd.append("name", fields.name);
  fd.append("email", fields.email);
  if (fields.phone) fd.append("phone", fields.phone);
  if (fields.photo) fd.append("photo", fields.photo);

  const res = await fetch(`${API_BASE}/api/employees/${id}`, { method: "PUT", body: fd });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `update employee -> ${res.status}`);
  return res.json();
}

export async function deleteEmployee(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/employees/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete employee -> ${res.status}`);
}

export interface BulkEmployeeRow {
  id: number | null;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface BulkResult {
  inserted: number;
  updated: number;
  skippedCount: number;
  skipped: { row: number; id?: number; reason: string }[];
}

export async function bulkUpsertEmployees(rows: BulkEmployeeRow[]): Promise<BulkResult> {
  const res = await fetch(`${API_BASE}/api/employees/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `bulk import -> ${res.status}`);
  return res.json();
}

// Ask the AI engine to reload its face registry (best-effort, non-blocking) so
// recognition picks up registry changes without a restart.
export async function reloadEngineFaces(): Promise<void> {
  try {
    await fetch(`${ENGINE_BASE}/reload-faces`, { method: "POST" });
  } catch {
    /* engine may be offline; registry still persists in the DB */
  }
}

/* ----------------------------- Recordings ----------------------------- */

export interface ApiRecording {
  id: string;
  camera: string;
  type: string;
  kind: "video" | "image";
  date: string;
  time: string;
  size: string;
  sizeBytes: number;
  url: string;
  poster: string | null;
}

export const getRecordings = () => get<ApiRecording[]>("/api/recordings");

/* ----------------------------- Users ----------------------------- */

export interface ApiUser {
  userId: number;
  email: string;
  role: string;
  createdDate: string;
}

export const getUsers = () => get<ApiUser[]>("/api/users");

export async function deleteUser(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/users/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete user -> ${res.status}`);
}

/* ----------------------------- Stats ----------------------------- */

export interface ApiStats {
  totalCameras: number;
  activeCameras: number;
  offlineCameras: number;
  peopleDetected: number;
  dailyAlerts: number;
  unresolvedAlerts: number;
  avgUptime: number;
  securityScore: number;
}

export interface ApiAnalytics {
  activity: { label: string; intrusion: number; sleeping: number; mobile: number }[];
  byDay: { day: string; count: number }[];
  byType: { type: string; count: number }[];
  performance: {
    camera: string;
    detections: number;
    uptime: number;
    alerts: number;
    resolution: string;
    status: "online" | "offline";
  }[];
  cameraUptime: { camera: string; uptime: number }[];
}

export const getStats = () => get<ApiStats>("/api/stats");
export const getAnalytics = () => get<ApiAnalytics>("/api/stats/analytics");

/* ----------------------------- Auth ----------------------------- */

export interface AuthResult {
  email: string;
  role: string;
  token: string;
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ message: "Login failed" }));
    throw new Error(msg.message ?? "Login failed");
  }
  return res.json();
}

export async function changePassword(
  email: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, currentPassword, newPassword }),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ message: "Could not change password" }));
    throw new Error(msg.message ?? "Could not change password");
  }
}
