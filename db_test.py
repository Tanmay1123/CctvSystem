import pyodbc
from datetime import datetime

try:

    conn = pyodbc.connect(
        'DRIVER={SQL Server};'
        'SERVER=DESKTOP-RGPQ74I\SQLEXPRESS;'
        'DATABASE=AI_CCTV_System;'
        'Trusted_Connection=yes;'
    )

    cursor = conn.cursor()

    query = """
    INSERT INTO Alerts
    (
        AlertType,
        CameraName,
        AlertTime,
        ScreenshotPath,
        Status
    )
    VALUES
    (
        ?, ?, ?, ?, ?
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