from flask import Flask, Response
from flask_cors import CORS
import cv2
from ultralytics import YOLO
import requests
import os
import shutil
import time
import urllib3
from datetime import datetime
import mediapipe as mp
import math


urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__)
CORS(app)

model = YOLO("yolov8n.pt")

mp_face_mesh = mp.solutions.face_mesh

face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]
NOSE_TIP = 1
CHIN = 152
FOREHEAD = 10
# Webcam
camera = cv2.VideoCapture(0)
# rtsp_url = "rtsp://admin:YOUR_PASSWORD@CAMERA_IP:5543/live/channel1"
# camera = cv2.VideoCapture(rtsp_url)

# API URL
API_URL = "https://localhost:7090/api/alerts"

# Rule settings
RULES = {
    "after_office_intrusion": True,
    "sleeping_detection": True,
    "crowd_detection": False
}

OFFICE_START_HOUR = 9
OFFICE_END_HOUR = 20

# Testing: 5 seconds. Later change to 120 or 180 seconds.
SLEEP_SECONDS = 3
MOVEMENT_THRESHOLD = 80

# Local Python alerts folder
PYTHON_ALERTS_FOLDER = "alerts"

# ASP.NET API wwwroot alerts folder
API_ALERTS_FOLDER = r"C:\AI_CCTV_Dashboard\AI_CCTV_API\AI_CCTV_API\wwwroot\alerts"

os.makedirs(PYTHON_ALERTS_FOLDER, exist_ok=True)
os.makedirs(API_ALERTS_FOLDER, exist_ok=True)

alert_sent = False
sleep_alert_sent = False
last_person_seen_time = 0
last_person_box = None
low_movement_start_time = None
eyes_closed_start_time = None
SMART_SLEEP_SECONDS = 3
head_down_start_time = None
SMART_HEAD_SECONDS = 3


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
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    safe_alert_type = alert_type.replace(" ", "_").lower()

    file_name = f"{safe_alert_type}_{timestamp}.jpg"

    python_image_path = os.path.join(PYTHON_ALERTS_FOLDER, file_name)
    api_image_path = os.path.join(API_ALERTS_FOLDER, file_name)

    cv2.imwrite(python_image_path, frame)

    shutil.copy2(python_image_path, api_image_path)

    image_url = f"https://localhost:7090/alerts/{file_name}"

    send_alert_to_api(alert_type, image_url)

    print(f"🚨 {alert_type} Alert Sent:", image_url)

def distance(p1, p2):
    return math.dist(p1, p2)


def eye_aspect_ratio(eye_points):
    p1, p2, p3, p4, p5, p6 = eye_points

    vertical1 = distance(p2, p6)
    vertical2 = distance(p3, p5)
    horizontal = distance(p1, p4)

    return (vertical1 + vertical2) / (2.0 * horizontal)


def detect_eyes_closed(frame):
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    results = face_mesh.process(rgb)

    if not results.multi_face_landmarks:
        return False, 0

    h, w, _ = frame.shape

    face_landmarks = results.multi_face_landmarks[0]

    left_eye_points = []
    right_eye_points = []

    for idx in LEFT_EYE:
        lm = face_landmarks.landmark[idx]
        left_eye_points.append((int(lm.x * w), int(lm.y * h)))

    for idx in RIGHT_EYE:
        lm = face_landmarks.landmark[idx]
        right_eye_points.append((int(lm.x * w), int(lm.y * h)))

    left_ear = eye_aspect_ratio(left_eye_points)
    right_ear = eye_aspect_ratio(right_eye_points)

    avg_ear = (left_ear + right_ear) / 2

    eyes_closed = avg_ear < 0.22

    for p in left_eye_points + right_eye_points:
        cv2.circle(frame, p, 2, (0, 255, 255), -1)

    return eyes_closed, avg_ear

def detect_head_down(frame):
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    results = face_mesh.process(rgb)

    if not results.multi_face_landmarks:
        return False, 0

    h, w, _ = frame.shape
    face_landmarks = results.multi_face_landmarks[0]

    nose = face_landmarks.landmark[NOSE_TIP]
    chin = face_landmarks.landmark[CHIN]
    forehead = face_landmarks.landmark[FOREHEAD]

    nose_y = int(nose.y * h)
    chin_y = int(chin.y * h)
    forehead_y = int(forehead.y * h)

    face_height = chin_y - forehead_y
    nose_position = nose_y - forehead_y

    ratio = nose_position / face_height if face_height != 0 else 0

    head_down = ratio > 0.58

    return head_down, ratio

def generate_frames():
    global alert_sent
    global sleep_alert_sent
    global last_person_seen_time
    global last_person_box
    global low_movement_start_time
    global eyes_closed_start_time
    global head_down_start_time

    while True:

        success, frame = camera.read()

        if not success:
            break

        person_detected = False
        person_count = 0

        results = model(frame)

        # Eye detection
        eyes_closed, ear_value = detect_eyes_closed(frame)

        if eyes_closed:
            if eyes_closed_start_time is None:
                eyes_closed_start_time = time.time()
        else:
            eyes_closed_start_time = None

        # Head detection
        head_down, head_ratio = detect_head_down(frame)

        if head_down:
            if head_down_start_time is None:
                head_down_start_time = time.time()
        else:
            head_down_start_time = None

        # UI Text
        cv2.putText(
            frame,
            f"EAR: {ear_value:.2f}",
            (20, 80),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 255, 255),
            2
        )

        cv2.putText(
            frame,
            "Eyes Closed" if eyes_closed else "Eyes Open",
            (20, 120),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 0, 255) if eyes_closed else (0, 255, 0),
            2
        )

        cv2.putText(
            frame,
            f"Head Ratio: {head_ratio:.2f}",
            (20, 160),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 255, 0),
            2
        )

        cv2.putText(
            frame,
            "Head Down" if head_down else "Head Normal",
            (20, 200),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 0, 255) if head_down else (0, 255, 0),
            2
        )

        # YOLO Detection
        for result in results:

            for box in result.boxes:

                class_id = int(box.cls[0])
                class_name = model.names[class_id]

                if class_name == "person":

                    person_detected = True
                    person_count += 1
                    last_person_seen_time = time.time()

                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    confidence = float(box.conf[0])

                    current_box = (x1, y1, x2, y2)

                    movement = calculate_box_movement(
                        last_person_box,
                        current_box
                    )

                    cv2.rectangle(
                        frame,
                        (x1, y1),
                        (x2, y2),
                        (0, 255, 0),
                        2
                    )

                    cv2.putText(
                        frame,
                        f"Person {confidence:.2f}",
                        (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7,
                        (0, 255, 0),
                        2
                    )

                    # Sleeping Detection
                    if RULES["sleeping_detection"]:

                        if movement < MOVEMENT_THRESHOLD:

                            if low_movement_start_time is None:
                                low_movement_start_time = time.time()

                            inactive_seconds = (
                                time.time() - low_movement_start_time
                            )

                            cv2.putText(
                                frame,
                                f"Inactive: {int(inactive_seconds)}s",
                                (x1, y2 + 30),
                                cv2.FONT_HERSHEY_SIMPLEX,
                                0.7,
                                (0, 165, 255),
                                2
                            )

                            eyes_closed_duration = 0
                            head_down_duration = 0

                            if eyes_closed_start_time is not None:
                                eyes_closed_duration = (
                                    time.time() - eyes_closed_start_time
                                )

                            if head_down_start_time is not None:
                                head_down_duration = (
                                    time.time() - head_down_start_time
                                )

                            if (
                                inactive_seconds >= SLEEP_SECONDS
                                and eyes_closed_duration >= SMART_SLEEP_SECONDS
                                and head_down_duration >= SMART_HEAD_SECONDS
                                and not sleep_alert_sent
                            ):

                                create_alert(
                                    frame,
                                    "Sleeping Detection"
                                )

                                sleep_alert_sent = True

                        else:
                            low_movement_start_time = None
                            sleep_alert_sent = False

                    last_person_box = current_box

        # Intrusion Detection
        if (
            RULES["after_office_intrusion"]
            and is_office_closed()
            and person_detected
            and not alert_sent
        ):

            create_alert(frame, "Intrusion")

            alert_sent = True

        # Reset intrusion
        if not person_detected and alert_sent:

            if time.time() - last_person_seen_time > 5:

                alert_sent = False

                print(
                    "Intrusion alert reset. Ready for next detection."
                )

        # Reset sleeping
        if not person_detected:

            last_person_box = None
            low_movement_start_time = None
            eyes_closed_start_time = None
            head_down_start_time = None
            sleep_alert_sent = False

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


if __name__ == "__main__":
    app.run(host="localhost", port=5000, debug=False)