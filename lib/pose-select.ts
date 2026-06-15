/**
 * Pose-based swing frame selection.
 *
 * Instead of whole-frame pixel motion (which a moving shadow / crowd / camera shake
 * corrupts), we track the golfer's BODY via pose estimation and derive the P1-P10
 * positions from biomechanics. The hands (wrists) are a reliable club proxy:
 *   - hand HEIGHT traces the swing arc — it peaks at the top of the backswing (P4)
 *   - hand SPEED peaks at impact (P7) and is ~0 at address (P1) and the top
 * These signals come only from the player's body, so background motion can't fool
 * them — which is the whole point of moving off the pixel-diff heuristic.
 *
 * Local dev runs the WASM backend (no native build needed on Windows/Node 24).
 * Production (Linux) can swap in @tensorflow/tfjs-node for ~10x speed — same model.
 */
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-converter";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import "@tensorflow/tfjs-backend-wasm";
import * as poseDetection from "@tensorflow-models/pose-detection";
import jpeg from "jpeg-js";
import { execSync } from "child_process";
import { readFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const ext = process.platform === "win32" ? ".exe" : "";
const FFMPEG = join(process.cwd(), `node_modules/ffmpeg-static/ffmpeg${ext}`);

export const POSE_FPS = 30;          // sampling rate for pose (plenty for ~1.5s swing)
const KP_MIN_SCORE = 0.2;            // below this a keypoint is "missing" -> interpolated
const FRAME_SCALE = 512;             // width handed to the model

export interface PoseSelection {
  seconds: number[];                 // 10 timestamps (s), P1..P10 in order
  debug: {
    fps: number;
    nFrames: number;
    p1: number; p4: number; p7: number; p10: number; // anchor frame indices
    avgScore: number;
  };
}

type XY = { x: number; y: number; score: number };

// Initialize the fastest available TF backend. Production (Linux) gets native
// tfjs-node for ~10x speed if it's installed; everything else (local Windows /
// Node 24, where the native build is unavailable) falls back to WASM. The native
// import is non-literal so tsc/Next don't try to resolve the optional package at
// build time, and a failed import silently drops to WASM. Force WASM with
// POSE_BACKEND=wasm.
async function initBackend(): Promise<string> {
  if (process.env.POSE_BACKEND !== "wasm") {
    try {
      const nodePkg = "@tensorflow/tfjs-node";
      await import(/* webpackIgnore: true */ nodePkg);
      await tf.setBackend("tensorflow");
      await tf.ready();
      return "tensorflow";
    } catch {
      // native backend unavailable — fall through to WASM
    }
  }
  setWasmPaths(join(process.cwd(), "node_modules/@tensorflow/tfjs-backend-wasm/dist/"));
  await tf.setBackend("wasm");
  await tf.ready();
  return "wasm";
}

let detectorPromise: Promise<poseDetection.PoseDetector> | null = null;
async function getDetector(): Promise<poseDetection.PoseDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const backend = await initBackend();
      console.log(`[pose] TF backend: ${backend}`);
      return poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
      });
    })();
  }
  return detectorPromise;
}

function frameToTensor(jpgPath: string): tf.Tensor3D {
  const { data, width, height } = jpeg.decode(readFileSync(jpgPath), { useTArray: true });
  const n = width * height;
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  return tf.tensor3d(rgb, [height, width, 3]);
}

// Linear-interpolate a per-frame scalar over frames where the keypoint was missing (NaN).
function fillGaps(arr: number[]): number[] {
  const out = arr.slice();
  const n = out.length;
  let i = 0;
  while (i < n) {
    if (Number.isNaN(out[i])) {
      let j = i;
      while (j < n && Number.isNaN(out[j])) j++;
      const before = i > 0 ? out[i - 1] : (j < n ? out[j] : 0);
      const after = j < n ? out[j] : before;
      for (let k = i; k < j; k++) {
        const t = j > i ? (k - i + 1) / (j - i + 1) : 0.5;
        out[k] = before + (after - before) * t;
      }
      i = j;
    } else i++;
  }
  return out;
}

function smooth(arr: number[], win: number): number[] {
  return arr.map((_, i) => {
    const lo = Math.max(0, i - win), hi = Math.min(arr.length - 1, i + win);
    let s = 0;
    for (let j = lo; j <= hi; j++) s += arr[j];
    return s / (hi - lo + 1);
  });
}

function extractPoseFrames(videoPath: string, fps: number): { dir: string; paths: string[] } {
  const dir = `${videoPath}_poseframes`;
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  execSync(
    `"${FFMPEG}" -i "${videoPath}" -vf "fps=${fps},scale=${FRAME_SCALE}:-2" -q:v 4 "${join(dir, "f_%04d.jpg")}" -loglevel error`
  );
  const paths = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort().map((f) => join(dir, f));
  return { dir, paths };
}

/** Pick a keypoint by name; returns {x,y,score}. */
function kp(pose: poseDetection.Pose | undefined, name: string): XY {
  const p = pose?.keypoints.find((k) => k.name === name);
  if (!p || (p.score ?? 0) < KP_MIN_SCORE) return { x: NaN, y: NaN, score: 0 };
  return { x: p.x, y: p.y, score: p.score ?? 0 };
}

export async function selectSwingFramesPose(
  videoPath: string,
  duration: number,
  onProgress?: (msg: string) => void
): Promise<PoseSelection> {
  const detector = await getDetector();
  const { dir, paths } = extractPoseFrames(videoPath, POSE_FPS);
  const n = paths.length;

  try {
    // ---- Run pose on every frame, collect raw wrist/hip signals ----
    const lwY = new Array(n).fill(NaN), lwX = new Array(n).fill(NaN);
    const rwY = new Array(n).fill(NaN), rwX = new Array(n).fill(NaN);
    const hipY = new Array(n).fill(NaN);
    let scoreSum = 0, scoreCount = 0;

    for (let i = 0; i < n; i++) {
      const input = frameToTensor(paths[i]);
      const poses = await detector.estimatePoses(input);
      input.dispose();
      const pose = poses[0];
      const lw = kp(pose, "left_wrist"), rw = kp(pose, "right_wrist");
      const lh = kp(pose, "left_hip"), rh = kp(pose, "right_hip");
      lwX[i] = lw.x; lwY[i] = lw.y; rwX[i] = rw.x; rwY[i] = rw.y;
      const hips = [lh, rh].filter((h) => h.score > 0);
      hipY[i] = hips.length ? hips.reduce((s, h) => s + h.y, 0) / hips.length : NaN;
      for (const k of [lw, rw, lh, rh]) if (k.score > 0) { scoreSum += k.score; scoreCount++; }
      if (onProgress && i % 20 === 0) onProgress(`Pose ${i}/${n}`);
    }

    // ---- Combined hand signal (mean of both wrists, gaps filled, smoothed) ----
    const handY = smooth(fillGaps(lwY.map((v, i) => {
      const a = lwY[i], b = rwY[i];
      if (Number.isNaN(a) && Number.isNaN(b)) return NaN;
      if (Number.isNaN(a)) return b;
      if (Number.isNaN(b)) return a;
      return (a + b) / 2;
    })), 2);
    const handX = smooth(fillGaps(lwX.map((v, i) => {
      const a = lwX[i], b = rwX[i];
      if (Number.isNaN(a) && Number.isNaN(b)) return NaN;
      if (Number.isNaN(a)) return b;
      if (Number.isNaN(b)) return a;
      return (a + b) / 2;
    })), 2);

    // Hand speed = frame-to-frame displacement of the hand point (club proxy).
    const speed = new Array(n).fill(0);
    for (let i = 1; i < n; i++) speed[i] = Math.hypot(handX[i] - handX[i - 1], handY[i] - handY[i - 1]);
    const sSpeed = smooth(speed, 2);

    // ---- Anchor detection ----
    // Rough downswing anchor: the hand-speed peak. This is reliably IN the downswing,
    // but lands slightly before true impact (the hands decelerate as the club releases
    // and whips through). We use it only to bracket the top and refine impact below.
    let speedPeak = 1;
    for (let i = 1; i < n; i++) if (sSpeed[i] > sSpeed[speedPeak]) speedPeak = i;

    // P4 (top): highest hands (min image-y) before the speed peak.
    let p4 = 0;
    for (let i = 0; i < speedPeak; i++) if (handY[i] < handY[p4]) p4 = i;

    // P1 (address): scan back from P4 to the last sustained low-speed stretch (hands
    // at rest before the takeaway). Robust to a long pre-shot routine because we look
    // for stillness, and only fall back to frame 0 if none is found.
    const speedFloor = sSpeed[speedPeak] * 0.08;
    const stillRun = Math.max(2, Math.round(POSE_FPS * 0.1));
    let p1 = 0;
    for (let i = p4 - stillRun; i >= 0; i--) {
      let still = true;
      for (let k = i; k < i + stillRun; k++) if (sSpeed[k] > speedFloor) { still = false; break; }
      if (still) { p1 = i + stillRun - 1; break; }
    }

    // P7 (impact): the hands return to ~address height (back down at the ball). Take
    // the median hand height around address, then from the top scan forward to the
    // first frame where the hands have dropped back to that level. That's the strike —
    // more accurate than the hand-speed peak, which leads impact. Falls back to the
    // speed peak if the hands never return to address height (unusual).
    const addrSamples: number[] = [];
    for (let i = Math.max(0, p1 - 2); i <= Math.min(n - 1, p1 + 2); i++) addrSamples.push(handY[i]);
    const addressY = addrSamples.slice().sort((a, b) => a - b)[Math.floor(addrSamples.length / 2)];
    let p7 = speedPeak;
    for (let i = p4 + 1; i < n; i++) {
      if (handY[i] >= addressY) { p7 = i; break; }
    }
    if (p7 <= p4) p7 = speedPeak;

    // takeaway start: first frame after P1 where hand speed clearly rises.
    let takeaway = p1;
    for (let i = p1; i < p4; i++) if (sSpeed[i] > sSpeed[speedPeak] * 0.15) { takeaway = i; break; }

    // P10 (finish): after P7, first frame where motion settles (sustained low speed);
    // fallback to the end of the clip.
    let p10 = n - 1;
    for (let i = p7 + 1; i < n - stillRun; i++) {
      let still = true;
      for (let k = i; k < i + stillRun; k++) if (sSpeed[k] > speedFloor) { still = false; break; }
      if (still) { p10 = i; break; }
    }

    // ---- Intermediates by time ratio within the correct anchor windows ----
    const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
    const p2 = lerp(takeaway, p4, 0.30);
    const p3 = lerp(takeaway, p4, 0.70);
    const p5 = lerp(p4, p7, 0.45);
    const p6 = lerp(p4, p7, 0.75);
    const p8 = lerp(p7, p10, 0.25);
    const p9 = lerp(p7, p10, 0.60);

    const idx = [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10];
    const toSec = (i: number) => Math.min(duration, Math.max(0, i / POSE_FPS));

    return {
      seconds: idx.map(toSec),
      debug: { fps: POSE_FPS, nFrames: n, p1, p4, p7, p10, avgScore: scoreCount ? scoreSum / scoreCount : 0 },
    };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
