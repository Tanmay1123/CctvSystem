import psycopg2
from datetime import datetime

# Quick PostgreSQL connectivity / insert test for the AI_CCTV_System database.

try:

    conn = psycopg2.connect(
        host="localhost",
        port=5432,
        database="AI_CCTV_System",
        user="abhishek",
        password="abhishek"
    )

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
        "Intrusion",
        "Main Gate Camera",
        datetime.now(),
        "alerts/test.jpg",
        "Open"
    )

    cursor.execute(query, values)

    conn.commit()

    print("✅ Alert Inserted Successfully!")

    conn.close()

except Exception as e:

    print("❌ Error")
    print(e)
