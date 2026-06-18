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


def _to_rgb(frame_bgr):
    """Convert an OpenCV BGR frame to a CONTIGUOUS RGB array.

    `frame[:, :, ::-1]` returns a negative-stride view, which modern dlib
    rejects ("Unsupported image type") -> 0 faces found. ascontiguousarray
    gives dlib the plain 8-bit RGB buffer it expects."""
    return np.ascontiguousarray(frame_bgr[:, :, ::-1])

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "employees")
_JSON = os.path.join(_DIR, "employees.json")

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


def load():
    """Load employee reference encodings. Call once at startup."""
    global ENABLED, _known
    _known = []

    if not _LIB_OK:
        print("face_db: 'face_recognition' not installed -> recognition DISABLED.")
        ENABLED = False
        return

    if not os.path.exists(_JSON):
        print(f"face_db: {_JSON} not found -> recognition DISABLED.")
        ENABLED = False
        return

    try:
        with open(_JSON, encoding="utf-8") as f:
            people = json.load(f)
    except Exception as e:
        print("face_db: could not read employees.json:", e)
        ENABLED = False
        return

    for p in people:
        photo = os.path.join(_DIR, p.get("photo", ""))
        if not os.path.exists(photo):
            print(f"face_db: photo missing for {p.get('name')} ({photo}) -> skipped.")
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
    print(f"face_db: loaded {len(_known)} employee face(s) -> "
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
