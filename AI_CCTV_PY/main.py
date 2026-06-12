from ultralytics import YOLO
import cv2
import os
from datetime import datetime
import smtplib
from email.message import EmailMessage
import psycopg2

# -----------------------------------
# EMAIL SETTINGS
# -----------------------------------

SENDER_EMAIL = "aniketgaikwad7224@gmail.com"
SENDER_PASSWORD = "nwwx nfky rfmq olaa"

RECEIVER_EMAIL = ["calude72@gmail.com",
                  "canvajanvi@gmail.com", "bipulbyadav@gmail.com"]

# -----------------------------------
# DATABASE SETTINGS
# -----------------------------------

SERVER_NAME = r"DESKTOP-RGPQ74I\SQLEXPRESS"

# -----------------------------------
# OFFICE TIMING
# -----------------------------------

OFFICE_START_HOUR = 9
OFFICE_END_HOUR = 20

# -----------------------------------
# LOAD YOLO MODEL
# -----------------------------------

model = YOLO("yolov8n.pt")

# Open webcam
cap = cv2.VideoCapture(0)

alert_triggered = False

# Create alerts folder
if not os.path.exists("alerts"):
    os.makedirs("alerts")

# -----------------------------------
# DATABASE CONNECTION
# -----------------------------------


def get_db_connection():
    conn = psycopg2.connect(
        host="localhost",
        port=5432,
        database="AI_CCTV_System",
        user="abhishek",
        password="abhishek"
    )
    return conn

# -----------------------------------
# SAVE ALERT TO DATABASE
# -----------------------------------


def save_alert_to_db(alert_type, camera_name, screenshot_path):

    try:

        conn = get_db_connection()

        cursor = conn.cursor()

        query = """
        INSERT INTO "Alerts"
        (
            "AlertType",
            "CameraName",
            "AlertTime",
            "ScreenshotPath",
            "Status"
        )
        VALUES
        (
            %s, %s, %s, %s, %s
        )
        """

        values = (
            alert_type,
            camera_name,
            datetime.now(),
            screenshot_path,
            "Open"
        )

        cursor.execute(query, values)

        conn.commit()

        conn.close()

        print("✅ Alert saved to database!")

    except Exception as e:

        print("❌ Database Error")
        print(e)

# -----------------------------------
# SEND EMAIL
# -----------------------------------


def send_email_alert(image_path):

    try:

        msg = EmailMessage()

        msg["Subject"] = "🚨 AI CCTV Intrusion Alert"
        msg["From"] = SENDER_EMAIL
        msg["To"] = RECEIVER_EMAIL

        msg.set_content(
            "Intrusion detected after office hours.\n\n"
            "Screenshot attached."
        )

        # Attach image
        with open(image_path, "rb") as f:

            file_data = f.read()
            file_name = os.path.basename(image_path)

        msg.add_attachment(
            file_data,
            maintype="image",
            subtype="jpeg",
            filename=file_name
        )

        # Gmail SMTP
        with smtplib.SMTP("smtp.gmail.com", 587) as smtp:

            smtp.starttls()

            smtp.login(
                SENDER_EMAIL,
                SENDER_PASSWORD
            )

            smtp.send_message(msg)

        print("✅ Email Alert Sent!")

    except Exception as e:

        print("❌ Email Error")
        print(e)

# -----------------------------------
# MAIN LOOP
# -----------------------------------


while cap.isOpened():

    ret, frame = cap.read()

    if not ret:
        print("Camera not working")
        break

    current_hour = datetime.now().hour

    office_closed = (
        current_hour < OFFICE_START_HOUR
        or
        current_hour >= OFFICE_END_HOUR
    )

    person_detected = False

    # AI Detection
    results = model(frame)

    for result in results:

        boxes = result.boxes

        for box in boxes:

            class_id = int(box.cls[0])

            class_name = model.names[class_id]

            if class_name == "person":

                person_detected = True

                x1, y1, x2, y2 = map(int, box.xyxy[0])

                confidence = float(box.conf[0])

                # Draw box
                cv2.rectangle(
                    frame,
                    (x1, y1),
                    (x2, y2),
                    (0, 255, 0),
                    2
                )

                label = f"Person {confidence:.2f}"

                cv2.putText(
                    frame,
                    label,
                    (x1, y1 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (0, 255, 0),
                    2
                )

    # -----------------------------------
    # INTRUSION ALERT
    # -----------------------------------

    if office_closed and person_detected and not alert_triggered:

        print("🚨 INTRUSION ALERT!")

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        filename = f"alerts/intrusion_{timestamp}.jpg"

        # Save screenshot
        cv2.imwrite(filename, frame)

        print(f"Screenshot Saved: {filename}")

        # Send Email
        send_email_alert(filename)

        # Save DB Record
        save_alert_to_db(
            "Intrusion",
            "Main Gate Camera",
            filename
        )

        alert_triggered = True

    # Reset alert
    if not person_detected:
        alert_triggered = False

    # -----------------------------------
    # SHOW STATUS
    # -----------------------------------

    if office_closed:

        status = "OFFICE CLOSED"
        color = (0, 0, 255)

    else:

        status = "OFFICE OPEN"
        color = (0, 255, 0)

    cv2.putText(
        frame,
        status,
        (20, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        color,
        3
    )

    # Show frame
    cv2.imshow("AI Office Security System", frame)

    # Exit
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
