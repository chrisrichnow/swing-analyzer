"""FastAPI inference service — wraps the SwingNet auto-crop pipeline.

POST /select  (multipart: video) ->
  { fps, frame_count, bbox, positions{P1..P10:{frame,time,conf,event}},
    frames: [b64 jpeg x10 in P1..P10 order] }

Frames are the ORIGINAL full-frame images at the selected indices, downscaled
to max side 720 (keeps Claude vision token cost reasonable, matches the old
640px behavior). Run from this directory so model weight paths resolve:
  ../.venv/Scripts/python.exe -m uvicorn service:app --port 8000
"""
import base64, os, tempfile
import cv2
from fastapi import FastAPI, UploadFile, File
from pipeline import run_pipeline

app = FastAPI()
P_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']
MAX_SIDE = 720


def _encode(img):
    h, w = img.shape[:2]
    scale = MAX_SIDE / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return base64.b64encode(buf).decode() if ok else None


@app.get('/health')
def health():
    return {'ok': True}


@app.post('/select')
async def select(video: UploadFile = File(...)):
    suffix = os.path.splitext(video.filename or '')[1] or '.mov'
    fd, path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, 'wb') as f:
        f.write(await video.read())
    try:
        result = run_pipeline(path)
        cap = cv2.VideoCapture(path)
        frames = []
        for p in P_ORDER:
            idx = int(result['positions'][p]['frame'])
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, img = cap.read()
            frames.append(_encode(img) if ok else None)
        cap.release()
        return {
            'fps': result['fps'],
            'frame_count': result['frame_count'],
            'bbox': result['bbox'],
            'positions': {p: result['positions'][p] for p in P_ORDER},
            'frames': frames,
        }
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
