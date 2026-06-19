import re, sys
import requests
from requests.auth import HTTPDigestAuth

IP, PORT = "192.168.29.89", 8000
DEV_URL = f"http://{IP}:{PORT}/onvif/device_service"
H = {"Content-Type": "application/soap+xml; charset=utf-8"}
CREDS = [("admin","admin"),("admin","Aits@2025"),("admin",""),
         ("admin","admin12345"),("admin","12345"),("admin","123456")]

ENV = '''<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
 xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
 xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
 xmlns:tt="http://www.onvif.org/ver10/schema">
<s:Body>{body}</s:Body></s:Envelope>'''

def call(url, body, auth):
    return requests.post(url, data=ENV.format(body=body), headers=H, auth=auth, timeout=8)

def first(pat, text):
    m = re.search(pat, text, re.S)
    return m.group(1).strip() if m else None

for user, pwd in CREDS:
    auth = HTTPDigestAuth(user, pwd)
    r = call(DEV_URL, "<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>", auth)
    if r.status_code != 200 or "Capabilities" not in r.text:
        print(f"-- {user}/{pwd!r}: auth/caps failed (HTTP {r.status_code})")
        continue
    print(f"\n=== AUTH OK: {user}/{pwd!r} ===")
    media_x = first(r"<[^>]*Media>.*?<[^>]*XAddr>(.*?)</", r.text) \
              or first(r"<tt:XAddr>(http[^<]*media[^<]*)</tt:XAddr>", r.text)
    print("Media XAddr:", media_x)
    media_url = media_x or f"http://{IP}:{PORT}/onvif/media_service"

    rp = call(media_url, "<trt:GetProfiles/>", auth)
    tokens = re.findall(r'token="([^"]+)"', rp.text)
    names  = re.findall(r"<tt:Name>(.*?)</tt:Name>", rp.text)
    print("Profiles:", list(zip(names, tokens)) or "none found")

    for tok in dict.fromkeys(tokens):
        body = (f'<trt:GetStreamUri><trt:StreamSetup>'
                f'<tt:Stream>RTP-Unicast</tt:Stream>'
                f'<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>'
                f'</trt:StreamSetup><trt:ProfileToken>{tok}</trt:ProfileToken></trt:GetStreamUri>')
        su = call(media_url, body, auth)
        uri = first(r"<tt:Uri>(.*?)</tt:Uri>", su.text)
        print(f"  token={tok}  RTSP URI = {uri}")
    sys.exit(0)

print("\nNo credentials worked. Tried:", CREDS)
