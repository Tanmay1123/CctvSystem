import cv2
import mediapipe as mp
import math

mp_face_mesh = mp.solutions.face_mesh

face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]

def distance(p1, p2):
    return math.dist(p1, p2)

def eye_aspect_ratio(eye_points):
    p1, p2, p3, p4, p5, p6 = eye_points

    vertical1 = distance(p2, p6)
    vertical2 = distance(p3, p5)
    horizontal = distance(p1, p4)

    return (vertical1 + vertical2) / (2.0 * horizontal)

cap = cv2.VideoCapture(0)

while True:
    ret, frame = cap.read()

    if not ret:
        break

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    results = face_mesh.process(rgb)

    if results.multi_face_landmarks:
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

        for p in left_eye_points + right_eye_points:
            cv2.circle(frame, p, 2, (0, 255, 0), -1)

        cv2.putText(
            frame,
            f"EAR: {avg_ear:.2f}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            (255, 255, 0),
            2
        )

        if avg_ear < 0.22:
            cv2.putText(
                frame,
                "EYES CLOSED",
                (20, 90),
                cv2.FONT_HERSHEY_SIMPLEX,
                1,
                (0, 0, 255),
                3
            )
        else:
            cv2.putText(
                frame,
                "EYES OPEN",
                (20, 90),
                cv2.FONT_HERSHEY_SIMPLEX,
                1,
                (0, 255, 0),
                3
            )

    cv2.imshow("Eye Closed Test", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()