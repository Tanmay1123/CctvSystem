# AI CCTV System

An AI-powered CCTV monitoring system that runs object/behaviour detection on a
camera feed and surfaces alerts (intrusion, crowding, sleeping, mobile-phone
usage, …) through a web dashboard in real time.

## Architecture

The repo is a small monorepo of three independent services:

| Folder | Stack | Role |
|---|---|---|
| [`backend/`](backend/) | .NET 8 Web API + SignalR + EF Core | REST API + real-time alert hub, backed by PostgreSQL. Serves alert screenshots from `wwwroot/alerts`. The .NET project lives in [`backend/src`](backend/src). |
| [`ai-engine/`](ai-engine/) | Python 3.11 + Flask + Ultralytics YOLO + MediaPipe | The AI engine. Reads the camera, runs detection, streams the annotated video, and POSTs alerts to the API. |
| [`frontend/`](frontend/) | Next.js + TypeScript + Tailwind | The web dashboard (live cameras, alerts, analytics, user/camera management). |

Data flow:

```
camera ──▶ ai-engine (stream_server.py)
                │  POST alert + screenshot
                ▼
          backend (:5237) ──▶ PostgreSQL
                │  REST + SignalR (/alerthub)
                ▼
          frontend (:3001)  ◀── browser
```

## Prerequisites

| Tool | Version |
|---|---|
| Python | **3.11** |
| .NET SDK | **8** |
| Node.js + npm | LTS |
| PostgreSQL | Any recent |

## Setup

### 1. Database

Create an empty PostgreSQL database named `AI_CCTV_System`. The API creates its
tables and seeds the default admin/camera on first startup — **no manual SQL is
required.**

### 2. API — `backend/src`

Set your PostgreSQL credentials in
[`backend/src/appsettings.json`](backend/src/appsettings.json):

```json
"ConnectionStrings": {
  "DefaultConnection": "Host=localhost;Port=5432;Database=AI_CCTV_System;Username=postgres;Password=YOUR_PASSWORD;"
}
```

> Don't commit this file with a real password. Use
> `appsettings.Development.json` / user-secrets for local overrides.

```bash
cd backend/src
dotnet restore
dotnet run --launch-profile http      # → http://localhost:5237
```

### 3. AI engine — `ai-engine`

```bash
cd ai-engine
pip install -r requirements.txt
python stream_server.py               # Flask on http://localhost:5000
```

Useful environment variables (all optional):

| Var | Default | Purpose |
|---|---|---|
| `CAMERA_SOURCE` | (configured RTSP url) | Set to `0` to use a local webcam, or an `rtsp://…` url. |
| `YOLO_MODEL` | `yolo11n.pt` | YOLO weights to load (falls back to `yolov8n.pt`). |

Model weights (`yolo11n.pt`, `yolov8n.pt`, `face_landmarker.task`) and the
`openh264` DLL are committed so the engine runs offline out of the box.
`rtsp_test.py` / `find_camera_rtsp.py` are standalone helpers for locating an
RTSP stream.

### 4. Web dashboard — `frontend`

The API base URL is read from `NEXT_PUBLIC_API_BASE` (see `.env.local`,
defaults to `http://localhost:5237`).

```bash
cd frontend
npm install
npm run dev                            # → http://localhost:3001
```

## Running everything

Start the three services in separate terminals — **API first**, then the AI
engine, then the web app:

```bash
# terminal 1
cd backend/src && dotnet run --launch-profile http

# terminal 2
cd ai-engine && python stream_server.py

# terminal 3
cd frontend && npm run dev
```

Then open <http://localhost:3001>.

## Notes

- Detection screenshots are written to `backend/src/wwwroot/alerts/` and
  `ai-engine/alerts/`. These are runtime output and are git-ignored.
- CORS: make sure the API is running before the web app so requests aren't
  blocked.
- **Adding cameras:** add any camera from **Camera Management → Add Camera** by
  pasting its `rtsp://` URL — no code changes needed. Browsers can't play RTSP,
  so the engine relays it to MJPEG at `/stream?src=…`; it then appears under
  **Live Cameras**. An `http(s)` MJPEG URL (like the AI feed
  `http://localhost:5000/video`) is shown directly. The full AI pipeline runs on
  the primary `/video` camera; added cameras are live-view only.
</content>


Now suppose i am handing this project to fellow office dev and exiting myself from it i want you to create a SETUP.md files in great depth with every technical detail you could give him (what is ths project how do you do this and that how to gte steup)