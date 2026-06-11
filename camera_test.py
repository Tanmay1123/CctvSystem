# import cv2

# url = "http://192.168.29.222:4747/video"

# cap = cv2.VideoCapture(url)

# while True:
#     ret, frame = cap.read()

#     if not ret:
#         print("Frame not received")
#         break

#     cv2.imshow("DroidCam", frame)

#     if cv2.waitKey(1) & 0xFF == ord('q'):
#         break

# cap.release()
# cv2.destroyAllWindows()
 import cv2

cap = cv2.VideoCapture(0)

print("Camera Open:", cap.isOpened())

while True:
    ret, frame = cap.read()

    if not ret:
        print("No frame")
        break

    cv2.imshow("Test", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()