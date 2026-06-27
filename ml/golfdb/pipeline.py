"""Swing analysis pipeline v2 — auto-crop + SwingNet event detection.

Stages:
  1. Read frames (OpenCV auto-applies rotation metadata).
  2. Auto-crop to the golfer via YOLO person detection (union bbox + padding;
     extra top padding so the club arc above the head is included).
  3. Run SwingNet on the cropped, letterboxed-to-160 frames (in-memory, so
     event indices stay in ORIGINAL-frame space for downstream extraction).
  4. Enforce monotonic events via DP over the probability matrix (fixes the
     out-of-order / frame-0 glitches from naive per-class argmax).
  5. Map GolfDB's 8 events -> our P1..P10 (interpolate P5, P9).

Importable (run_pipeline) + CLI for validation (dumps annotated frames).
"""
import argparse, os, json
import cv2
import numpy as np
import torch
import torch.nn.functional as F
from torchvision import transforms
from eval import ToTensor, Normalize
from model import EventDetector

# GolfDB event index -> (human name, our P-label)
GOLFDB_EVENTS = [
    ('Address', 'P1'), ('Toe-up', 'P2'), ('Mid-backswing', 'P3'), ('Top', 'P4'),
    ('Mid-downswing', 'P6'), ('Impact', 'P7'), ('Mid-follow-through', 'P8'), ('Finish', 'P10'),
]

_swingnet = None
_yolo = None


def _get_swingnet(weights='models/swingnet_1800.pth.tar', device='cpu'):
    global _swingnet
    if _swingnet is None:
        m = EventDetector(pretrain=False, width_mult=1., lstm_layers=1,
                          lstm_hidden=256, bidirectional=True, dropout=False)
        sd = torch.load(weights, map_location=device, weights_only=False)
        m.load_state_dict(sd['model_state_dict'])
        m.to(device).eval()
        _swingnet = m
    return _swingnet


def _get_yolo(weights='yolov8n.pt'):
    global _yolo
    if _yolo is None:
        from ultralytics import YOLO
        _yolo = YOLO(weights)
    return _yolo


def read_frames(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        frames.append(img)
    cap.release()
    return frames, fps


def golfer_bbox(frames, pad=0.18, pad_top=0.45, sample=24):
    """Union of YOLO person boxes over a sample of frames, padded (extra on top
    for the club). Returns (x0, y0, x1, y1) in original pixel coords."""
    yolo = _get_yolo()
    H, W = frames[0].shape[:2]
    idx = np.linspace(0, len(frames) - 1, min(len(frames), sample)).astype(int)
    x0, y0, x1, y1 = W, H, 0.0, 0.0
    found = False
    for i in idx:
        res = yolo(frames[int(i)], classes=[0], verbose=False)
        boxes = res[0].boxes.xyxy.cpu().numpy() if len(res[0].boxes) else []
        # keep the largest person per frame (the golfer, not a background figure)
        best, barea = None, 0
        for b in boxes:
            area = (b[2] - b[0]) * (b[3] - b[1])
            if area > barea:
                barea, best = area, b
        if best is not None:
            x0 = min(x0, best[0]); y0 = min(y0, best[1])
            x1 = max(x1, best[2]); y1 = max(y1, best[3])
            found = True
    if not found:
        return (0, 0, W, H)
    bw, bh = x1 - x0, y1 - y0
    x0 -= bw * pad; x1 += bw * pad
    y0 -= bh * pad_top; y1 += bh * pad
    x0 = max(0, int(x0)); y0 = max(0, int(y0))
    x1 = min(W, int(x1)); y1 = min(H, int(y1))
    return (x0, y0, x1, y1)


def _letterbox_160(img, size=160):
    h, w = img.shape[:2]
    ratio = size / max(h, w)
    nh, nw = int(h * ratio), int(w * ratio)
    resized = cv2.resize(img, (nw, nh))
    dh, dw = size - nh, size - nw
    top, bottom = dh // 2, dh - dh // 2
    left, right = dw // 2, dw - dw // 2
    bordered = cv2.copyMakeBorder(resized, top, bottom, left, right,
                                  cv2.BORDER_CONSTANT,
                                  value=[0.406 * 255, 0.456 * 255, 0.485 * 255])
    return cv2.cvtColor(bordered, cv2.COLOR_BGR2RGB)


def _swingnet_probs(frames, bbox, device='cpu', seq_length=64):
    x0, y0, x1, y1 = bbox
    imgs = [_letterbox_160(f[y0:y1, x0:x1]) for f in frames]
    sample = {'images': np.asarray(imgs), 'labels': np.zeros(len(imgs))}
    tfm = transforms.Compose([ToTensor(), Normalize([0.485, 0.456, 0.406],
                                                    [0.229, 0.224, 0.225])])
    sample = tfm(sample)
    images = sample['images'].unsqueeze(0)  # [1, T, C, H, W]
    model = _get_swingnet(device=device)
    probs = None
    b = 0
    while b * seq_length < images.shape[1]:
        end = min((b + 1) * seq_length, images.shape[1])
        batch = images[:, b * seq_length:end]
        with torch.no_grad():
            logits = model(batch.to(device))
        p = F.softmax(logits.data, dim=1).cpu().numpy()
        probs = p if probs is None else np.append(probs, p, 0)
        b += 1
    return probs  # [T, 9]


def _monotonic_events(probs):
    """DP: pick frames t0<=t1<=...<=t7 maximizing sum of log-prob for the 8
    event classes, guaranteeing non-decreasing order."""
    T = probs.shape[0]
    ev = np.log(probs[:, :8] + 1e-9)  # [T, 8]
    dp = np.full((8, T), -1e18)
    back = np.zeros((8, T), dtype=int)
    dp[0] = ev[:, 0]
    for i in range(1, 8):
        best_prev, best_t = -1e18, 0
        for t in range(T):
            if dp[i - 1, t] > best_prev:
                best_prev, best_t = dp[i - 1, t], t
            dp[i, t] = ev[t, i] + best_prev
            back[i, t] = best_t
    events = [0] * 8
    events[7] = int(np.argmax(dp[7]))
    for i in range(7, 0, -1):
        events[i - 1] = int(back[i, events[i]])
    conf = [float(probs[events[i], i]) for i in range(8)]
    return events, conf


def run_pipeline(path, device='cpu', pad=0.18, pad_top=0.45):
    frames, fps = read_frames(path)
    bbox = golfer_bbox(frames, pad=pad, pad_top=pad_top)
    probs = _swingnet_probs(frames, bbox, device=device)
    events, conf = _monotonic_events(probs)

    positions = {}
    for i, (name, p) in enumerate(GOLFDB_EVENTS):
        positions[p] = {'frame': events[i], 'time': events[i] / fps, 'conf': conf[i], 'event': name}
    # interpolate the two missing positions
    positions['P5'] = {'frame': (positions['P4']['frame'] + positions['P6']['frame']) // 2,
                       'time': None, 'conf': None, 'event': 'Early-downswing (interp)'}
    positions['P9'] = {'frame': (positions['P8']['frame'] + positions['P10']['frame']) // 2,
                       'time': None, 'conf': None, 'event': 'Late-follow-through (interp)'}
    for p in ('P5', 'P9'):
        positions[p]['time'] = positions[p]['frame'] / fps
    return {'fps': fps, 'frame_count': len(frames), 'bbox': bbox, 'positions': positions}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('-p', '--path', required=True)
    ap.add_argument('-o', '--out', required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    result = run_pipeline(args.path)
    print(json.dumps({k: v for k, v in result.items() if k != 'positions'}, default=str))
    order = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']
    cap = cv2.VideoCapture(args.path)
    print('label,frame,time,conf,event')
    for p in order:
        d = result['positions'][p]
        c = '' if d['conf'] is None else f"{d['conf']:.3f}"
        print(f"{p},{d['frame']},{d['time']:.3f},{c},{d['event']}")
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(d['frame']))
        ok, img = cap.read()
        if ok:
            cv2.putText(img, f"{p} {d['event']} c={c} t={d['time']:.2f}s", (15, 30),
                        cv2.FONT_HERSHEY_DUPLEX, 0.7, (0, 0, 255), 2)
            cv2.imwrite(os.path.join(args.out, f"{order.index(p):02d}_{p}.jpg"), img)
    cap.release()
    print('Frames written to', args.out)
