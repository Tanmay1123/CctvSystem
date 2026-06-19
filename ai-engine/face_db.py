"""Employee face database + recognition.

Loads known employees from employees/employees.json and their reference photos,
computes a face encoding for each, and matches faces seen in a frame against them.

Designed to GRACEFULLY DEGRADE: if the `face_recognition` library or the
reference photos aren't available, recognition is simply disabled (every lookup
returns "unknown") and the rest of the AI system keeps working unchanged.
"""

import json
import os

import numpy as np
import requests


def _to_rgb(frame_bgr):
    """Convert an OpenCV BGR frame to a CONTIGUOUS RGB array.

    `frame[:, :, ::-1]` returns a negative-stride view, which modern dlib
    rejects ("Unsupported image type") -> 0 faces found. ascontiguousarray
    gives dlib the plain 8-bit RGB buffer it expects."""
    return np.ascontiguousarray(frame_bgr[:, :, ::-1])

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "employees")
_JSON = os.path.join(_DIR, "employees.json")
# Photos fetched from the API are cached here so recognition still works if the
# API is briefly unreachable on a later reload.
_CACHE = os.path.join(_DIR, "_cache")

# The .NET API is the source of truth for employees (managed from the dashboard).
# If it can't be reached we fall back to the local employees.json below.
API_BASE = os.environ.get("API_BASE", "http://localhost:5237").rstrip("/")

# Lower = stricter match. The face_recognition library's own default is 0.6;
# 0.55 keeps known employees matching reliably across angles/blur while still
# rejecting genuine strangers.
MATCH_TOLERANCE = 0.55

try:
    import face_recognition  # type: ignore
    _LIB_OK = True
except Exception:
    _LIB_OK = False

_known = []          # list of {"id", "name", "email", "encoding"}
ENABLED = False      # True only when the lib loaded AND at least one face encoded


def _fetch_from_api():
    """Fetch employees from the .NET API and cache each photo locally. Returns a
    list of {"id","name","email","_photo": abs path} or None if the API can't be
    reached (so the caller falls back to the local employees.json)."""
    try:
        resp = requests.get(f"{API_BASE}/api/employees", timeout=5)
        if not resp.ok:
            return None
        data = resp.json()
    except Exception as e:
        print("face_db: API unreachable, falling back to local files:", e)
        return None

    os.makedirs(_CACHE, exist_ok=True)
    people = []
    for e in data:
        photo_path = e.get("photoPath") or ""
        local_photo = ""
        if photo_path:
            local_photo = os.path.join(_CACHE, f"{e['id']}.jpg")
            try:
                img = requests.get(f"{API_BASE}{photo_path}", timeout=10)
                if img.ok:
                    with open(local_photo, "wb") as f:
                        f.write(img.content)
                else:
                    local_photo = local_photo if os.path.exists(local_photo) else ""
            except Exception:
                local_photo = local_photo if os.path.exists(local_photo) else ""
        people.append({
            "id": e.get("id"),
            "name": e.get("name", ""),
            "email": e.get("email", ""),
            "_photo": local_photo,
        })
    return people


def _read_local_json():
    """Fallback: read the bundled employees.json with photos relative to _DIR."""
    if not os.path.exists(_JSON):
        return None
    try:
        with open(_JSON, encoding="utf-8") as f:
            raw = json.load(f)
    except Exception as ex:
        print("face_db: could not read employees.json:", ex)
        return None
    people = []
    for p in raw:
        photo = os.path.join(_DIR, p.get("photo", "")) if p.get("photo") else ""
        people.append({
            "id": p.get("id"),
            "name": p.get("name", ""),
            "email": p.get("email", ""),
            "_photo": photo,
        })
    return people


def load():
    """(Re)load employee reference encodings. Called at startup and on demand via
    the engine's /reload-faces endpoint after the registry changes. Prefers the
    API; falls back to the local employees.json if the API is unavailable."""
    global ENABLED, _known
    _known = []

    if not _LIB_OK:
        print("face_db: 'face_recognition' not installed -> recognition DISABLED.")
        ENABLED = False
        return

    people = _fetch_from_api()
    source = "API"
    if people is None:
        people = _read_local_json()
        source = "local employees.json"

    if not people:
        print("face_db: no employees found -> recognition DISABLED.")
        ENABLED = False
        return

    for p in people:
        photo = p.get("_photo", "")
        if not photo or not os.path.exists(photo):
            print(f"face_db: photo missing for {p.get('name')} -> skipped.")
            continue
        try:
            img = face_recognition.load_image_file(photo)
            encs = face_recognition.face_encodings(img)
            if not encs:
                print(f"face_db: no face detected in {photo} -> skipped.")
                continue
            _known.append({
                "id": p["id"],
                "name": p["name"],
                "email": p["email"],
                "encoding": encs[0],
            })
        except Exception as e:
            print(f"face_db: error encoding {photo}:", e)

    ENABLED = len(_known) > 0
    print(f"face_db: loaded {len(_known)} employee face(s) from {source} -> "
          f"recognition {'ENABLED' if ENABLED else 'DISABLED'}.")


def _encodings_in(frame_bgr):
    # face_recognition works in RGB; OpenCV frames are BGR.
    rgb = _to_rgb(frame_bgr)
    locs = face_recognition.face_locations(rgb)
    if not locs:
        return []
    return face_recognition.face_encodings(rgb, locs)


def _match(enc):
    """Return the best-matching employee for one encoding, or None."""
    if not _known:
        return None
    dists = face_recognition.face_distance([k["encoding"] for k in _known], enc)
    best, best_d = None, MATCH_TOLERANCE
    for k, d in zip(_known, dists):
        if d < best_d:
            best_d, best = d, k
    if best is None:
        return None
    return {"id": best["id"], "name": best["name"], "email": best["email"]}


def get_by_name(name):
    """Return {"id","name","email"} for a known employee by name, or None.
    Used to attach the already-locked track identity to an alert."""
    if not name:
        return None
    for k in _known:
        if k["name"] == name:
            return {"id": k["id"], "name": k["name"], "email": k["email"]}
    return None


def identify_best(frame_bgr):
    """Best-matching employee for the most clearly recognised face in the frame,
    or None. Safe to call when recognition is disabled (returns None)."""
    if not ENABLED:
        return None
    try:
        for enc in _encodings_in(frame_bgr):
            emp = _match(enc)
            if emp:
                return emp
        return None
    except Exception as e:
        print("face_db.identify_best error:", e)
        return None


def recognize_with_boxes(frame_bgr, include_unknown=True):
    """Recognise every face in the frame and return their identities + pixel
    centre, so the live view can draw each person's name over their box:
        [{"name": str, "id": int|None, "center": (cx, cy)}]
    Known employees get their name; unmatched faces are labelled "Unknown"
    (when include_unknown is True). Safe no-op when recognition is disabled."""
    if not ENABLED:
        return []
    try:
        rgb = _to_rgb(frame_bgr)
        locs = face_recognition.face_locations(rgb)
        if not locs:
            return []
        encs = face_recognition.face_encodings(rgb, locs)
        out = []
        for (top, right, bottom, left), enc in zip(locs, encs):
            emp = _match(enc)
            center = ((left + right) // 2, (top + bottom) // 2)
            if emp:
                out.append({"name": emp["name"], "id": emp["id"], "center": center})
            elif include_unknown:
                out.append({"name": "Unknown", "id": None, "center": center})
        return out
    except Exception as e:
        print("face_db.recognize_with_boxes error:", e)
        return []


def scan(frame_bgr):
    """Return (matched_employees, has_unknown_face) for every face in the frame.
    `has_unknown_face` is True if at least one face matches NO known employee."""
    if not ENABLED:
        return [], False
    try:
        matched, has_unknown = [], False
        for enc in _encodings_in(frame_bgr):
            emp = _match(enc)
            if emp:
                matched.append(emp)
            else:
                has_unknown = True
        return matched, has_unknown
    except Exception as e:
        print("face_db.scan error:", e)
        return [], False
