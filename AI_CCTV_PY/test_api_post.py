import requests
import urllib3
from datetime import datetime

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

API_URL = "https://localhost:7090/api/alerts"

payload = {
    "alertType": "Test Alert",
    "cameraName": "Python Test",
    "alertTime": datetime.now().isoformat(),
    "screenshotPath": "https://localhost:7090/alerts/test.jpg",
    "status": "Open"
}

response = requests.post(API_URL, json=payload, verify=False)

print("Status:", response.status_code)
print("Response:", response.text)