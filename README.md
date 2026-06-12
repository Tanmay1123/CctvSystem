# AI CCTV System — Setup Guide

This project uses **PostgreSQL** for the database, **.NET 8** for the API, **Python 3.11** for the AI engine, and **Angular** for the frontend.

---

## Prerequisites

Install all of these before starting:

| Tool | Version | Download |
|---|---|---|
| Python | **3.11 exactly** | https://www.python.org/downloads/release/python-3119/ |
| .NET SDK | **8 exactly** | https://dotnet.microsoft.com/en-us/download/dotnet/8 |
| Node.js + npm | Any LTS | https://nodejs.org/ |
| PostgreSQL + pgAdmin | Any recent | https://www.postgresql.org/download/ |
| Git | Any | https://git-scm.com/downloads |

> ⚠️ **.NET version matters.** The project targets `net8.0`. If you install version 9 or 10 it will not run.

> ⚠️ **Mac only:** Do NOT install Python via Homebrew — it has a known incompatibility with the current macOS system library. Use the official `.pkg` installer from the python.org link above (download the "macOS 64-bit universal2 installer").

---

## Windows Setup (full walkthrough)

### 1. Install prerequisites

Download and install each item from the table above. For PostgreSQL, the Windows installer from postgresql.org includes pgAdmin — tick that box during installation. When it asks you to set a password for the `postgres` user, **write it down** — you'll need it later.

After installing Python 3.11, open Command Prompt and verify:
```
python --version
pip --version
```
Both should show. If `python` isn't found, re-run the Python installer and tick **"Add Python to PATH"**.

After installing .NET 8, verify:
```
dotnet --version
```
Should show `8.x.x`.

### 2. Clone the repo

```
git clone https://github.com/Tanmay1123/CctvSystem.git
cd CctvSystem
```

### 3. PostgreSQL database setup

Open **pgAdmin 4** (installed with PostgreSQL). In the left sidebar, expand `Servers → PostgreSQL` and connect using your postgres password.

**Create the database:**
Right-click `Databases → Create → Database`, name it exactly: `AI_CCTV_System`, then click Save.

**Create the Alerts table:**
Click on `AI_CCTV_System`, then open the Query Tool (Tools menu → Query Tool) and paste and run:

```sql
CREATE TABLE "Alerts" (
    "AlertId"        SERIAL PRIMARY KEY,
    "AlertType"      VARCHAR(100),
    "CameraName"     VARCHAR(100),
    "AlertTime"      TIMESTAMP,
    "ScreenshotPath" VARCHAR(500),
    "Status"         VARCHAR(50),
    "CreatedDate"    TIMESTAMP
);
```

Click the play button (▶) to run it. You should see "Query returned successfully".

### 4. Set your connection string

Open `AI_CCTV_API\AI_CCTV_API\appsettings.json` in any text editor and replace `YOUR_PASSWORD` with the postgres password you set during installation:

```json
"ConnectionStrings": {
  "DefaultConnection": "Host=localhost;Port=5432;Database=AI_CCTV_System;Username=postgres;Password=YOUR_PASSWORD;"
}
```

> Do not commit this file to git with your real password in it.

### 5. Fix the alerts folder path

Open `AI_CCTV_PY\stream_server.py` and find the `API_ALERTS_FOLDER` line. Replace it with the actual path to where you cloned the repo:

```python
API_ALERTS_FOLDER = r"C:\Users\YOUR_USERNAME\Desktop\CctvSystem\AI_CCTV_API\AI_CCTV_API\wwwroot\alerts"
```

Use your actual Windows username and the actual path — right-click the `wwwroot\alerts` folder in Explorer and choose "Copy as path" to get the exact string.

### 6. Install Python packages

Open Command Prompt, navigate to the project and install:

```
cd AI_CCTV_PY
pip install ultralytics opencv-python flask flask-cors mediapipe requests psycopg2-binary urllib3
```

This will take a few minutes — ultralytics and torch are large downloads.

### 7. Install .NET packages

```
cd AI_CCTV_API\AI_CCTV_API
dotnet restore
```

Trust the HTTPS dev certificate (first time only):
```
dotnet dev-certs https --trust
```
A popup will appear asking you to confirm — click Yes.

### 8. Install frontend packages

```
cd AI_CCTV_UI
npm install
```

If Angular CLI is not installed:
```
npm install -g @angular/cli
```

### 9. Run the project

Open **three separate Command Prompt windows** and run one command in each:

**Window 1 — .NET API:**
```
cd AI_CCTV_API\AI_CCTV_API
dotnet run
```
Wait until you see: `Now listening on: http://localhost:5237`

**Window 2 — Python AI engine:**
```
cd AI_CCTV_PY
python main.py
```

**Window 3 — Frontend:**
```
cd AI_CCTV_UI
ng serve
```
Wait until you see: `Application bundle generation complete`

Then open your browser at **http://localhost:4200**

---

## Mac Setup (full walkthrough)

### 1. Install prerequisites

Download and install each item from the prerequisites table. For Python, use the `macOS 64-bit universal2 installer` `.pkg` file from python.org — not Homebrew.

For .NET 8, you can use either the official Microsoft installer or Homebrew:
```bash
brew install dotnet@8
```

If you used Homebrew, add these lines to your `~/.zshrc` so the terminal finds .NET 8:
```bash
export DOTNET_ROOT="/opt/homebrew/opt/dotnet@8/libexec"
export PATH="/opt/homebrew/opt/dotnet@8/bin:$PATH"
export PATH="$PATH:/Users/YOUR_USERNAME/.dotnet/tools"
```
Then run `source ~/.zshrc`. Verify with `dotnet --version` — should show `8.x.x`.

### 2. Clone the repo

```bash
git clone https://github.com/Tanmay1123/CctvSystem.git
cd CctvSystem
```

### 3. PostgreSQL database setup

Open **pgAdmin 4**. Connect to your local server (password is whatever you set during PostgreSQL installation).

**Create the database:**
Right-click `Databases → Create → Database`, name it exactly: `AI_CCTV_System`, click Save.

**Create the Alerts table:**
Click on `AI_CCTV_System`, open Query Tool (Tools → Query Tool), paste and run:

```sql
CREATE TABLE "Alerts" (
    "AlertId"        SERIAL PRIMARY KEY,
    "AlertType"      VARCHAR(100),
    "CameraName"     VARCHAR(100),
    "AlertTime"      TIMESTAMP,
    "ScreenshotPath" VARCHAR(500),
    "Status"         VARCHAR(50),
    "CreatedDate"    TIMESTAMP
);
```

### 4. Set your connection string

Open `AI_CCTV_API/AI_CCTV_API/appsettings.json` and replace `YOUR_PASSWORD`:

```json
"ConnectionStrings": {
  "DefaultConnection": "Host=localhost;Port=5432;Database=AI_CCTV_System;Username=postgres;Password=YOUR_PASSWORD;"
}
```

### 5. Fix the alerts folder path

Open `AI_CCTV_PY/stream_server.py` and update `API_ALERTS_FOLDER`:

```python
API_ALERTS_FOLDER = "/Users/YOUR_USERNAME/path/to/CctvSystem/AI_CCTV_API/AI_CCTV_API/wwwroot/alerts"
```

### 6. Install Python packages

```bash
/usr/local/bin/python3.11 -m pip install ultralytics opencv-python flask flask-cors mediapipe requests psycopg2-binary urllib3
```

### 7. Install .NET packages

```bash
cd AI_CCTV_API/AI_CCTV_API
dotnet restore
dotnet dev-certs https --trust
```

### 8. Install frontend packages

```bash
cd AI_CCTV_UI
npm install
```

### 9. Run the project

Open **three separate terminal tabs/windows**:

**Tab 1 — .NET API:**
```bash
cd AI_CCTV_API/AI_CCTV_API
dotnet run
```

**Tab 2 — Python AI engine:**
```bash
cd AI_CCTV_PY
python3.11 main.py
```

**Tab 3 — Frontend:**
```bash
cd AI_CCTV_UI
ng serve
```

Then open **http://localhost:4200**

---

## Troubleshooting

**Windows: `pip` not found**
Re-run the Python 3.11 installer, click "Modify", and make sure "Add Python to environment variables" is ticked. Then restart Command Prompt.

**Windows: `dotnet` not found**
Re-run the .NET 8 installer. Restart Command Prompt after installing.

**Windows: `ng` not found**
Run `npm install -g @angular/cli`, then restart Command Prompt.

**Windows: PostgreSQL connection refused**
Make sure the PostgreSQL service is running. Open Task Manager → Services tab → find `postgresql-x64-XX` → right-click → Start.

**Mac: Python `libexpat` / `pyexpat` error**
You are using Homebrew Python. Uninstall it and use the official python.org installer instead (see prerequisites).

**Mac: `dotnet run` says framework not found**
Your terminal doesn't have the dotnet@8 exports active. Run:
```bash
export DOTNET_ROOT=/opt/homebrew/opt/dotnet@8/libexec
export PATH="$DOTNET_ROOT:$PATH"
```
Or add them permanently to `~/.zshrc`.

**Mac: `dotnet ef` not found**
```bash
export PATH="$PATH:/Users/YOUR_USERNAME/.dotnet/tools"
dotnet tool install --global dotnet-ef --version 8.0.8
```

**Both: `relation "Alerts" already exists`**
This is fine — it means the table was already created in pgAdmin. No action needed, the API will work correctly.

**Both: `CORS error` in browser**
Make sure the .NET API is running before starting the frontend.

**Both: Port already in use**
Another process is using port 5237 or 4200. Restart your computer, or find and kill the process using that port.
