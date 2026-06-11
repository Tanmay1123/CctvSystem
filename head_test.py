import cv2
import mediapipe as mp

mp_face_mesh = mp.solutions.face_mesh

face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

# Face landmark indexes
NOSE_TIP = 1
CHIN = 152
FOREHEAD = 10

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

        nose = face_landmarks.landmark[NOSE_TIP]
        chin = face_landmarks.landmark[CHIN]
        forehead = face_landmarks.landmark[FOREHEAD]

        nose_y = int(nose.y * h)
        chin_y = int(chin.y * h)
        forehead_y = int(forehead.y * h)

        cv2.circle(frame, (int(nose.x * w), nose_y), 5, (0, 255, 255), -1)
        cv2.circle(frame, (int(chin.x * w), chin_y), 5, (0, 255, 0), -1)
        cv2.circle(frame, (int(forehead.x * w), forehead_y), 5, (255, 0, 0), -1)

        face_height = chin_y - forehead_y
        nose_position = nose_y - forehead_y

        ratio = nose_position / face_height if face_height != 0 else 0

        cv2.putText(
            frame,
            f"Head Ratio: {ratio:.2f}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            (255, 255, 0),
            2
        )

        if ratio > 0.58:
            cv2.putText(
                frame,
                "HEAD DOWN",
                (20, 90),
                cv2.FONT_HERSHEY_SIMPLEX,
                1,
                (0, 0, 255),
                3
            )
        else:
            cv2.putText(
                frame,
                "HEAD NORMAL",
                (20, 90),
                cv2.FONT_HERSHEY_SIMPLEX,
                1,
                (0, 255, 0),
                3
            )

    cv2.imshow("Head Down Test", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()