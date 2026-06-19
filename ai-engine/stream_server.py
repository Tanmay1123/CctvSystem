from flask import Flask, Response, request
from flask_cors import CORS
import cv2
from ultralytics import YOLO
import requests
import os
import shutil
import time
import urllib3
import threading
from collections import deque
from datetime import datetime
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import math
from urllib.parse import urlparse
import face_db


urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__)
CORS(app)

# Load known employee faces for recognition (gracefully disabled if the
# face_recognition lib / reference photos aren't present).
face_db.load()

# Detection model. YOLO11 is Ultralytics' newest family (2024) — better accuracy
# at similar speed to YOLOv8. We prefer yolo11n and fall back to yolov8n if the
# installed ultralytics is too old to fetch it. Bump to "yolo11s.pt" for even
# better detection if the machine can spare the CPU/GPU.
YOLO_MODEL = os.environ.get("YOLO_MODEL", "yolo11n.pt")
try:
    model = YOLO(YOLO_MODEL)
    print(f"YOLO model loaded: {YOLO_MODEL}")
except Exception as e:
    print(f"Could not load {YOLO_MODEL} ({e}); falling back to yolov8n.pt")
    model = YOLO("yolov8n.pt")

# Face landmark detection via MediaPipe Tasks API (the legacy mp.solutions.face_mesh
# API was removed from the Python 3.13 wheels). Uses the same 478-point face mesh,
# so the eye-aspect-ratio and head-pose math below is unchanged.
FACE_LANDMARKER_MODEL = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "face_landmarker.task"
)

face_landmarker = mp_vision.FaceLandmarker.create_from_options(
    mp_vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=FACE_LANDMARKER_MODEL),
        running_mode=mp_vision.RunningMode.IMAGE,
        num_faces=3,
        min_face_detection_confidence=0.5,
        min_tracking_confidence=0.5
    )
)

LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]
NOSE_TIP = 1
CHIN = 152
FOREHEAD = 10
# -----------------------------------
# VIDEO SOURCE
# -----------------------------------
# CP Plus Wi-Fi camera on the LAN (RTSP enabled via ONVIF in the CP Plus app).
#   - channel0 -> main stream (2304x1296)
#   - channel1 -> sub  stream (640x360)  <-- used here: much faster for YOLO on CPU
# Port is 5543 (not the usual 554) for this camera. Credentials: admin / Admin2025.
#
# The CAMERA_SOURCE env var can still override this (set it to "0" for a local webcam).
CAMERA_SOURCE = os.environ.get(
    "CAMERA_SOURCE",
    "rtsp://admin:abhishek@192.168.29.89:5543/live/channel1"
)

# For RTSP, force TCP transport (more reliable than UDP over Wi-Fi).
if CAMERA_SOURCE.lower().startswith("rtsp://"):
    os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")


def _open_camera():
    """Open the configured camera source. Called at startup and again by the
    grabber thread whenever the feed drops, so it reconnects on its own."""
    if CAMERA_SOURCE.lower().startswith("rtsp://"):
        cap = cv2.VideoCapture(CAMERA_SOURCE, cv2.CAP_FFMPEG)
    else:
        cap = cv2.VideoCapture(int(CAMERA_SOURCE))
    # Keep the decoder buffer tiny so we don't accumulate stale frames.
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    return cap


camera = _open_camera()

# -----------------------------------
# ALERT VIDEO CLIP SETTINGS
# -----------------------------------
# Each alert is delivered as a short video clip (pre + post the event) instead of
# a single screenshot. CLIP_BUFFER_FRAMES must hold at least PRE+POST seconds of
# frames; ~20 fps * (PRE+POST+margin). Keep modest so memory stays small on the
# 640x360 sub-stream.
CLIP_PRE_SECONDS = 4
CLIP_POST_SECONDS = 4
CLIP_BUFFER_FRAMES = 220


class FrameGrabber:
    """Continuously reads from the camera in a background thread and keeps ONLY
    the most recent frame. Without this, OpenCV queues incoming RTSP frames while
    our (slower) AI processing runs, so the displayed feed falls further and
    further behind real time. By always grabbing the latest frame and dropping
    the rest, latency stays low (we trade a few skipped frames for a live feed)."""

    def __init__(self, cap):
        self.cap = cap
        self.lock = threading.Lock()
        self.frame = None
        self.running = True
        # Timestamp of the last frame we successfully grabbed. Stays put when the
        # camera is disconnected, which is how /health knows the feed is dead.
        self.last_ok = 0.0
        # Rolling buffer of (timestamp, frame) so an alert can include the few
        # seconds of footage BEFORE the event, not just the moment it fired.
        self.buffer = deque(maxlen=CLIP_BUFFER_FRAMES)
        self.thread = threading.Thread(target=self._reader, daemon=True)
        self.thread.start()

    def _reader(self):
        while self.running:
            ok, f = self.cap.read()
            if not ok:
                # Camera dropped / disconnected — try to reopen so it recovers
                # automatically when it comes back, and leave last_ok stale so
                # /health reports the feed as offline meanwhile.
                time.sleep(0.3)
                try:
                    self.cap.release()
                    self.cap = _open_camera()
                except Exception:
                    pass
                continue
            with self.lock:
                self.frame = f
                self.last_ok = time.time()
                self.buffer.append((time.time(), f))

    def seconds_since_frame(self):
        return time.time() - self.last_ok if self.last_ok else 9999.0

    def read(self):
        with self.lock:
            if self.frame is None:
                return False, None
            return True, self.frame.copy()

    def snapshot_clip(self, seconds):
        """Return (frames, fps) for the last `seconds` of footage. fps is derived
        from the actual frame timestamps so the encoded clip plays back at real
        time (otherwise the clip's duration metadata won't match its content)."""
        cutoff = time.time() - seconds
        with self.lock:
            items = [(ts, f) for (ts, f) in self.buffer if ts >= cutoff]

        frames = [f for (_, f) in items]
        if len(items) < 2:
            return frames, 12.0

        span = items[-1][0] - items[0][0]
        fps = (len(items) - 1) / span if span > 0 else 12.0
        return frames, max(5.0, min(30.0, fps))


grabber = FrameGrabber(camera)

# API URL
API_URL = "http://localhost:5237/api/alerts"

# Rule settings
RULES = {
    "after_office_intrusion": True,
    "sleeping_detection": True,
    "mobile_usage": True,
    "crowd_detection": True,
    # Flag anyone whose face does NOT match a registered employee as an intrusion.
    # Requires face recognition to be enabled (employees + face_recognition lib).
    "unknown_intrusion": True,
}

# -----------------------------------
# FACE RECOGNITION (runs in a BACKGROUND thread)
# -----------------------------------
# All dlib face recognition runs off the video thread so it never stalls the
# live feed. The worker recognises faces every RECOG_INTERVAL seconds and the
# video loop maps those names onto the person tracks (sticky identity).
RECOG_INTERVAL = 1.0
# A tracked person must be seen with an UNRECOGNISED face — and never matched to
# an employee — for this long before being flagged as an intruder. Identity is
# sticky per person track, so a known employee who briefly fails recognition
# while moving is NOT re-flagged.
INTRUDER_MIN_SECONDS = 12

_recog_lock = threading.Lock()
_recog_boxes = []   # latest [{"name", "id", "center"}] from the worker


def _recognition_worker():
    """Background loop: grab the latest frame, recognise faces, cache the result
    for the video thread to draw, and raise unknown-person intrusions. Kept fully
    off the streaming thread so FPS is unaffected by recognition cost."""
    global _recog_boxes
    while True:
        if not face_db.ENABLED:
            time.sleep(1.0)
            continue
        ok, frame = grabber.read()
        if not ok or frame is None:
            time.sleep(0.3)
            continue
        try:
            boxes = face_db.recognize_with_boxes(frame)
        except Exception as e:
            print("recognition worker error:", e)
            boxes = []

        with _recog_lock:
            _recog_boxes = boxes

        # Intrusion is decided per person-track in the video loop (sticky
        # identity), so the worker only publishes recognised faces here.
        time.sleep(RECOG_INTERVAL)

# -----------------------------------
# CROWD DETECTION SETTINGS
# -----------------------------------
# Fires when at least CROWD_THRESHOLD people are visible in the frame at once,
# sustained for CROWD_SECONDS (so a group merely walking past doesn't trigger it).
# CROWD_ACTIVE_MODE controls WHEN the rule is live:
#   "always"        -> any time
#   "after_hours"   -> only while the office is closed (see OFFICE_START/END_HOUR)
#   "working_hours" -> only during office hours
# Re-alerting while a crowd persists is throttled by ALERT_COOLDOWN_SECONDS.
CROWD_THRESHOLD = 5
CROWD_SECONDS = 10
CROWD_ACTIVE_MODE = "always"
_crowd_start = None

# A phone must be held near a person CONTINUOUSLY for this long (during working
# hours) before a Mobile Usage alert fires — long enough that a quick reply or
# glance doesn't trigger it. Raise further if client calls keep alerting.
MOBILE_SECONDS = 45

OFFICE_START_HOUR = 9
OFFICE_END_HOUR = 20

# A person must be inactive (still) for this long before a sleep alert fires.
SLEEP_SECONDS = 120
# Max centre-point movement (pixels) between frames to still count as "still".
# Centre displacement is stable, so this can be a small, meaningful number.
MOVEMENT_THRESHOLD = 35

# Head-down detection: nose position within the forehead->chin span.
# A normal upright face already sits around ~0.60, so the head must drop clearly
# past this before it counts as "head down". Raise it if you still get false
# "head down"; lower it if real head-down isn't detected.
HEAD_DOWN_RATIO = 0.70

# Anti-spam: minimum seconds between two alerts (and emails) of the SAME type.
ALERT_COOLDOWN_SECONDS = 180
_last_alert_at = {}

# Local Python alerts folder
PYTHON_ALERTS_FOLDER = "alerts"

# ASP.NET API wwwroot alerts folder
API_ALERTS_FOLDER = r"C:\Users\Admin\Desktop\CCTV_AITS\CctvSystem\backend\src\wwwroot\alerts"

os.makedirs(PYTHON_ALERTS_FOLDER, exist_ok=True)
os.makedirs(API_ALERTS_FOLDER, exist_ok=True)

# Intrusion state (per-person sleeping state now lives in PersonTracker)
alert_sent = False
last_person_seen_time = 0

# How long (seconds) the sleeping POSTURE must persist (while already sitting
# still) to confirm sleep: eyes shut, or head down, or — for someone slumped
# face-down on the desk — the face being hidden from the camera.
SMART_SLEEP_SECONDS = 5
SMART_HEAD_SECONDS = 5
# When a still person's face can't be seen this long, treat it as head-down-on-
# desk (the classic "asleep at the desk" pose where the face isn't visible).
FACE_HIDDEN_SECONDS = 8


def is_office_closed():
    current_hour = datetime.now().hour
    return current_hour < OFFICE_START_HOUR or current_hour >= OFFICE_END_HOUR


def calculate_box_movement(old_box, new_box):
    if old_box is None:
        return 999

    old_x1, old_y1, old_x2, old_y2 = old_box
    new_x1, new_y1, new_x2, new_y2 = new_box

    movement = (
        abs(old_x1 - new_x1)
        + abs(old_y1 - new_y1)
        + abs(old_x2 - new_x2)
        + abs(old_y2 - new_y2)
    )

    return movement


def send_alert_to_api(alert_type, image_url, employee=None):
    try:
        payload = {
            "alertType": alert_type,
            "cameraName": "Main Camera",
            "alertTime": datetime.now().isoformat(),
            "screenshotPath": image_url,
            "status": "Open"
        }

        # Attach the recognised employee (name / id / email) when available.
        if employee:
            payload["employeeName"] = employee.get("name")
            payload["employeeId"] = employee.get("id")
            payload["employeeEmail"] = employee.get("email")

        response = requests.post(
            API_URL,
            json=payload,
            verify=False,
            timeout=10
        )

        print(f"{alert_type} API Response:", response.status_code)
        print(response.text)

    except Exception as e:
        print("API Error:", e)


def create_alert(frame, alert_type, employee=None):
    """Kick off screenshot capture + alert delivery in a background thread so the
    detection loop is never blocked. The trigger frame (with detection boxes) is
    saved as a single screenshot. `employee` (optional) carries a recognised
    employee dict to attach to the alert.

    A per-type cooldown prevents bombarding the API/email when detection is noisy
    or several people trigger the same rule in quick succession."""
    now = time.time()
    if alert_type != "Test Alert":  # manual tests always go through
        last = _last_alert_at.get(alert_type, 0)
        if now - last < ALERT_COOLDOWN_SECONDS:
            remaining = int(ALERT_COOLDOWN_SECONDS - (now - last))
            print(f"⏳ {alert_type} suppressed (cooldown {remaining}s left)")
            return
        _last_alert_at[alert_type] = now

    thumb = frame.copy()
    threading.Thread(
        target=_produce_screenshot_alert,
        args=(thumb, alert_type, employee),
        daemon=True
    ).start()


def _produce_screenshot_alert(thumb_frame, alert_type, employee=None):
    """Save a single screenshot (JPG) of the trigger frame and deliver it.

    Video clips are intentionally NOT recorded — they took up far too much disk
    space. Only a lightweight screenshot is kept per alert."""
    # Identify which employee triggered a sleep / mobile alert (runs here, in the
    # background thread, so the detection loop is never blocked).
    if employee is None and alert_type in ("Sleeping Detection", "Mobile Usage Detection"):
        employee = face_db.identify_best(thumb_frame)
        if employee:
            print(f"🧑 {alert_type} -> {employee['name']} (#{employee['id']})")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_alert_type = alert_type.replace(" ", "_").lower()
    jpg_name = f"{safe_alert_type}_{timestamp}.jpg"

    # 1) Save the screenshot locally
    cv2.imwrite(os.path.join(PYTHON_ALERTS_FOLDER, jpg_name), thumb_frame)

    # 2) Copy it into the API's wwwroot/alerts so it's served + emailed
    try:
        shutil.copy2(os.path.join(PYTHON_ALERTS_FOLDER, jpg_name),
                     os.path.join(API_ALERTS_FOLDER, jpg_name))
    except Exception as e:
        print("Copy to API folder failed:", e)

    # 3) The alert's media is the screenshot
    image_url = f"http://localhost:5237/alerts/{jpg_name}"
    send_alert_to_api(alert_type, image_url, employee)

    print(f"📸 {alert_type} screenshot sent:", image_url)

def distance(p1, p2):
    return math.dist(p1, p2)


def eye_aspect_ratio(eye_points):
    p1, p2, p3, p4, p5, p6 = eye_points

    vertical1 = distance(p2, p6)
    vertical2 = distance(p3, p5)
    horizontal = distance(p1, p4)

    return (vertical1 + vertical2) / (2.0 * horizontal)


def detect_faces(frame):
    """Run the face mesh ONCE and return a list of per-face states, so each person
    in a multi-person scene gets their own eyes/head reading. Each item is a dict:
        {"nose": (x, y), "eyes_closed": bool, "ear": float,
         "head_down": bool, "ratio": float}
    The 'nose' pixel point is used to associate the face with a person box."""
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = face_landmarker.detect(mp_image)

    faces = []
    if not result.face_landmarks:
        return faces

    h, w, _ = frame.shape

    for lms in result.face_landmarks:
        # --- eyes ---
        left_eye = [(int(lms[i].x * w), int(lms[i].y * h)) for i in LEFT_EYE]
        right_eye = [(int(lms[i].x * w), int(lms[i].y * h)) for i in RIGHT_EYE]
        avg_ear = (eye_aspect_ratio(left_eye) + eye_aspect_ratio(right_eye)) / 2
        eyes_closed = avg_ear < 0.22
        for p in left_eye + right_eye:
            cv2.circle(frame, p, 2, (0, 255, 255), -1)

        # --- head ---
        nose = lms[NOSE_TIP]
        chin = lms[CHIN]
        forehead = lms[FOREHEAD]
        nose_y = int(nose.y * h)
        chin_y = int(chin.y * h)
        forehead_y = int(forehead.y * h)
        face_height = chin_y - forehead_y
        ratio = (nose_y - forehead_y) / face_height if face_height != 0 else 0
        head_down = ratio > HEAD_DOWN_RATIO

        faces.append({
            "nose": (int(nose.x * w), nose_y),
            "eyes_closed": eyes_closed,
            "ear": avg_ear,
            "head_down": head_down,
            "ratio": ratio,
        })

    return faces


def box_contains(box, point):
    x1, y1, x2, y2 = box
    return x1 <= point[0] <= x2 and y1 <= point[1] <= y2


class PersonTracker:
    """Lightweight per-person tracker: matches each frame's person boxes to existing
    tracks by nearest center, so movement is measured for the SAME person across
    frames (the old code compared one person's box to a different person's box,
    which is why the inactivity timer never accumulated in a multi-person scene).
    Each track keeps its own low-movement / eyes-closed / head-down timers."""

    def __init__(self, dist_thresh=150, max_missed=40):
        self.tracks = {}
        self.next_id = 0
        # Moderate match radius: big enough to follow normal movement, small
        # enough that two different people don't get swapped onto each other's
        # track (which would mix up their identities).
        self.dist_thresh = dist_thresh
        # Survive brief detection gaps / occlusion without dropping the track.
        self.max_missed = max_missed

    @staticmethod
    def _center(box):
        x1, y1, x2, y2 = box
        return ((x1 + x2) / 2, (y1 + y2) / 2)

    def update(self, boxes):
        now = time.time()
        assigned = set()
        out = []

        for box in boxes:
            c = self._center(box)
            best_id, best_d = None, self.dist_thresh
            for tid, tr in self.tracks.items():
                if tid in assigned:
                    continue
                d = math.dist(c, tr["center"])
                if d < best_d:
                    best_d, best_id = d, tid

            if best_id is None:
                tid = self.next_id
                self.next_id += 1
                tr = {"center": c, "box": box, "low_start": None,
                      "eyes_start": None, "head_start": None,
                      "face_gone_start": None,
                      "sleep_sent": False, "missed": 0,
                      # face-recognition: per-track vote tally -> identity
                      "id_votes": {}, "identity": None,
                      "unknown_since": None, "intrusion_sent": False}
                self.tracks[tid] = tr
                movement = 999
            else:
                tid = best_id
                tr = self.tracks[tid]
                # Use CENTRE displacement — far more stable than summing the four
                # box corners (which jitters frame-to-frame and falsely resets the
                # inactivity timer).
                movement = math.dist(tr["center"], c)
                tr["center"], tr["box"], tr["missed"] = c, box, 0

            # per-person low-movement timer
            if movement < MOVEMENT_THRESHOLD:
                if tr["low_start"] is None:
                    tr["low_start"] = now
            else:
                # Genuine movement -> reset inactivity + sleeping posture timers.
                tr["low_start"] = None
                tr["eyes_start"] = None
                tr["head_start"] = None
                tr["face_gone_start"] = None
                tr["sleep_sent"] = False

            assigned.add(tid)
            out.append((tid, box, tr))

        # age out tracks that weren't matched this frame
        for tid in list(self.tracks.keys()):
            if tid not in assigned:
                self.tracks[tid]["missed"] += 1
                if self.tracks[tid]["missed"] > self.max_missed:
                    del self.tracks[tid]

        return out


person_tracker = PersonTracker()

def crowd_rule_active():
    """Whether the crowd rule should be evaluated right now (per CROWD_ACTIVE_MODE)."""
    if CROWD_ACTIVE_MODE == "after_hours":
        return is_office_closed()
    if CROWD_ACTIVE_MODE == "working_hours":
        return not is_office_closed()
    return True  # "always"


# -----------------------------------
# STREAMING / PERFORMANCE TUNING
# -----------------------------------
# Detection (YOLO + face mesh) is the per-frame bottleneck. We run it in ONE
# always-on background thread and let the HTTP route just push the latest
# annotated JPEG, so: (1) the feed runs at the camera's real rate instead of
# stalling on every inference, (2) multiple viewers share a single AI pass, and
# (3) alerts fire 24/7 even when nobody is watching the feed.
#   YOLO_IMGSZ     smaller = faster YOLO (less accurate for tiny/distant objects)
#   FACE_EVERY     run the costly face mesh every Nth frame, reuse in between
#   STREAM_MAX_FPS safety cap on how fast the streamer pushes frames
#   JPEG_QUALITY   lower = smaller frames = less encode + network time
YOLO_IMGSZ     = int(os.environ.get("YOLO_IMGSZ", "480"))
FACE_EVERY     = int(os.environ.get("FACE_EVERY", "2"))
STREAM_MAX_FPS = int(os.environ.get("STREAM_MAX_FPS", "60"))
JPEG_QUALITY   = int(os.environ.get("JPEG_QUALITY", "70"))

_stream_lock = threading.Lock()
_latest_jpeg = None       # most recent annotated frame, JPEG-encoded
_measured_fps = 0.0       # detection-loop throughput, drawn on the overlay
_face_counter = 0
_cached_faces = []


def _detection_loop():
    """Always-on detection worker: runs YOLO + face mesh + all rules on the latest
    camera frame as fast as it can and publishes the annotated JPEG for the HTTP
    streamer to serve."""
    global alert_sent
    global last_person_seen_time
    global _crowd_start
    global _latest_jpeg, _measured_fps, _face_counter, _cached_faces

    _fps_t0 = time.time()
    _fps_n = 0

    while True:

        success, frame = grabber.read()

        if not success:
            # Camera not ready yet (or a dropped frame); wait briefly and retry
            # instead of killing the stream.
            time.sleep(0.01)
            continue

        now = time.time()
        results = model(frame, verbose=False, imgsz=YOLO_IMGSZ)

        # Face mesh is costly; run it every FACE_EVERY frames and reuse in between
        # (faces barely move frame-to-frame, so the sleeping/head logic is fine).
        if _face_counter % FACE_EVERY == 0:
            _cached_faces = detect_faces(frame)
        _face_counter += 1
        faces = _cached_faces

        # Collect person + cell-phone boxes from YOLO (same inference pass)
        person_boxes = []
        phone_boxes = []
        for result in results:
            for box in result.boxes:
                cls = model.names[int(box.cls[0])]
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                if cls == "person":
                    person_boxes.append((x1, y1, x2, y2))
                elif cls == "cell phone":
                    phone_boxes.append((x1, y1, x2, y2))
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 0, 255), 2)
                    cv2.putText(frame, "Phone", (x1, y1 - 6),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 255), 2)

        person_count = len(person_boxes)
        person_detected = person_count > 0
        if person_detected:
            last_person_seen_time = now

        # Track each person across frames so movement is per-person
        tracked = person_tracker.update(person_boxes)

        # Snapshot the latest recognised names (computed in the background worker).
        with _recog_lock:
            recog_boxes = list(_recog_boxes)

        for tid, box, tr in tracked:
            x1, y1, x2, y2 = box

            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

            # ---- Vote-based identity + unknown-person intrusion ----
            tr.setdefault("id_votes", {})
            tr.setdefault("identity", None)
            tr.setdefault("unknown_since", None)
            tr.setdefault("intrusion_sent", False)

            # Which recognised face (if any) falls inside this person's box?
            matched_name = None
            for r in recog_boxes:
                cx, cy = r["center"]
                if x1 <= cx <= x2 and y1 <= cy <= y2:
                    matched_name = r["name"]
                    break

            if matched_name and matched_name != "Unknown":
                # Tally a vote for this name. The most-voted name wins, so a
                # single mis-matched frame can't hijack the label, and it stays
                # stable (and correct) as the person moves.
                tr["id_votes"][matched_name] = tr["id_votes"].get(matched_name, 0) + 1
                tr["unknown_since"] = None
            elif matched_name == "Unknown" and not tr["id_votes"]:
                # Seen but never matched to anyone known -> start the intruder clock.
                if tr["unknown_since"] is None:
                    tr["unknown_since"] = now

            # Identity = the name this track has been recognised as most often.
            tr["identity"] = (max(tr["id_votes"], key=tr["id_votes"].get)
                              if tr["id_votes"] else None)

            # Intrusion only for someone NEVER recognised as an employee who has
            # lingered with an unknown face long enough.
            if (RULES["unknown_intrusion"] and not tr["id_votes"]
                    and tr["unknown_since"] is not None
                    and (now - tr["unknown_since"]) >= INTRUDER_MIN_SECONDS
                    and not tr["intrusion_sent"]):
                create_alert(frame, "Intrusion")
                tr["intrusion_sent"] = True

            # Name banner: voted identity (falls back to the current match).
            display_name = tr["identity"] or matched_name
            if display_name:
                is_unknown = display_name == "Unknown"
                name_color = (0, 0, 255) if is_unknown else (0, 220, 0)
                (tw, th), _ = cv2.getTextSize(display_name, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
                cv2.rectangle(frame, (x1, y1 - th - 30), (x1 + tw + 12, y1 - 24),
                              name_color, -1)
                cv2.putText(frame, display_name, (x1 + 6, y1 - 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

            # Associate a face (whose nose falls inside this person's box)
            face = next((f for f in faces if box_contains(box, f["nose"])), None)

            # Per-person eyes/head/face-hidden timers (only while sitting still)
            tr.setdefault("face_gone_start", None)
            if tr["low_start"] is not None:
                if face:
                    # Face visible -> not hidden; track eyes/head posture.
                    tr["face_gone_start"] = None
                    if face["eyes_closed"]:
                        if tr["eyes_start"] is None:
                            tr["eyes_start"] = now
                    else:
                        tr["eyes_start"] = None
                    if face["head_down"]:
                        if tr["head_start"] is None:
                            tr["head_start"] = now
                    else:
                        tr["head_start"] = None
                else:
                    # Still person but no face visible -> likely slumped face-down
                    # on the desk. Start/continue the "face hidden" timer.
                    if tr["face_gone_start"] is None:
                        tr["face_gone_start"] = now
                    tr["eyes_start"] = None
                    tr["head_start"] = None

            label = "Person"
            if face:
                label += " | " + ("eyes shut" if face["eyes_closed"] else "eyes open")
                label += f" | head {face['ratio']:.2f}"
                if face["head_down"]:
                    label += " DOWN"
            cv2.putText(frame, label, (x1, y1 - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 2)

            # Sleeping Detection (per person)
            # Primary gate: the person has been essentially MOTIONLESS for
            # SLEEP_SECONDS (120s). On top of that we require a sleeping posture,
            # satisfied by ANY of: eyes shut, head down, or face hidden (slumped
            # face-down on the desk). The face-hidden case is what lets us catch
            # "asleep at the desk" where the eyes/face aren't visible at all.
            if RULES["sleeping_detection"] and tr["low_start"] is not None:
                inactive = now - tr["low_start"]
                head_dur = (now - tr["head_start"]) if tr["head_start"] else 0
                eyes_dur = (now - tr["eyes_start"]) if tr["eyes_start"] else 0
                face_gone_dur = (now - tr["face_gone_start"]) if tr["face_gone_start"] else 0

                cv2.putText(frame, f"Inactive: {int(inactive)}s", (x1, y2 + 22),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)

                posture_sleep = (
                    eyes_dur >= SMART_SLEEP_SECONDS
                    or head_dur >= SMART_HEAD_SECONDS
                    or face_gone_dur >= FACE_HIDDEN_SECONDS
                )

                if (inactive >= SLEEP_SECONDS
                        and posture_sleep
                        and not tr["sleep_sent"]):
                    # Use the locked track identity so the alert/email names them.
                    emp = face_db.get_by_name(tr.get("identity"))
                    create_alert(frame, "Sleeping Detection", emp)
                    tr["sleep_sent"] = True

            # Mobile Usage Detection (per person) — a phone held by this person
            # during working hours, sustained for MOBILE_SECONDS. Independent of
            # the sleeping/inactivity logic, so it never interferes with it.
            if RULES["mobile_usage"]:
                tr.setdefault("phone_start", None)
                tr.setdefault("mobile_sent", False)

                # expand the person box slightly so a phone just in front counts
                pad = int((x2 - x1) * 0.15)
                pbox = (x1 - pad, y1 - pad, x2 + pad, y2 + pad)
                has_phone = any(
                    box_contains(pbox, ((px1 + px2) // 2, (py1 + py2) // 2))
                    for (px1, py1, px2, py2) in phone_boxes
                )

                if has_phone:
                    if tr["phone_start"] is None:
                        tr["phone_start"] = now
                    phone_dur = now - tr["phone_start"]
                    cv2.putText(frame, f"Phone: {int(phone_dur)}s", (x1, y2 + 44),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 255), 2)

                    if (not is_office_closed()
                            and phone_dur >= MOBILE_SECONDS
                            and not tr["mobile_sent"]):
                        # Use the locked track identity so the alert/email names them.
                        emp = face_db.get_by_name(tr.get("identity"))
                        create_alert(frame, "Mobile Usage Detection", emp)
                        tr["mobile_sent"] = True
                else:
                    tr["phone_start"] = None
                    tr["mobile_sent"] = False

        # Intrusion Detection (after office hours, anyone present)
        if (
            RULES["after_office_intrusion"]
            and is_office_closed()
            and person_detected
            and not alert_sent
        ):

            create_alert(frame, "Intrusion")

            alert_sent = True

        # (Unknown-person intrusion is handled in the background recognition
        #  worker so it doesn't slow the live feed.)

        # Crowd Detection (whole-frame) — at least CROWD_THRESHOLD people present,
        # sustained for CROWD_SECONDS. Independent of the per-person rules above.
        if RULES["crowd_detection"] and crowd_rule_active():
            if person_count >= CROWD_THRESHOLD:
                if _crowd_start is None:
                    _crowd_start = now
                crowd_dur = now - _crowd_start
                cv2.putText(frame, f"CROWD {person_count} ({int(crowd_dur)}s)",
                            (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
                if crowd_dur >= CROWD_SECONDS:
                    # create_alert's per-type cooldown prevents re-spamming while
                    # the crowd persists, so no extra "sent" latch is needed here.
                    create_alert(frame, "Crowd Detection")
            else:
                _crowd_start = None
        else:
            _crowd_start = None

        # Reset intrusion
        if not person_detected and alert_sent:

            if now - last_person_seen_time > 5:

                alert_sent = False

                print(
                    "Intrusion alert reset. Ready for next detection."
                )

        cv2.putText(
            frame,
            f"Persons: {person_count}  |  {_measured_fps:.0f} FPS",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            (255, 255, 0),
            2
        )

        # Live face-recognition status (helps diagnose name labels).
        if face_db.ENABLED:
            fr_status = f"FaceRec ON | {len(recog_boxes)} face(s) recognised"
            fr_color = (0, 255, 255)
        else:
            fr_status = "FaceRec OFF (no photos / lib not loaded - restart server)"
            fr_color = (0, 0, 255)
        cv2.putText(frame, fr_status, (20, frame.shape[0] - 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, fr_color, 2)

        # Lower JPEG quality -> much smaller frames -> faster encode + network
        # transfer -> noticeably less latency, with little visible quality loss.
        ret, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])

        if not ret:
            continue

        with _stream_lock:
            _latest_jpeg = buffer.tobytes()

        # Rolling ~1s measurement of real detection throughput for the overlay.
        _fps_n += 1
        if now - _fps_t0 >= 1.0:
            _measured_fps = _fps_n / (now - _fps_t0)
            _fps_t0 = now
            _fps_n = 0


def generate_frames():
    """Thin HTTP streamer: pushes the latest annotated JPEG produced by the
    detection worker. Decoupled from detection, so viewers share one AI pass and
    the feed isn't throttled by per-frame inference."""
    target_dt = 1.0 / max(1, STREAM_MAX_FPS)
    last = None
    while True:
        t0 = time.time()
        with _stream_lock:
            data = _latest_jpeg
        if data is not None and data is not last:
            last = data
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n"
                + data
                + b"\r\n"
            )
        dt = time.time() - t0
        if dt < target_dt:
            time.sleep(target_dt - dt)


@app.route("/video")
def video():
    return Response(
        generate_frames(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )


# A frame must have arrived within this many seconds for the camera to count as
# "online". The grabber runs at ~20 fps, so a few seconds of silence means the
# feed is genuinely disconnected (not just a momentary hiccup).
HEALTH_FRESH_SECONDS = 4


@app.route("/health")
def health():
    """Real camera-liveness check used by the .NET monitor. Reports the camera as
    offline when no fresh frame has arrived (i.e. it's been disconnected),
    even though this Flask server itself is still running."""
    ago = grabber.seconds_since_frame()
    status = "online" if ago < HEALTH_FRESH_SECONDS else "offline"
    return {"camera": status, "lastFrameAgo": round(ago, 2)}, 200


# -----------------------------------
# MULTI-CAMERA LIVE RELAY (user-added cameras)
# -----------------------------------
# The primary camera above runs the full AI pipeline and is served at /video.
# Cameras added through the dashboard (RTSP/RTMP/HTTP) are relayed live — without
# AI — on demand at  /stream?src=<url> , transcoded to MJPEG so a plain browser
# <img> can display them (browsers can't render rtsp:// directly). Each distinct
# source is decoded once and shared by all viewers; a source with no viewers for
# RELAY_IDLE_TIMEOUT seconds stops itself so we don't decode feeds nobody watches.

RELAY_ALLOWED_SCHEMES = ("rtsp", "rtmp", "http", "https")
RELAY_IDLE_TIMEOUT = 30     # stop decoding a source with no viewers for this long
RELAY_OPEN_TIMEOUT = 8      # seconds to wait for the first frame before giving up

# Force TCP for any RTSP relay too (more reliable than UDP); harmless for others.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")


class RelayWorker:
    """Background decoder for one relayed source. Keeps only the latest frame and
    reconnects on its own if the feed drops, mirroring the primary FrameGrabber."""

    def __init__(self, src):
        self.src = src
        self.lock = threading.Lock()
        self.frame = None
        self.last_ok = 0.0
        self.last_viewer = time.time()
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _open(self):
        if self.src.isdigit():
            return cv2.VideoCapture(int(self.src))
        cap = cv2.VideoCapture(self.src, cv2.CAP_FFMPEG)
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        return cap

    def _run(self):
        cap = self._open()
        while self.running:
            # No one watching for a while -> stop and free the camera.
            if time.time() - self.last_viewer > RELAY_IDLE_TIMEOUT:
                break
            ok, f = cap.read()
            if not ok:
                time.sleep(0.3)
                try:
                    cap.release()
                    cap = self._open()
                except Exception:
                    pass
                continue
            with self.lock:
                self.frame = f
                self.last_ok = time.time()
        try:
            cap.release()
        except Exception:
            pass
        self.running = False

    def read(self):
        with self.lock:
            self.last_viewer = time.time()
            return self.frame.copy() if self.frame is not None else None


_relays = {}
_relays_lock = threading.Lock()


def _get_relay(src):
    with _relays_lock:
        w = _relays.get(src)
        if w is None or not w.running:
            w = RelayWorker(src)
            _relays[src] = w
        w.last_viewer = time.time()
        return w


@app.route("/stream")
def stream():
    """Relay an arbitrary camera source as MJPEG: /stream?src=rtsp://user:pass@host/..."""
    src = (request.args.get("src") or "").strip()
    if not src:
        return {"error": "missing 'src' query parameter"}, 400

    # Only allow real stream schemes (or a local webcam index) — never file:// etc.
    if not src.isdigit() and urlparse(src).scheme.lower() not in RELAY_ALLOWED_SCHEMES:
        return {"error": "unsupported source scheme"}, 400

    worker = _get_relay(src)

    # Wait briefly for the first frame so we can fail fast (502 -> the dashboard
    # shows NO SIGNAL) instead of streaming an endless blank response.
    deadline = time.time() + RELAY_OPEN_TIMEOUT
    while worker.read() is None and worker.running and time.time() < deadline:
        time.sleep(0.1)
    if worker.read() is None:
        return {"error": "could not open camera source"}, 502

    def gen():
        while worker.running:
            frame = worker.read()
            if frame is None:
                time.sleep(0.05)
                continue
            ret, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            if not ret:
                continue
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n"
                + buf.tobytes()
                + b"\r\n"
            )
            time.sleep(0.03)  # cap ~30 fps

    return Response(gen(), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/reload-faces", methods=["POST", "GET"])
def reload_faces():
    """Reload the employee face registry from the API without restarting the
    engine. The dashboard calls this after an employee is added/edited/imported
    so the camera recognises them right away."""
    face_db.load()
    return {
        "status": "ok",
        "enabled": face_db.ENABLED,
        "count": len(face_db._known),
    }, 200


@app.route("/test-alert")
def test_alert():
    """Fire a manual alert on demand to verify the full pipeline
    (Python -> .NET API -> PostgreSQL -> email -> dashboard) without waiting for a
    real detection. Open http://localhost:5000/test-alert in a browser."""
    success, frame = grabber.read()
    if not success or frame is None:
        # Fall back to a blank frame if the camera hasn't produced one yet
        import numpy as np
        frame = np.zeros((360, 640, 3), dtype="uint8")
        cv2.putText(frame, "TEST ALERT", (120, 190),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 255), 3)

    create_alert(frame, "Test Alert")
    return {"status": "ok", "message": "Test alert sent to API"}, 200


# Start the always-on detection worker (produces the annotated /video feed and
# fires alerts whether or not anyone is watching).
threading.Thread(target=_detection_loop, daemon=True).start()

# Start the background face-recognition worker (no-op work while disabled).
threading.Thread(target=_recognition_worker, daemon=True).start()


if __name__ == "__main__":
    app.run(host="localhost", port=5000, debug=False)