from flask import Flask, Response
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


urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__)
CORS(app)

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
        num_faces=5,
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
    camera = cv2.VideoCapture(CAMERA_SOURCE, cv2.CAP_FFMPEG)
else:
    camera = cv2.VideoCapture(int(CAMERA_SOURCE))

# Keep the decoder buffer tiny so we don't accumulate stale frames.
try:
    camera.set(cv2.CAP_PROP_BUFFERSIZE, 1)
except Exception:
    pass

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
        # Rolling buffer of (timestamp, frame) so an alert can include the few
        # seconds of footage BEFORE the event, not just the moment it fired.
        self.buffer = deque(maxlen=CLIP_BUFFER_FRAMES)
        self.thread = threading.Thread(target=self._reader, daemon=True)
        self.thread.start()

    def _reader(self):
        while self.running:
            ok, f = self.cap.read()
            if not ok:
                time.sleep(0.01)
                continue
            with self.lock:
                self.frame = f
                self.buffer.append((time.time(), f))

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
    "crowd_detection": True
}

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

# A phone must be held near a person for this long (during working hours) before
# a Mobile Usage alert fires.
MOBILE_SECONDS = 3

OFFICE_START_HOUR = 9
OFFICE_END_HOUR = 20

# A person must be inactive (still) for this long to count toward sleeping.
SLEEP_SECONDS = 5
MOVEMENT_THRESHOLD = 80

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
API_ALERTS_FOLDER = r"C:\Users\Admin\Desktop\CCTV_AITS\CctvSystem\AI_CCTV_API\API\wwwroot\alerts"

os.makedirs(PYTHON_ALERTS_FOLDER, exist_ok=True)
os.makedirs(API_ALERTS_FOLDER, exist_ok=True)

# Intrusion state (per-person sleeping state now lives in PersonTracker)
alert_sent = False
last_person_seen_time = 0

# How long (seconds) head-down must persist while a person is already sitting
# still before it counts as sleeping.
SMART_SLEEP_SECONDS = 5
SMART_HEAD_SECONDS = 5


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


def send_alert_to_api(alert_type, image_url):
    try:
        payload = {
            "alertType": alert_type,
            "cameraName": "Main Camera",
            "alertTime": datetime.now().isoformat(),
            "screenshotPath": image_url,
            "status": "Open"
        }

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


def create_alert(frame, alert_type):
    """Kick off clip recording + alert delivery in a background thread so the
    detection loop is never blocked. The trigger frame (with detection boxes) is
    saved as the clip's thumbnail/poster.

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
        target=_produce_clip_alert,
        args=(thumb, alert_type),
        daemon=True
    ).start()


def _produce_clip_alert(thumb_frame, alert_type):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_alert_type = alert_type.replace(" ", "_").lower()
    base = f"{safe_alert_type}_{timestamp}"

    jpg_name = f"{base}.jpg"
    mp4_name = f"{base}.mp4"

    # 1) Thumbnail (poster) from the trigger frame
    cv2.imwrite(os.path.join(PYTHON_ALERTS_FOLDER, jpg_name), thumb_frame)

    # 2) Let the post-event footage accumulate, then pull pre+post from the buffer.
    #    fps is measured from the real frame timestamps so playback is real-time.
    time.sleep(CLIP_POST_SECONDS)
    clip_frames, fps = grabber.snapshot_clip(CLIP_PRE_SECONDS + CLIP_POST_SECONDS)
    if not clip_frames:
        clip_frames, fps = [thumb_frame], 12.0

    h, w = clip_frames[0].shape[:2]

    python_mp4 = os.path.join(PYTHON_ALERTS_FOLDER, mp4_name)

    # Prefer H.264 (browser-playable); fall back to mp4v if unavailable.
    writer = cv2.VideoWriter(python_mp4, cv2.VideoWriter_fourcc(*"avc1"), fps, (w, h))
    if not writer.isOpened():
        writer = cv2.VideoWriter(python_mp4, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    for f in clip_frames:
        writer.write(f)
    writer.release()

    # 3) Copy both into the API's wwwroot/alerts so they're served + emailed
    try:
        shutil.copy2(os.path.join(PYTHON_ALERTS_FOLDER, jpg_name),
                     os.path.join(API_ALERTS_FOLDER, jpg_name))
        shutil.copy2(python_mp4, os.path.join(API_ALERTS_FOLDER, mp4_name))
    except Exception as e:
        print("Copy to API folder failed:", e)

    # 4) The alert's media is the video clip; the .jpg poster shares its base name
    clip_url = f"http://localhost:5237/alerts/{mp4_name}"
    send_alert_to_api(alert_type, clip_url)

    print(f"🚨 {alert_type} clip sent ({len(clip_frames)} frames @ {fps:.0f}fps):", clip_url)

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

    def __init__(self, dist_thresh=120, max_missed=20):
        self.tracks = {}
        self.next_id = 0
        self.dist_thresh = dist_thresh
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
                      "sleep_sent": False, "missed": 0}
                self.tracks[tid] = tr
                movement = 999
            else:
                tid = best_id
                tr = self.tracks[tid]
                movement = calculate_box_movement(tr["box"], box)
                tr["center"], tr["box"], tr["missed"] = c, box, 0

            # per-person low-movement timer
            if movement < MOVEMENT_THRESHOLD:
                if tr["low_start"] is None:
                    tr["low_start"] = now
            else:
                tr["low_start"] = None
                tr["eyes_start"] = None
                tr["head_start"] = None
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


def generate_frames():
    global alert_sent
    global last_person_seen_time
    global _crowd_start

    while True:

        success, frame = grabber.read()

        if not success:
            # Camera not ready yet (or a dropped frame); wait briefly and retry
            # instead of killing the stream.
            time.sleep(0.01)
            continue

        now = time.time()
        results = model(frame, verbose=False)

        # One face-mesh inference -> per-face eyes/head state for the whole frame
        faces = detect_faces(frame)

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

        for tid, box, tr in tracked:
            x1, y1, x2, y2 = box

            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

            # Associate a face (whose nose falls inside this person's box)
            face = next((f for f in faces if box_contains(box, f["nose"])), None)

            # Per-person eyes/head timers (only meaningful while sitting still)
            if face and tr["low_start"] is not None:
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

            label = "Person"
            if face:
                label += " | " + ("eyes shut" if face["eyes_closed"] else "eyes open")
                label += f" | head {face['ratio']:.2f}"
                if face["head_down"]:
                    label += " DOWN"
            cv2.putText(frame, label, (x1, y1 - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 2)

            # Sleeping Detection (per person)
            # Requires ALL THREE, each sustained: sitting still + head down +
            # EYES CLOSED. The eyes-closed gate is what separates real sleeping
            # from simply working with the head down (e.g. looking at a laptop),
            # where the eyes stay open.
            if RULES["sleeping_detection"] and tr["low_start"] is not None:
                inactive = now - tr["low_start"]
                head_dur = (now - tr["head_start"]) if tr["head_start"] else 0
                eyes_dur = (now - tr["eyes_start"]) if tr["eyes_start"] else 0

                cv2.putText(frame, f"Inactive: {int(inactive)}s", (x1, y2 + 22),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)

                if (inactive >= SLEEP_SECONDS
                        and head_dur >= SMART_HEAD_SECONDS
                        and eyes_dur >= SMART_SLEEP_SECONDS
                        and not tr["sleep_sent"]):
                    create_alert(frame, "Sleeping Detection")
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
                        create_alert(frame, "Mobile Usage Detection")
                        tr["mobile_sent"] = True
                else:
                    tr["phone_start"] = None
                    tr["mobile_sent"] = False

        # Intrusion Detection
        if (
            RULES["after_office_intrusion"]
            and is_office_closed()
            and person_detected
            and not alert_sent
        ):

            create_alert(frame, "Intrusion")

            alert_sent = True

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
            f"Persons: {person_count}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            (255, 255, 0),
            2
        )

        ret, buffer = cv2.imencode(".jpg", frame)

        if not ret:
            continue

        frame_bytes = buffer.tobytes()

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n"
            + frame_bytes
            + b"\r\n"
        )


@app.route("/video")
def video():
    return Response(
        generate_frames(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )


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


if __name__ == "__main__":
    app.run(host="localhost", port=5000, debug=False)