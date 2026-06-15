// Shared auth gate, sidebar, and helpers for AI CCTV pages.

const AUTH = JSON.parse(localStorage.getItem("cctv_auth") || "null");
if (!AUTH || !AUTH.email) location.replace("login.html");

const API_BASE = location.origin;
const STREAM_BASE = "http://" + location.hostname + ":5000";

function logout() { localStorage.removeItem("cctv_auth"); location.replace("login.html"); }

const NAV = [
  ["dashboard", "Dashboard", "dashboard.html",
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'],
  ["alerts", "Alerts", "alerts.html",
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>'],
  ["activity", "Activity", "activity.html",
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>'],
  ["devices", "Devices", "devices.html",
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'],
  ["settings", "Settings", "settings.html",
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.61.78 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'],
];

function mountSidebar(active) {
  const links = NAV.map(([id, label, href, icon]) =>
    `<a class="${id === active ? "active" : ""}" href="${href}">${icon} ${label}</a>`).join("");
  const name = (AUTH?.email || "user").split("@")[0];
  const el = document.getElementById("sidebar");
  el.innerHTML = `
    <div class="brand"><span class="logo">●</span> AI CCTV</div>
    <nav class="nav">${links}</nav>
    <div class="spacer"></div>
    <div class="me">
      <div class="av">${(AUTH?.email || "U")[0].toUpperCase()}</div>
      <div><div class="nm">${name}</div><div class="rl">${AUTH?.role || "Member"}</div></div>
    </div>
    <div class="logout" onclick="logout()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg> Log Out
    </div>`;
}

// helpers shared by pages
function typeKey(t) { t = (t || "").toLowerCase(); if (t.includes("intrusion")) return "intrusion"; if (t.includes("sleep")) return "sleeping"; if (t.includes("test")) return "test"; return "other"; }
function mediaFile(a) { return a.screenshotPath ? a.screenshotPath.split("/").pop().split("\\").pop() : ""; }
function mediaUrl(a) { const f = mediaFile(a); return f ? API_BASE + "/alerts/" + f : ""; }
function isVideo(a) { return /\.(mp4|webm|avi|mov)$/i.test(mediaFile(a)); }
function posterUrl(a) { const f = mediaFile(a); return f ? API_BASE + "/alerts/" + f.replace(/\.[^.]+$/, ".jpg") : ""; }
function fmt(ts) { try { return new Date(ts).toLocaleString(); } catch { return ts; } }

function toast(msg, color) {
  const colors = { green: "#21c17a", red: "#f0455f", blue: "#2f6bff", amber: "#f5a623" };
  let box = document.getElementById("toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  const el = document.createElement("div"); el.className = "toast";
  el.innerHTML = `<span class="tdot" style="background:${colors[color] || "#2f6bff"}"></span>${msg}`;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function getAlerts() {
  const r = await fetch(API_BASE + "/api/alerts");
  return r.ok ? r.json() : [];
}
