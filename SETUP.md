# AI CCTV System — Developer Handover & Setup Guide

> A complete technical reference for the developer taking over this project.
> It covers **what the system is**, **how every part works**, **how to set it up
> from scratch**, **how to configure and extend it**, and **what to fix before it
> goes anywhere near production**.
>
> Quick-start only? See [README.md](README.md). This document is the deep dive.

---

## Table of contents

1. [What this project is](#1-what-this-project-is)
2. [Architecture & data flow](#2-architecture--data-flow)
3. [Repository layout](#3-repository-layout)
4. [Tech stack & versions](#4-tech-stack--versions)
5. [Prerequisites](#5-prerequisites)
6. [First-time setup (step by step)](#6-first-time-setup-step-by-step)
7. [Running the system day to day](#7-running-the-system-day-to-day)
8. [Configuration reference](#8-configuration-reference)
9. [How the backend (.NET API) works](#9-how-the-backend-net-api-works)
10. [How the AI engine (Python) works](#10-how-the-ai-engine-python-works)
11. [How the frontend (Next.js) works](#11-how-the-frontend-nextjs-works)
12. [Database schema](#12-database-schema)
13. [HTTP API reference](#13-http-api-reference)
14. [Common tasks / how-to](#14-common-tasks--how-to)
15. [Troubleshooting](#15-troubleshooting)
16. [⚠️ Security & production hardening (read this)](#16-️-security--production-hardening-read-this)
17. [Known limitations & tech debt](#17-known-limitations--tech-debt)

---

## 1. What this project is

An **AI-powered CCTV monitoring system**. It takes a camera feed, runs computer
vision on it in real time, and raises **alerts** for configurable events. Alerts
are stored in a database, emailed to recipients, and shown live on a web
dashboard.

**Detections / rules currently implemented (on the primary camera):**

| Rule | Fires when… |
|---|---|
| **After-hours intrusion** | A person is present while the office is closed (outside 09:00–20:00). |
| **Unknown-person intrusion** | A person whose face never matches a registered employee lingers ~12 s (needs face recognition enabled). |
| **Sleeping detection** | A person is motionless ~120 s **and** shows a sleeping posture (eyes shut / head down / face hidden on desk). |
| **Mobile usage** | A person holds a phone continuously ~45 s during working hours. |
| **Crowd detection** | ≥ 5 people are visible at once, sustained ~10 s. |
| **Camera offline** | The backend's monitor detects a camera stopped responding. |

It also does **employee face recognition** (optional) to name people in alerts
and to power the unknown-person rule. Employees (photo, name, id, email, phone)
are managed from the dashboard's **Employee Management** page — see §10/§11.

---

## 2. Architecture & data flow

Three independent services plus a database. They talk over HTTP/REST, SignalR
(WebSocket), and SMTP.

```
                 ┌─────────────────────────┐
   camera ─────▶ │  AI engine  (Python)    │   ai-engine/stream_server.py
   (RTSP/USB)    │  Flask · YOLO · MediaPipe│   http://localhost:5000
                 │                          │
                 │  /video   AI-annotated   │
                 │  /stream  relay any cam  │
                 │  /health  liveness       │
                 │  /reload-faces  re-sync  │
                 └───────────┬──────────────┘
                             │ 1. POST alert (+ copies screenshot
                             │    into the API's wwwroot/alerts)
                             ▼
                 ┌─────────────────────────┐        ┌──────────────┐
                 │  Backend API (.NET 8)   │◀──────▶│ PostgreSQL   │
                 │  http://localhost:5237  │   EF   │ AI_CCTV_System│
                 │                          │  Core  └──────────────┘
                 │  REST  /api/*            │
                 │  SignalR /alerthub       │── 2. email (SMTP/Gmail)
                 │  static  /alerts/*       │── 3. realtime push
                 └───────────┬──────────────┘
                             │ REST (poll) + SignalR (live)
                             ▼
                 ┌─────────────────────────┐
                 │  Frontend (Next.js)     │   frontend/
                 │  http://localhost:3001  │   browser dashboard
                 └─────────────────────────┘
```

**The alert lifecycle, end to end:**

1. The Python engine detects an event in its always-on detection worker
   (`_detection_loop`).
2. It saves a screenshot to `ai-engine/alerts/`, **copies** it into
   `backend/src/wwwroot/alerts/`, and `POST`s the alert JSON to
   `http://localhost:5237/api/alerts`.
3. The .NET `AlertsController.CreateAlert` saves the row, **sends an email**
   (with the screenshot inline + attached), and pushes a `NewAlert` event over
   SignalR.
4. The frontend receives the SignalR event (and/or its polling refresh) and
   updates the dashboard / alerts list / notification bell live.

**Why the engine and API both have a `wwwroot/alerts` story:** the engine writes
the file; the API *serves* it (static files at `/alerts/<name>`) and is the
source of truth for the alert record + email.

**Employee registry flow:** employees are created/edited in the dashboard →
stored by the API (DB + photos in `wwwroot/employees`) → the engine pulls them
from `GET /api/employees` (caching photos locally) on load or when the dashboard
calls `POST /reload-faces` after a change. The engine falls back to the bundled
`ai-engine/employees/employees.json` if the API is unreachable.

---

## 3. Repository layout

```
CctvSystem/
├── README.md                 Quick start
├── SETUP.md                  ← this document
├── .gitignore                Root ignores (per-project ignores live in each folder)
│
├── backend/                  .NET 8 Web API
│   ├── AI_CCTV_API.slnx      Solution (references src/AI_CCTV_API.csproj)
│   └── src/                  The project (namespace AI_CCTV_API)
│       ├── Program.cs        Startup: DI, CORS, DB bootstrap+seed, middleware
│       ├── appsettings.json  Connection string + email + logging  ⚠️ has secrets
│       ├── Controllers/      Alerts, Auth, Cameras, Employees, Recordings, Stats, Users
│       ├── Data/AppDbContext.cs   EF DbContext (Alerts, Users, Cameras, Employees)
│       ├── Models/           Alert, Camera, User, Employee
│       ├── Services/         AlertCleanupService, CameraMonitorService, PasswordHasher
│       ├── Hubs/AlertHub.cs  SignalR hub (/alerthub)
│       ├── Properties/launchSettings.json   Run profiles & ports
│       └── wwwroot/          Static files served by the API
│           ├── alerts/       Alert media (runtime output, git-ignored)
│           └── employees/    Employee reference photos ({id}.jpg)
│
├── ai-engine/                Python 3.11 detection engine
│   ├── stream_server.py      Main app: Flask + YOLO + MediaPipe + rules + relay
│   ├── face_db.py            Employee face recognition (optional, dlib)
│   ├── requirements.txt      Python dependencies
│   ├── employees/            Employee reference photos + employees.json
│   ├── alerts/               Local screenshot copies (runtime output, git-ignored)
│   ├── yolo11n.pt, yolov8n.pt        YOLO weights (committed for offline use)
│   ├── face_landmarker.task          MediaPipe face-mesh model
│   ├── openh264-1.8.0-win64.dll      H.264 codec for OpenCV video writes
│   ├── rtsp_test.py, find_camera_rtsp.py   Standalone RTSP discovery helpers
│   └── .gitignore
│
└── frontend/                 Next.js + TypeScript + Tailwind dashboard
    ├── .env.local            API & engine base URLs (git-ignored)
    ├── package.json          Scripts & deps (dev runs on port 3001)
    └── src/
        ├── app/              App Router pages
        │   ├── (app)/        Authenticated shell (sidebar layout) + pages:
        │   │                 dashboard, live-cameras, alerts, analytics, camera-mgmt,
        │   │                 employees, recordings, users, settings, ai-detection
        │   ├── login/        Login page
        │   └── layout.tsx, page.tsx
        ├── components/       sidebar, topbar, charts, ui, recent-alerts, theme-provider
        └── lib/              api.ts (REST client), auth.ts, data.ts,
                              use-alerts.ts (SignalR), use-fetch.ts, utils.ts
```

> Folders were renamed from the original `AI_CCTV_API` / `AI_CCTV_PY` /
> `ai-cctv-web` to `backend` / `ai-engine` / `frontend`. The **C# namespace is
> still `AI_CCTV_API`** (and the csproj/solution keep that name) — that's
> intentional; the namespace is code identity, independent of the folder.

---

## 4. Tech stack & versions

| Layer | Tech | Notes |
|---|---|---|
| Backend | **.NET 8** (ASP.NET Core Web API) | `net8.0`. `RollForward=LatestMajor` lets it run on a newer installed runtime (this machine has .NET 10). |
| ORM | **EF Core 8** + **Npgsql** | PostgreSQL provider. Tables are bootstrapped with raw SQL, not migrations (see §9). |
| Realtime | **SignalR** | Hub at `/alerthub`. |
| API docs | **Swagger / Swashbuckle** | Served at `/swagger`. |
| AI engine | **Python 3.11**, **Flask**, **Ultralytics YOLO** (yolo11n), **MediaPipe** (face landmarker), **OpenCV**, optional **face_recognition (dlib)** | |
| Database | **PostgreSQL** | DB name `AI_CCTV_System`. |
| Frontend | **Next.js (App Router)**, **React**, **TypeScript**, **Tailwind CSS**, **lucide-react**, **@microsoft/signalr**, **xlsx (SheetJS)** | Dev server on **port 3001**. `xlsx` parses CSV/Excel for employee bulk import. |

> **Python must be 3.11** for the AI libraries (mediapipe/dlib wheels). The note
> in this machine's environment about Python 3.13 in `stream_server.py` comments
> refers to API differences already handled in code — still install 3.11 to be safe.

---

## 5. Prerequisites

Install before you start:

| Tool | Version | Link |
|---|---|---|
| Python | **3.11** | <https://www.python.org/downloads/release/python-3119/> (tick "Add Python to PATH") |
| .NET SDK | **8** (9/10 also work via RollForward, but 8 is the target) | <https://dotnet.microsoft.com/en-us/download/dotnet/8> |
| Node.js + npm | Any LTS | <https://nodejs.org/> |
| PostgreSQL + pgAdmin | Any recent | <https://www.postgresql.org/download/> |
| Git | Any | <https://git-scm.com/downloads> |

On Windows, `face_recognition` (dlib) can be painful — see §10 and §15. The
system runs fine without it (you just lose employee names + unknown-intrusion).

---

## 6. First-time setup (step by step)

### 6.1 Clone

```bash
git clone <your-repo-url>
cd CctvSystem
```

### 6.2 PostgreSQL database

1. Open **pgAdmin** (or `psql`), connect to your local server.
2. Create a database named exactly **`AI_CCTV_System`**.
3. **That's it — do not create tables manually.** On first run the API creates
   the `Users`, `Alerts`, `Cameras`, and `Employees` tables (via `ExecuteSqlRaw`
   in [Program.cs](backend/src/Program.cs)) and seeds the admin account, the
   "Main Camera" row, and (best-effort) imports any existing employees from
   `ai-engine/employees/employees.json` + photos.

Create a PostgreSQL user/password the API will use, or use the default
`postgres` superuser. Whatever you choose must match the connection string in
the next step.

### 6.3 Backend API

Edit the connection string in
[backend/src/appsettings.json](backend/src/appsettings.json):

```json
"ConnectionStrings": {
  "DefaultConnection": "Host=localhost;Port=5432;Database=AI_CCTV_System;Username=postgres;Password=YOUR_PASSWORD;"
}
```

> ⚠️ The file currently contains a real-looking username/password
> (`abhishek/abhishek`) **and a live Gmail app password**. Change both — see §16.

Restore & run:

```bash
cd backend/src
dotnet restore
dotnet run --launch-profile http        # → http://localhost:5237  (Swagger at /swagger)
```

First run will print table creation + seeding logs. If you see
`relation "..." already exists`, that's fine — the SQL is idempotent.

### 6.4 AI engine

```bash
cd ai-engine
pip install -r requirements.txt          # ultralytics + torch are large; takes a few minutes
```

**Important — fix the hardcoded screenshot path.** Open
[ai-engine/stream_server.py](ai-engine/stream_server.py) and update
`API_ALERTS_FOLDER` (around line 280) to the absolute path of
`backend/src/wwwroot/alerts` **on your machine**:

```python
API_ALERTS_FOLDER = r"C:\path\to\CctvSystem\backend\src\wwwroot\alerts"
```

Set your camera source if you don't want the default RTSP camera (see §8), then:

```bash
python stream_server.py                  # → http://localhost:5000
```

Verify: open <http://localhost:5000/video> in a browser — you should see the
annotated feed. <http://localhost:5000/test-alert> fires a fake alert through
the whole pipeline (DB + email + dashboard) without waiting for a real event.

### 6.5 Frontend

The base URLs come from [frontend/.env.local](frontend/.env.local):

```
NEXT_PUBLIC_API_BASE=http://localhost:5237
NEXT_PUBLIC_ENGINE_BASE=http://localhost:5000
```

```bash
cd frontend
npm install
npm run dev                              # → http://localhost:3001
```

Open <http://localhost:3001>. Default login: **abhimorework@gmail.com / 123456**
(the seeded admin). Note the app is **not actually gated** — see §16.

---

## 7. Running the system day to day

Three terminals, **start the API first** (the engine POSTs to it, the frontend
reads from it):

```bash
# 1 — backend
cd backend/src && dotnet run --launch-profile http

# 2 — AI engine
cd ai-engine && python stream_server.py

# 3 — frontend
cd frontend && npm run dev
```

Ports: API **5237** (https 7090), engine **5000**, frontend **3001**.

---

## 8. Configuration reference

### Backend — [appsettings.json](backend/src/appsettings.json)

| Key | Purpose |
|---|---|
| `ConnectionStrings:DefaultConnection` | PostgreSQL connection string. |
| `EmailSettings:Mail` | SMTP "from" address (Gmail account). |
| `EmailSettings:Password` | SMTP password — a **Gmail App Password** (not the account password). |
| `EmailSettings:Host` / `Port` | `smtp.gmail.com` / `587`. |
| `EmailSettings:To` | Comma-separated alert recipients. |

Override locally without editing the committed file using
`appsettings.Development.json`, environment variables
(`ConnectionStrings__DefaultConnection=…`), or `dotnet user-secrets`.

### Backend — ports ([launchSettings.json](backend/src/Properties/launchSettings.json))

| Profile | URL |
|---|---|
| `http` | `http://localhost:5237` (used by the engine + frontend) |
| `https` | `https://localhost:7090` + http 5237 |
| `IIS Express` | 23206 / 44370 |

### AI engine — environment variables & in-file constants ([stream_server.py](ai-engine/stream_server.py))

Environment variables:

| Var | Default | Purpose |
|---|---|---|
| `CAMERA_SOURCE` | `rtsp://admin:abhishek@192.168.29.89:5543/live/channel1` | Primary camera. Set to `0` for the local webcam, or any `rtsp://…`. |
| `YOLO_MODEL` | `yolo11n.pt` | YOLO weights (falls back to `yolov8n.pt`). Use `yolo11s.pt` for better accuracy if the CPU/GPU can spare it. |
| `YOLO_IMGSZ` | `480` | YOLO input size; smaller = faster, less accurate for small/distant objects. |
| `FACE_EVERY` | `2` | Run the (costly) face mesh every Nth frame; raise for more FPS. |
| `STREAM_MAX_FPS` | `60` | Cap on how fast `/video` pushes frames (real FPS is bounded by the camera + detection speed). |
| `JPEG_QUALITY` | `70` | MJPEG quality; lower = smaller frames = less latency. |
| `API_BASE` | `http://localhost:5237` | Where the engine fetches the employee registry (`face_db.py`). |

Tunable detection constants (edit in the file — all near the top / inline):

| Constant | Default | Controls |
|---|---|---|
| `OFFICE_START_HOUR` / `OFFICE_END_HOUR` | 9 / 20 | Office open window (drives after-hours rules). |
| `SLEEP_SECONDS` | 120 | Motionless time before a sleep alert is even considered. |
| `MOVEMENT_THRESHOLD` | 35 | Max centre movement (px) still counted as "still". |
| `SMART_SLEEP_SECONDS` / `SMART_HEAD_SECONDS` | 5 / 5 | Eyes-shut / head-down duration confirming sleep. |
| `FACE_HIDDEN_SECONDS` | 8 | Face hidden (slumped on desk) → counts as sleep. |
| `HEAD_DOWN_RATIO` | 0.70 | Nose-position ratio classed as "head down". |
| `MOBILE_SECONDS` | 45 | Phone-in-hand duration → mobile-usage alert. |
| `CROWD_THRESHOLD` / `CROWD_SECONDS` | 5 / 10 | People count + sustain time for a crowd alert. |
| `CROWD_ACTIVE_MODE` | `"always"` | `always` / `after_hours` / `working_hours`. |
| `INTRUDER_MIN_SECONDS` | 12 | Unknown face lingering before intrusion fires. |
| `ALERT_COOLDOWN_SECONDS` | 180 | Min seconds between two alerts of the same type. |
| `RULES` dict | all `True` | Master on/off switches per rule. |
| `API_URL` | `http://localhost:5237/api/alerts` | Where alerts are POSTed. |
| `API_ALERTS_FOLDER` | hardcoded absolute path | **Must be edited per machine** (see §6.4 / §16). |
| Relay: `RELAY_ALLOWED_SCHEMES`, `RELAY_IDLE_TIMEOUT` (30s), `RELAY_OPEN_TIMEOUT` (8s) | | The `/stream` multi-camera relay. |

### Frontend — [.env.local](frontend/.env.local)

| Var | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | `http://localhost:5237` | Backend REST + SignalR + alert media. |
| `NEXT_PUBLIC_ENGINE_BASE` | `http://localhost:5000` | Python engine `/video` + `/stream` relay. |

---

## 9. How the backend (.NET API) works

Entry point [Program.cs](backend/src/Program.cs):

- **DB bootstrap (no migrations).** On startup it runs raw SQL
  (`CREATE TABLE IF NOT EXISTS …`, `ADD COLUMN IF NOT EXISTS …`) for `Users`,
  `Alerts`, `Cameras`, `Employees`, then seeds the admin user, the "Main Camera",
  and (one-time, best-effort) imports the engine's existing `employees.json` +
  photos into `Employees` and `wwwroot/employees`. This is why no `dotnet ef`
  step is needed. If you change a model, add the matching SQL here (or switch to
  EF migrations).
- **`Npgsql.EnableLegacyTimestampBehavior`** is switched on because the app
  stores local `DateTime.Now` into `timestamp without time zone` columns.
- **CORS** policy `AllowFrontend` allows `http://localhost:3001` (and `:3000`).
- **Static files**: `wwwroot` is served, so alert images live at
  `http://localhost:5237/alerts/<file>` and employee photos at
  `http://localhost:5237/employees/<id>.jpg`.
- **Hosted background services** (registered here): `AlertCleanupService` and
  `CameraMonitorService`.
- **SignalR** hub mapped at `/alerthub`.

### Controllers

| Controller | Routes | Notes |
|---|---|---|
| [AlertsController](backend/src/Controllers/AlertsController.cs) | `GET/POST /api/alerts`, `PUT /api/alerts/{id}/close`, `DELETE /api/alerts/{id}`, `DELETE /api/alerts`, `GET /alerts/{file}` | `POST` saves + **emails** + SignalR `NewAlert`. Delete also removes the media file(s). |
| [CamerasController](backend/src/Controllers/CamerasController.cs) | `GET/POST /api/cameras`, `GET/PUT/DELETE /api/cameras/{id}` | Full CRUD — this is what the Camera Management page uses. |
| [EmployeesController](backend/src/Controllers/EmployeesController.cs) | `GET/POST /api/employees`, `GET/PUT/DELETE /api/employees/{id}`, `POST /api/employees/bulk` | CRUD with a mandatory `.jpg/.jpeg` photo (multipart). `bulk` upserts parsed CSV/Excel rows and **skips invalid rows**, returning a per-row report. |
| [AuthController](backend/src/Controllers/AuthController.cs) | `POST /api/auth/{register,login,change-password}` | PBKDF2 password check. Returns a base64-GUID "token" that is **not** validated anywhere. |
| [StatsController](backend/src/Controllers/StatsController.cs) | `GET /api/stats`, `GET /api/stats/analytics` | Dashboard cards + charts, computed live from the DB. |
| [RecordingsController](backend/src/Controllers/RecordingsController.cs) | `GET /api/recordings` | Lists files in `wwwroot/alerts`, pairing `.mp4` clips with `.jpg` posters and parsing the timestamp from the filename. |
| [UsersController](backend/src/Controllers/UsersController.cs) | `GET /api/users`, `DELETE /api/users/{id}` | |

### Services

- **[PasswordHasher](backend/src/Services/PasswordHasher.cs)** — PBKDF2-SHA256,
  100k iterations, random 16-byte salt. Stored as `base64(salt).base64(hash)`.
  Constant-time compare. No external packages.
- **[AlertCleanupService](backend/src/Services/AlertCleanupService.cs)** — every
  6 h (15 s after startup) deletes alerts **older than 7 days** plus their media
  files. Change `Retention` / `Interval` here.
- **[CameraMonitorService](backend/src/Services/CameraMonitorService.cs)** —
  every 30 s (12 s after startup) checks each camera's reachability:
  - URL ends with `/video` → query the engine's `/health` (true camera liveness).
  - `rtsp://` / `rtmp://` → **TCP connect** to host:port (added for user RTSP
    cameras so they report online correctly).
  - otherwise → HTTP `GET` (headers only).
  On an online→offline transition it writes a `Camera Offline` alert, pushes
  `CameraStatusChanged` over SignalR, and emails recipients (5-min per-camera
  cooldown).

### Email

Both `AlertsController.SendEmailAlert` and the monitor's `SendOfflineEmail` use
`System.Net.Mail.SmtpClient` with the `EmailSettings`. Alert emails embed the
screenshot inline (`cid:snapshot`) and attach the media file. Recognized
employees are also CC'd if their email is on the alert.

### SignalR events (hub `/alerthub`)

`NewAlert`, `AlertUpdated`, `AlertDeleted`, `AlertsCleared`,
`CameraStatusChanged`. The frontend subscribes in
[use-alerts.ts](frontend/src/lib/use-alerts.ts).

---

## 10. How the AI engine (Python) works

Everything is in [stream_server.py](ai-engine/stream_server.py) (~1000 lines).

**Models loaded at startup:** YOLO (`yolo11n.pt`, person + cell-phone classes),
MediaPipe `FaceLandmarker` (478-point mesh → eye-aspect-ratio + head pose), and
optionally the employee face DB via [face_db.py](ai-engine/face_db.py).

**`FrameGrabber`** runs a background thread that constantly reads the camera and
keeps only the **latest** frame (so AI processing never makes the feed lag), plus
a rolling buffer of recent frames. It auto-reconnects if the feed drops, and
`last_ok` powers the `/health` endpoint.

**Detection is decoupled from streaming (perf).** An always-on worker thread
`_detection_loop()` does the heavy lifting and publishes the latest annotated
JPEG; the `/video` route (`generate_frames()`) is a thin streamer that just
pushes that JPEG. So detection runs once regardless of how many browsers watch,
the feed isn't gated by per-frame inference, and **alerts fire 24/7 even with no
viewer** (previously detection only ran while `/video` was open).

`_detection_loop()` each pass:
1. YOLO inference (`imgsz=YOLO_IMGSZ`) → person & phone boxes.
2. MediaPipe face mesh **every `FACE_EVERY` frames** (reused in between) → eyes/head.
3. `PersonTracker` matches boxes to tracks by nearest centre, so each person has
   their **own** motion/eyes/head/phone timers (fixes multi-person mixups).
4. Per-person rules (sleeping, mobile, unknown-intrusion) + whole-frame rules
   (after-hours intrusion, crowd).
5. Draw overlays (incl. the live measured FPS), JPEG-encode, publish for the streamer.

**FPS / performance.** The real frame rate is bounded by the camera's delivered
rate and CPU inference speed. To push it up: lower `YOLO_IMGSZ` (e.g. 320), raise
`FACE_EVERY`, use a faster/lower-res source, or run YOLO on a CUDA GPU. The number
drawn next to "Persons:" on the feed is the **measured** detection FPS (the camera
record's `fps` field is just a static label). True 60 fps needs a 60 fps source.

**Face recognition** runs in a *separate* background thread
(`_recognition_worker`) every ~1 s so dlib never stalls the video. It publishes
recognized faces; the video loop maps them onto person tracks with a sticky,
vote-based identity (a brief mis-recognition can't relabel someone).

**Raising an alert** (`create_alert` → `_produce_screenshot_alert`): enforces the
per-type cooldown, saves a screenshot to `ai-engine/alerts/`, copies it into the
API's `wwwroot/alerts`, and POSTs the alert (with the served image URL, and any
recognized employee) to the API — all off the detection thread.

**HTTP endpoints:**

| Route | Purpose |
|---|---|
| `GET /video` | The AI-annotated MJPEG feed for the **primary** camera. |
| `GET /stream?src=<url>` | **Relay**: decode any `rtsp/rtmp/http` source (or webcam index) and re-stream as MJPEG so the browser can show it. Used for user-added cameras. One decode shared by all viewers; stops when idle. |
| `GET /health` | `{camera: online/offline}` based on frame freshness — used by the .NET monitor. |
| `GET /test-alert` | Fire a manual alert through the whole pipeline. |
| `GET/POST /reload-faces` | Reload the employee registry from the API without restarting (the dashboard calls this after employee changes). |

**Employee faces ([face_db.py](ai-engine/face_db.py)):** on load (startup and on
`POST /reload-faces`) the engine fetches the registry from the API
(`GET /api/employees`), downloads each photo into `employees/_cache/`, and encodes
the faces. If the API is unreachable it **falls back** to the bundled
`employees/employees.json` + local photos, so recognition still works offline. If
`face_recognition`/dlib isn't installed, recognition is disabled gracefully
(`FaceRec OFF` shown on the feed). Manage employees from the dashboard (§11), not
by editing JSON.

> **Single-camera AI.** The full pipeline + all the global rule state
> (`person_tracker`, `alert_sent`, `_crowd_start`, cooldowns) run for the one
> primary camera only. User-added cameras are **live view only** via `/stream`.
> Multi-camera AI would require per-camera instances of that state — a real
> refactor (see §17).

---

## 11. How the frontend (Next.js) works

App Router under [frontend/src/app](frontend/src/app). The `(app)` route group
wraps the authenticated pages in a sidebar/topbar shell
([(app)/layout.tsx](frontend/src/app/(app)/layout.tsx)).

**Pages:** `dashboard`, `live-cameras`, `alerts`, `analytics`, `camera-mgmt`,
`employees`, `recordings`, `users`, `settings`, `ai-detection`, plus `login` and
the root.

**Data layer ([lib/api.ts](frontend/src/lib/api.ts)):** a thin typed `fetch`
client. Notable helpers:
- `API_BASE` / `ENGINE_BASE` from env.
- `mediaUrl()` — resolves a relative alert path to an absolute backend URL.
- `cameraFeedUrl(cam)` — **routes `rtsp://`/`rtmp://` cameras through the engine
  relay** (`{ENGINE_BASE}/stream?src=…`) and returns plain `http(s)` MJPEG URLs
  as-is. This is what makes added RTSP cameras displayable.
- `getEmployees` / `createEmployee` / `updateEmployee` / `deleteEmployee` /
  `bulkUpsertEmployees` — employee CRUD + bulk import (multipart for photos).
  `reloadEngineFaces()` pings the engine's `/reload-faces` (best-effort) after a
  change so recognition updates without a restart.

**Live updates:** [use-alerts.ts](frontend/src/lib/use-alerts.ts) opens a SignalR
connection to `/alerthub` for push updates; [use-fetch.ts](frontend/src/lib/use-fetch.ts)
is a small polling hook (e.g. Live Cameras re-polls every 10 s so status flips
show up).

**Live Cameras** ([live-cameras/page.tsx](frontend/src/app/(app)/live-cameras/page.tsx))
renders each online camera's feed as an `<img src={cameraFeedUrl(cam)}>` (MJPEG),
with a fullscreen overlay and a NO-SIGNAL fallback on error.

**Camera Management** ([camera-mgmt/page.tsx](frontend/src/app/(app)/camera-mgmt/page.tsx))
is full CRUD over `/api/cameras`. The **Add Camera** form takes Name, Location,
IP, **Stream URL** (paste an `rtsp://…` here), Resolution, FPS, Status, Uptime,
PTZ, Recording. New cameras default to `online` and appear under Live Cameras
immediately.

**Employee Management** ([employees/page.tsx](frontend/src/app/(app)/employees/page.tsx))
— the face-recognition registry (distinct from **Users**, which are dashboard
logins). Add/edit employees with a mandatory **.jpg/.jpeg photo**, name, id, email
and optional phone. **Bulk Import** parses a CSV/Excel file client-side (SheetJS)
with columns `id, name, email, phone`, previews valid vs skipped rows, then calls
`POST /api/employees/bulk` which upserts the good rows and reports the skipped
ones. Every change pings the engine to reload faces. Note: `id` is a positive
integer (it matches the `EmployeeId` stored on alerts) and is fixed once set.

**Auth ([lib/auth.ts](frontend/src/lib/auth.ts)):** purely client-side. Login
calls `/api/auth/login`; the result is kept in `localStorage`. If nothing is
stored, `DEFAULT_AUTH` returns the seeded admin — so **the UI always renders as
logged-in** (there is no route guard). See §16.

---

## 12. Database schema

PostgreSQL, DB `AI_CCTV_System`. All tables are created by raw SQL on API
startup. Column names are quoted PascalCase (EF default mapping).

**Users**

| Column | Type |
|---|---|
| `UserId` | serial PK |
| `Email` | varchar(200) unique |
| `PasswordHash` | varchar(500) — `base64(salt).base64(hash)` |
| `Role` | varchar(50) (`Admin` / `User`) |
| `CreatedDate` | timestamp |

**Cameras**

| Column | Type / default |
|---|---|
| `CameraId` | serial PK |
| `Name` | varchar(200) |
| `Location` | varchar(200) `''` |
| `IpAddress` | varchar(100) `''` |
| `StreamUrl` | varchar(500) `''` — `http://…/video` or `rtsp://…` |
| `Status` | varchar(50) `online` |
| `Resolution` | varchar(50) `1920x1080` |
| `Fps` | int `0` |
| `Ptz` / `Recording` | bool |
| `Uptime` | double `100` |
| `CreatedDate` | timestamp |

**Alerts**

| Column | Type |
|---|---|
| `AlertId` | serial PK |
| `AlertType` | varchar(200) (e.g. `Intrusion`, `Sleeping Detection`, `Mobile Usage Detection`, `Crowd Detection`, `Camera Offline`) |
| `CameraName` | varchar(200) |
| `AlertTime` | timestamp |
| `ScreenshotPath` | varchar(500) — full URL to the media |
| `Status` | varchar(50) (`Open` / `Closed`) |
| `CreatedDate` | timestamp |
| `EmployeeName` / `EmployeeId` / `EmployeeEmail` | added for face recognition |

**Employees**

| Column | Type |
|---|---|
| `Id` | int PK — operator-supplied business id (not auto-increment) |
| `Name` | varchar(200) |
| `Email` | varchar(200) |
| `Phone` | varchar(50), nullable |
| `PhotoPath` | varchar(500) — e.g. `/employees/1.jpg` (empty if none) |
| `CreatedDate` | timestamp |

---

## 13. HTTP API reference

Base: `http://localhost:5237`. Interactive docs at `/swagger`.

```
# Alerts
GET    /api/alerts                 list (newest first)
POST   /api/alerts                 create (engine uses this) → emails + SignalR
PUT    /api/alerts/{id}/close      mark Closed
DELETE /api/alerts/{id}            delete + remove media
DELETE /api/alerts                 delete all
GET    /alerts/{fileName}          fetch an alert image (also served statically)

# Cameras
GET    /api/cameras                list
POST   /api/cameras                create
GET    /api/cameras/{id}           one
PUT    /api/cameras/{id}           update
DELETE /api/cameras/{id}           delete

# Employees  (multipart for create/update; photo required on create)
GET    /api/employees              list
POST   /api/employees              create (id,name,email,phone?,photo)
GET    /api/employees/{id}         one
PUT    /api/employees/{id}         update (photo optional)
DELETE /api/employees/{id}         delete + remove photo
POST   /api/employees/bulk         upsert JSON rows; skips invalid → summary

# Auth
POST   /api/auth/register          {email,password}
POST   /api/auth/login             {email,password} → {email,role,token}
POST   /api/auth/change-password   {email,currentPassword,newPassword}

# Stats / Users / Recordings
GET    /api/stats                  dashboard summary
GET    /api/stats/analytics        charts + per-camera performance
GET    /api/users                  list
DELETE /api/users/{id}             delete
GET    /api/recordings             list captured media

# Realtime
WS     /alerthub                   SignalR (NewAlert, AlertUpdated, AlertDeleted,
                                    AlertsCleared, CameraStatusChanged)

# AI engine (http://localhost:5000) — separate Flask app, not the .NET API
GET    /video                      AI-annotated MJPEG feed (primary camera)
GET    /stream?src=<url>           relay any rtsp/rtmp/http source as MJPEG
GET    /health                     camera liveness
GET    /test-alert                 fire a test alert
POST   /reload-faces               reload the employee face registry
```

---

## 14. Common tasks / how-to

**Add a camera (RTSP).** Dashboard → **Camera Management → Add Camera** → paste
the camera's `rtsp://user:pass@host:port/path` into **Stream URL** → Save. It
appears under **Live Cameras** (relayed via the engine). No code changes.
Requires the AI engine to be running for the picture to load.

**Point the AI at a different primary camera.** Set the `CAMERA_SOURCE` env var
(or edit the default in `stream_server.py`) and restart the engine. `0` = local
webcam.

**Tune a detection rule.** Edit the relevant constant in `stream_server.py`
(see §8 table) and restart the engine. Toggle a rule entirely via the `RULES`
dict.

**Register an employee for face recognition.** Dashboard → **Employees → Add
Employee** → upload a clear `.jpg/.jpeg` headshot + name/id/email (phone
optional). Or **Bulk Import** a CSV/Excel of `id,name,email,phone`. Recognition
needs `face_recognition`/dlib installed on the engine; the dashboard pings
`/reload-faces` automatically, so no restart is needed.

**Increase the video FPS.** Run the engine with cheaper settings, e.g.
`$env:YOLO_IMGSZ=320; $env:FACE_EVERY=3; python stream_server.py` (bash:
`YOLO_IMGSZ=320 FACE_EVERY=3 python stream_server.py`). The ceiling is the
camera's delivered rate + CPU; a CUDA GPU or a faster/lower-res source is the
real lever. See §10.

**Change alert retention.** Edit `Retention` in `AlertCleanupService.cs`
(default 7 days).

**Change who gets alert emails.** `EmailSettings:To` in `appsettings.json`
(comma-separated).

**Change ports.** API: `launchSettings.json`. Frontend: `package.json` `dev`
script (`-p 3001`). Engine: the `app.run(..., port=5000)` line. Update CORS
(`Program.cs`) and the frontend env if you change them.

---

## 15. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Frontend says "Couldn't reach the API" | Backend not running / wrong `NEXT_PUBLIC_API_BASE`. Start the API first. |
| Live camera shows **NO SIGNAL** | Camera offline, the engine isn't running, or the RTSP URL/creds are wrong. For RTSP, confirm the engine is up and try `http://localhost:5000/stream?src=<your-rtsp>` directly. |
| Primary `/video` is blank | Wrong `CAMERA_SOURCE`, camera unreachable, or wrong RTSP credentials/port. |
| Alerts fire but no image on the dashboard | `API_ALERTS_FOLDER` in `stream_server.py` points to the wrong path — fix it to *this machine's* `backend/src/wwwroot/alerts`. |
| No emails | `EmailSettings` wrong, or Gmail needs an **App Password** (not the account password) with 2FA enabled. |
| `FaceRec OFF` on the feed | `face_recognition`/dlib not installed, or no employee photos. On Windows: install CMake + a prebuilt dlib wheel matching your Python version, then `pip install face_recognition`. |
| `dotnet run` framework error | .NET 8 runtime missing. `RollForward=LatestMajor` should use a newer runtime, but install .NET 8 if it complains. |
| Postgres connection refused | Service not running, or wrong host/port/credentials in the connection string. |
| Camera flips offline for RTSP cams | The camera's RTSP TCP port isn't reachable from the API host (firewall / wrong port). |
| Folder rename / file lock on Windows | Stop the running dev servers and delete `backend/src/bin` + `obj` if a build process holds them. |

---

## 16. ⚠️ Security & production hardening (read this)

This is a working internal/demo system. Before exposing it beyond a trusted LAN,
address these:

1. **Committed secrets.** [appsettings.json](backend/src/appsettings.json)
   contains a real **Gmail App Password** and DB credentials in git history.
   **Rotate the Gmail app password now**, move secrets to environment variables
   / `dotnet user-secrets` / a vault, and stop committing them.
2. **No real authentication or authorization.** The login "token" is a random
   base64 GUID that is **never validated** by the API, and **every endpoint is
   open**. The frontend has no route guard — `DEFAULT_AUTH` makes it always
   render as the admin. Anyone who can reach the API can read/delete everything.
   Add real auth (JWT + `[Authorize]`) before any untrusted exposure.
3. **RTSP credentials in the clear.** Camera `StreamUrl` (often
   `rtsp://user:pass@…`) is stored plaintext in the DB and sent to the browser
   (and appears in the `/stream?src=` query). Acceptable on a private LAN; not
   for the public internet.
4. **Hardcoded absolute path** `API_ALERTS_FOLDER` in `stream_server.py` — breaks
   on any other machine. Make it relative to the repo (e.g. derived from
   `__file__`) or an env var.
5. **CORS / hosts** are dev-oriented (`localhost`, `AllowedHosts: *`). Lock down
   for deployment.
6. **The engine's `/stream` relay is an open proxy** to any `rtsp/rtmp/http`
   URL on its network. Fine on a closed LAN; gate it (allowlist / auth) if the
   engine is reachable by untrusted clients.
7. **Default seeded admin** `abhimorework@gmail.com / 123456` — change it.

---

## 17. Known limitations & tech debt

- **Single-camera AI.** Only the primary `/video` camera runs detection; added
  cameras are live-view only. Multi-camera AI needs the global rule state
  (`PersonTracker`, cooldowns, crowd/intrusion flags) refactored into per-camera
  instances, plus a per-camera detection thread + endpoint.
- **Detection worker has no self-restart.** `_detection_loop` runs in one daemon
  thread; an unhandled exception there stops the feed until the engine restarts.
  Worth wrapping the loop body in try/except.
- **Employee `id` must be a positive integer** (to match `EmployeeId` on alerts).
  Alphanumeric employee codes would need a schema/type change across the API,
  engine, and alerts.
- **No EF migrations.** Schema lives as raw SQL in `Program.cs`. Model changes
  must be mirrored there by hand (or migrate to EF migrations).
- **Recordings are screenshots only.** The code mentions video clips, but
  `_produce_screenshot_alert` intentionally saves a single JPG (clips ate too
  much disk). The Recordings page still supports `.mp4` if any exist.
- **`ai-detection` / some dashboard widgets** may show derived/placeholder data;
  verify against the live API before relying on them.
- **`PasswordHasher`** is sound (PBKDF2), but the auth flow around it isn't (see
  §16 #2).
- **Frontend lint** has a few pre-existing `react-hooks` warnings in
  `use-fetch.ts` / `use-alerts.ts` / `auth.ts` / `settings` / `theme-provider`.
  Not blocking; worth cleaning up.

---

*Questions the previous dev would answer: most "why is it like this?" answers are
in the inline comments — `stream_server.py` and `Program.cs` in particular are
heavily commented. Start there.*
