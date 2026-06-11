import cv2

urls = [
    "rtsp://admin:Aits%402025@192.168.29.198:554/live/ch00_0",
    "rtsp://admin:Aits%402025@192.168.29.198:554/live/ch00_1",
    "rtsp://admin:Aits%402025@192.168.29.198:554/cam/realmonitor?channel=1&subtype=0",
    "rtsp://admin:Aits%402025@192.168.29.198:554/cam/realmonitor?channel=1&subtype=1",
    "rtsp://admin:Aits%402025@192.168.29.198:554/11",
    "rtsp://admin:Aits%402025@192.168.29.198:554/12"
]

for url in urls:
    print("Testing:", url)

    cap = cv2.VideoCapture(url)
    ret, frame = cap.read()

    if ret:
        print("WORKING URL:", url)

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            cv2.imshow("CP Plus Camera", frame)

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

        cap.release()
        cv2.destroyAllWindows()
        break
    else:
        print("Failed")

    cap.release()