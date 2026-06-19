EMPLOYEE FACE REGISTRY
======================

This folder holds the known office employees that the AI uses for face
recognition. Each entry in employees.json points to a reference photo.

TO ENABLE RECOGNITION:

1) Save each employee's photo in THIS folder with the exact file name listed in
   employees.json:

       1.jpg  ->  Abhishek More
       2.jpg  ->  Tanmay Tailor
       3.jpg  ->  Aniket Sir
       4.jpg  ->  Avdhut

   Use a clear, front-facing photo with ONE face per image (a cropped headshot
   works best). JPG or PNG is fine (keep the .jpg name or update employees.json).

2) Install the face-recognition library (see requirements.txt):

       pip install face_recognition

   On Windows this needs dlib. If `pip install dlib` fails, install a prebuilt
   wheel matching your Python version, e.g.:
       pip install cmake
       pip install dlib            (or a prebuilt dlib .whl)
       pip install face_recognition

3) Restart the stream server:

       python stream_server.py

   On startup it prints how many employee faces it loaded. If the library or
   photos are missing, recognition is simply skipped and the system keeps
   running exactly as before (no crash).

ADD MORE EMPLOYEES: add an object to employees.json (unique id, name, email,
photo file name) and drop the matching photo here.
