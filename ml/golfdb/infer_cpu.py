"""CPU inference for SwingNet — dumps the 8 detected event frames to disk.
Patched from test_video.py: CPU-only, no cv2.imshow, no mobilenet pretrain load
(swingnet weights already contain the CNN), saves frames + prints indices/timestamps.

Usage: python infer_cpu.py -p <video> -o <out_dir> [-s seq_length]
"""
import argparse, os
import cv2
import torch
import numpy as np
import torch.nn.functional as F
from torch.utils.data import DataLoader
from torchvision import transforms
from eval import ToTensor, Normalize
from model import EventDetector
from test_video import SampleVideo

# GolfDB 8 events -> our P-system mapping
event_names = {
    0: ('Address',                       'P1'),
    1: ('Toe-up',                        'P2'),
    2: ('Mid-backswing (arm parallel)',  'P3'),
    3: ('Top',                           'P4'),
    4: ('Mid-downswing (arm parallel)',  'P6'),
    5: ('Impact',                        'P7'),
    6: ('Mid-follow-through (shaft par)','P8'),
    7: ('Finish',                        'P10'),
}

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('-p', '--path', required=True)
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('-s', '--seq-length', type=int, default=64)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    device = torch.device('cpu')

    ds = SampleVideo(args.path, transform=transforms.Compose([
        ToTensor(), Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])]))
    dl = DataLoader(ds, batch_size=1, shuffle=False, drop_last=False)

    # pretrain=False -> skip needing mobilenet_v2.pth.tar; swingnet weights include CNN
    model = EventDetector(pretrain=False, width_mult=1., lstm_layers=1,
                          lstm_hidden=256, bidirectional=True, dropout=False)
    save_dict = torch.load('models/swingnet_1800.pth.tar', map_location=device, weights_only=False)
    model.load_state_dict(save_dict['model_state_dict'])
    model.to(device).eval()
    print('Loaded SwingNet weights (CPU)')

    seq_length = args.seq_length
    for sample in dl:
        images = sample['images']
        probs = None
        batch = 0
        while batch * seq_length < images.shape[1]:
            end = min((batch + 1) * seq_length, images.shape[1])
            image_batch = images[:, batch * seq_length:end, :, :, :]
            with torch.no_grad():
                logits = model(image_batch.to(device))
            p = F.softmax(logits.data, dim=1).cpu().numpy()
            probs = p if probs is None else np.append(probs, p, 0)
            batch += 1

    events = np.argmax(probs, axis=0)[:-1]  # frame index per event
    confidence = [float(probs[e, i]) for i, e in enumerate(events)]

    cap = cv2.VideoCapture(args.path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f'fps={fps:.2f} total_frames={total}')
    print('event,frame,timestamp_s,confidence')
    for i, e in enumerate(events):
        full, p = event_names[i]
        ts = e / fps
        print(f'{p} ({full}),{int(e)},{ts:.3f},{confidence[i]:.3f}')
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(e))
        ok, img = cap.read()
        if ok:
            cv2.putText(img, f'{p} {full} c={confidence[i]:.2f} t={ts:.2f}s',
                        (15, 30), cv2.FONT_HERSHEY_DUPLEX, 0.7, (0, 0, 255), 2)
            cv2.imwrite(os.path.join(args.out, f'{i}_{p}.jpg'), img)
    cap.release()
    print('Frames written to', args.out)
