# AI CCTV System — Package Installation

---

## 🐍 Python (AI_CCTV_PY)

```bash
pip install ultralytics opencv-python flask flask-cors mediapipe requests pyodbc urllib3
```

---

## ⚙️ .NET API (AI_CCTV_API)

```bash
dotnet restore
```

> If `dotnet ef` (Entity Framework CLI) is not installed, run this first:
> ```bash
> dotnet tool install --global dotnet-ef
> ```

Then apply the database migrations:

```bash
dotnet ef database update
```

---

## 🌐 Frontend (AI_CCTV_UI)

```bash
npm install
```

> If Angular CLI is not installed globally:
> ```bash
> npm install -g @angular/cli
> ```
