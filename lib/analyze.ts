import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { Analysis, Drill, CameraAngle, Club, Grade } from "@/types";

const ext = process.platform === "win32" ? ".exe" : "";
const FFMPEG = join(process.cwd(), `node_modules/ffmpeg-static/ffmpeg${ext}`);
const FFPROBE = join(process.cwd(), `node_modules/ffprobe-static/bin/${process.platform}/${process.arch}/ffprobe${ext}`);

const SCAN_FPS = 60;
const FRAME_SIZE = 160 * 90;
const MAX_DURATION_SEC = 30;

// NOTE: we no longer escalate to AI frame-mapping below a confidence threshold —
// validation showed it was consistently WORSE than the pure-math pick. The
// confidence score is still computed below for diagnostics (the validate script
// prints it), but it no longer gates any behaviour.
// Impact refinement: the pixel-diff motion peak is an unreliable impact locator
// (post-impact blur biases it late on DTL irons; the fast downswing sweep biases
// it early on face-on; background/shadow motion throws it off entirely). When the
// rough P7 can't be trusted we extract a dense full-fps strip around it and let a
// cheap model pick the exact ball-strike frame. Window is seconds each side.
// Impact-refine window is asymmetric and angle-aware. On DTL the pixel-diff peak
// sits slightly POST-impact (club blur), so true impact is just before the rough
// pick — a tight, slightly-before window. On FACE-ON the motion peak fires EARLY
// (max angular velocity is mid-downswing, not at the ball), so true impact is
// LATER — the window must reach well past the rough pick or it won't contain
// impact at all (this is exactly why the old symmetric ±0.18s window missed it).
const IMPACT_REFINE_WINDOW: Record<CameraAngle, { before: number; after: number }> = {
  dtl: { before: 0.20, after: 0.18 },
  "face-on": { before: 0.12, after: 0.35 },
};
// Symmetric, tight window for the pose selector, whose rough P7 is already within a
// few frames of impact and has no systematic early/late bias to correct for.
const POSE_IMPACT_REFINE_WINDOW = { before: 0.12, after: 0.12 };
const IMPACT_REFINE_MODEL = "claude-sonnet-4-6";
// Reject a refined P7 that lands implausibly close to P4 (would collapse the
// downswing frames) — a real downswing is at least this long.
const MIN_DOWNSWING_SEC = 0.12;

interface FrameSelection {
  indices: number[];      // 10 scan-fps frame indices, in swing order
  confidence: number;     // 0..1 — how much the math selector trusts this pick
  segStartSec: number;    // clean-segment bounds (seconds) for the AI fallback
  segEndSec: number;
  peakDominant: boolean;  // was the impact motion peak sharply isolated?
}

export interface ExtractOpts {
  apiKey?: string;        // omit to force pure-math selection (no AI fallback)
  cameraAngle?: CameraAngle;
  club?: Club;
  onProgress?: (message: string) => void;
}

export function probeDurationSec(videoPath: string): number {
  const out = execSync(
    `"${FFPROBE}" -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "${videoPath}"`,
    { encoding: "utf8" }
  ).trim();
  const d = parseFloat(out);
  if (!isFinite(d) || d <= 0) throw new Error("Could not read video duration. File may be corrupt or unsupported.");
  return d;
}

function smooth(diffs: number[], window: number): number[] {
  return diffs.map((_, i) => {
    const lo = Math.max(0, i - window);
    const hi = Math.min(diffs.length - 1, i + window);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += diffs[j];
    return sum / (hi - lo + 1);
  });
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

// Find timestamps of hard scene cuts (TikTok loading screens, edits, app overlays)
function detectSceneCuts(videoPath: string): number[] {
  const t0 = Date.now();
  try {
    // Downscale to 320px wide BEFORE the scene filter — scene-change detection is
    // a per-pixel cost, and cuts are just as detectable at low res. Saves several
    // seconds on high-res phone clips for zero accuracy loss.
    const out = execSync(
      `"${FFMPEG}" -i "${videoPath}" -filter:v "scale=320:-2,select='gt(scene,0.4)',showinfo" -f null - 2>&1`,
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
    );
    const matches = out.match(/pts_time:[0-9.]+/g) ?? [];
    console.log(`[timing] detectSceneCuts: ${Date.now() - t0}ms`);
    return matches.map(m => parseFloat(m.replace("pts_time:", "")));
  } catch {
    return [];
  }
}

// Longest contiguous segment between scene cuts — that's where the real swing lives
function longestCleanSegment(cuts: number[], duration: number): [number, number] {
  const boundaries = [0, ...cuts.filter(c => c > 0 && c < duration), duration];
  let bestStart = 0, bestEnd = duration, bestLen = -1;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const len = boundaries[i + 1] - boundaries[i];
    if (len > bestLen) {
      bestLen = len;
      bestStart = boundaries[i];
      bestEnd = boundaries[i + 1];
    }
  }
  return [bestStart, bestEnd];
}

function cumulativeSum(arr: number[], start: number, end: number): number[] {
  const cum = [0];
  for (let i = start + 1; i <= end; i++) cum.push(cum[cum.length - 1] + arr[i]);
  return cum;
}

function frameAtRatio(start: number, cum: number[], ratio: number): number {
  const target = cum[cum.length - 1] * ratio;
  for (let i = 0; i < cum.length; i++) {
    if (cum[i] >= target) return start + i;
  }
  return start + cum.length - 1;
}

export function selectSwingFrames(videoPath: string, videoDuration: number): FrameSelection {
  const tScan = Date.now();
  const rawFrames = execSync(
    `"${FFMPEG}" -i "${videoPath}" -vf "fps=${SCAN_FPS},scale=160:90,format=gray" -f rawvideo pipe:1 -loglevel error`,
    { maxBuffer: 200 * 1024 * 1024 }
  );
  console.log(`[timing] gray-scan decode (${SCAN_FPS}fps): ${Date.now() - tScan}ms`);

  const frameCount = Math.floor(rawFrames.length / FRAME_SIZE);
  const evenly = (start: number, end: number) =>
    Array.from({ length: 10 }, (_, i) => Math.floor(start + (i * (end - start)) / 9));
  // Confidence 0 on any fallback path so the orchestrator escalates to AI-mapping.
  const fallback = (segStartSec: number, segEndSec: number, start: number, end: number): FrameSelection =>
    ({ indices: evenly(start, end), confidence: 0, segStartSec, segEndSec, peakDominant: false });
  if (frameCount < 30) return fallback(0, videoDuration, 0, frameCount - 1);

  // Crop analysis to the longest cut-free segment — kills TikTok overlays / edits.
  // Pad inward by 0.2s on each side so cut transitions don't bleed into the diff signal.
  const cuts = detectSceneCuts(videoPath);
  const [segStartSec, segEndSec] = longestCleanSegment(cuts, videoDuration);
  const padFrames = Math.floor(SCAN_FPS * 0.2);
  const segStart = Math.max(0, Math.floor(segStartSec * SCAN_FPS) + padFrames);
  const segEnd = Math.min(frameCount - 1, Math.floor(segEndSec * SCAN_FPS) - padFrames);
  if (segEnd - segStart < 30) return fallback(segStartSec, segEndSec, 0, frameCount - 1);

  // Compute raw diffs then smooth
  const raw: number[] = new Array(frameCount).fill(0);
  for (let i = 1; i < frameCount; i++) {
    let d = 0;
    const p = (i - 1) * FRAME_SIZE, c = i * FRAME_SIZE;
    for (let j = 0; j < FRAME_SIZE; j++) d += Math.abs(rawFrames[p + j] - rawFrames[c + j]);
    raw[i] = d;
  }
  const sRaw = smooth(raw, 3);

  // Zero out anything outside the clean segment, then clip extreme outliers at 2× the 99th
  // percentile within the segment. This preserves the real impact peak (so P7 detection still
  // works) while killing single-frame artifacts that would poison percentage thresholds.
  const segmentDiffs = sRaw.slice(segStart, segEnd + 1);
  const outlierClip = percentile(segmentDiffs, 0.99) * 2;
  const s = sRaw.map((v, i) => (i < segStart || i > segEnd) ? 0 : Math.min(v, outlierClip));
  const maxDiff = Math.max(...s.slice(segStart, segEnd + 1));
  if (maxDiff === 0) return fallback(segStartSec, segEndSec, segStart, segEnd);

  // P7 — last peak above 80% of capped max within the clean segment
  let p7 = segStart;
  for (let i = segEnd; i >= segStart; i--) {
    if (s[i] >= maxDiff * 0.80) { p7 = i; break; }
  }
  // Refine to actual local max in a 1s window around that candidate
  const refineWindow = SCAN_FPS;
  for (let i = Math.max(0, p7 - refineWindow); i <= Math.min(frameCount - 1, p7 + Math.floor(refineWindow * 0.5)); i++) {
    if (s[i] > s[p7]) p7 = i;
  }
  // The pixel-diff peak is slightly post-impact (club whip blur). Shift back
  // 2 frames (~33ms at 60fps) to land closer to ball-strike. A bigger shift
  // would push P7 into the same region as P6 — they're already biomechanically
  // close (~50ms apart) so any over-correction makes them visually identical.
  p7 = Math.max(segStart, p7 - 2);

  // P4 — top of backswing. Constrained to a biomechanically realistic window
  // (downswing duration is 0.18–0.55s for human swings). Walk backward from the
  // window end and pick the LAST frame where motion is still "quiet" (below 30%
  // of the impact peak) — that's the moment right before motion ramps into the
  // downswing. This works for both slow-tempo swings (where the transition pause
  // is obvious) and fast-tempo swings (where there's no real pause, just a
  // boundary between low and high motion). Falls back to local min if nothing
  // qualifies.
  const p4SearchEnd = p7 - Math.floor(SCAN_FPS * 0.18);
  const p4SearchStart = Math.max(segStart, p7 - Math.floor(SCAN_FPS * 0.55));
  const downswingThreshold = maxDiff * 0.30;
  let p4 = -1;
  let p4Found = true;
  for (let i = p4SearchEnd; i >= p4SearchStart; i--) {
    if (s[i] < downswingThreshold) { p4 = i; break; }
  }
  if (p4 === -1) {
    // No quiet transition frame found — fall back to local minimum (lower confidence)
    p4Found = false;
    p4 = p4SearchStart;
    let p4Min = Infinity;
    for (let i = p4SearchStart; i <= p4SearchEnd; i++) {
      if (s[i] < p4Min) { p4Min = s[i]; p4 = i; }
    }
  }

  // P1 — last quiet frame before P4 (motion < 5% of max, sustained 5+ frames).
  // If the player never holds a still address (walk-up, no pause), there is no
  // quiet stretch to find. Rather than defaulting to frame 0 (which produces a
  // bogus multi-second "swing"), anchor P1 geometrically: a backswing runs
  // ~0.8s, so place P1 that far before P4. Impact-anchored, no stillness needed.
  let p1 = -1;
  let p1Found = true;
  const addressQuietFrames = 5;
  for (let i = p4 - addressQuietFrames; i >= addressQuietFrames; i--) {
    let quiet = true;
    for (let j = i; j < i + addressQuietFrames; j++) {
      if (s[j] >= maxDiff * 0.05) { quiet = false; break; }
    }
    if (quiet) { p1 = i + addressQuietFrames; break; }
  }
  if (p1 < 0) {
    p1Found = false;
    p1 = Math.max(segStart, p4 - Math.round(SCAN_FPS * 0.8));
  }

  // P10 — first quiet frame after P7 (motion < 8% of max, sustained 0.3s = 18 frames),
  // bounded by the clean segment so we never walk into a scene cut / TikTok screen.
  // If the player never holds a still finish (cuts the clip early, no pose), there
  // is no quiet stretch — anchor P10 geometrically ~0.5s past impact instead of the
  // old 2.5s default (which stretched the "swing" far past the real finish).
  const finishQuietFrames = Math.floor(SCAN_FPS * 0.3);
  let p10 = -1;
  let p10Found = true;
  for (let i = p7 + 1; i < segEnd - finishQuietFrames; i++) {
    let quiet = true;
    for (let j = i; j < i + finishQuietFrames; j++) {
      if (s[j] >= maxDiff * 0.08) { quiet = false; break; }
    }
    if (quiet) { p10 = i + Math.floor(finishQuietFrames / 2); break; }
  }
  if (p10 < 0) {
    p10Found = false;
    p10 = Math.min(segEnd, p7 + Math.round(SCAN_FPS * 0.5));
  }

  // Find the actual takeaway start. The old approach scanned FORWARD from P1 for
  // sustained motion, which breaks on a long pre-shot routine/waggle (e.g. Tiger
  // standing over the ball ~2s): it fails to lock on and falls back to P1, which
  // then smears P2/P3 across the dead setup so they land on the address frame.
  //
  // Instead, anchor on P4 (reliable) and scan BACKWARD to the last "settled" point
  // before the top — the pause right before the club starts back. The threshold is
  // measured against the backswing peak in the ~1s before P4 (not the whole P1->P4
  // span, which a waggle spike could inflate), so a waggle reads as quiet and the
  // takeaway is found where the real backswing motion begins.
  // Takeaway start = first frame where motion sustains above 30% of the backswing
  // peak for 0.1s. Two robustness details matter:
  //  - Measure the backswing peak only in the ~1.2s before P4, not the whole P1->P4
  //    span. A long pre-shot routine/waggle (e.g. Tiger over the ball ~2s) can spike
  //    the full-span max and push the 30% bar so high the real backswing never meets
  //    it — which silently dumped P2/P3 back onto the address frame.
  //  - Start the scan at that window, so the same waggle is skipped entirely.
  // The 30% bar (vs a low floor) also means a noisy night-time address won't false-
  // trigger. Falls back to P1 only if nothing qualifies.
  const bsWindowStart = Math.max(p1, p4 - Math.round(SCAN_FPS * 1.2));
  const bsPeak = Math.max(...s.slice(bsWindowStart, p4 + 1));
  const sustainedFrames = Math.floor(SCAN_FPS * 0.1);
  let takeawayStart = p1;
  for (let i = bsWindowStart; i < p4 - sustainedFrames; i++) {
    let sustained = true;
    for (let j = i; j < i + sustainedFrames; j++) {
      if (s[j] < bsPeak * 0.30) { sustained = false; break; }
    }
    if (sustained) { takeawayStart = i; break; }
  }
  // P2 ≈ shaft horizontal at hip (25% of true backswing time)
  // P3 ≈ lead arm parallel to ground (70% of true backswing time)
  const p2 = takeawayStart + Math.floor((p4 - takeawayStart) * 0.25);
  const p3 = takeawayStart + Math.floor((p4 - takeawayStart) * 0.70);

  // P5, P6: 35% and 75% cumulative motion through downswing
  const dsCum = cumulativeSum(s, p4, p7);
  const p5 = frameAtRatio(p4, dsCum, 0.30);
  const p6 = frameAtRatio(p4, dsCum, 0.55);

  // P8, P9: 25% and 60% cumulative motion through follow-through
  const ftCum = cumulativeSum(s, p7, p10);
  const p8 = frameAtRatio(p7, ftCum, 0.25);
  const p9 = frameAtRatio(p7, ftCum, 0.60);

  // Sanity check — a real swing is roughly 1.0–5.0s end-to-end. If our picks collapse
  // (all the same frame, or duration outside that range), bail to evenly-spaced frames
  // at confidence 0 so the orchestrator hands it to the AI-mapping fallback.
  const swingDurationSec = (p10 - p1) / SCAN_FPS;
  const positions = [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10];
  const uniqueFrames = new Set(positions).size;
  if (swingDurationSec < 1.0 || swingDurationSec > 5.0 || uniqueFrames < 8) {
    return fallback(segStartSec, segEndSec, segStart, segEnd);
  }

  // Confidence — how much we trust this pick (diagnostics only now). The two swing
  // boundaries (a real still address and a real still finish) are the strongest
  // signals; a clean transition at P4, a healthy total duration, and a sharply
  // dominant impact peak round it out.
  const p90 = percentile(segmentDiffs, 0.90);
  const peakDominant = maxDiff / (p90 + 1e-6) > 2.5;
  const durationHealthy = swingDurationSec >= 1.2 && swingDurationSec <= 2.6;
  let confidence = 0;
  if (p1Found) confidence += 0.30;
  if (p10Found) confidence += 0.25;
  if (p4Found) confidence += 0.20;
  if (durationHealthy) confidence += 0.15;
  if (peakDominant) confidence += 0.10;

  return { indices: positions, confidence, segStartSec, segEndSec, peakDominant };
}

// Extract N evenly-spaced low-res frames across [startSec, endSec] for the model
// to read in the AI-mapping fallback. Returns each frame's path + source timestamp.
function extractCandidateStrip(
  videoPath: string,
  startSec: number,
  endSec: number,
  count: number
): { dir: string; frames: { path: string; sec: number }[] } {
  const dir = `${videoPath}_cand`;
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });

  const span = Math.max(0.001, endSec - startSec);
  const frames: { path: string; sec: number }[] = [];
  for (let i = 0; i < count; i++) {
    const sec = startSec + (span * i) / (count - 1);
    const p = join(dir, `cand_${String(i + 1).padStart(2, "0")}.jpg`);
    execSync(
      `"${FFMPEG}" -ss ${sec.toFixed(4)} -i "${videoPath}" -vframes 1 -vf "scale=512:-2" -q:v 3 "${p}" -y -loglevel error`
    );
    if (existsSync(p)) frames.push({ path: p, sec });
  }
  return { dir, frames };
}

// Refine impact (P7) visually: extract a dense strip at full scan-fps around the
// rough P7 and let a cheap model pick the exact ball-strike frame. Returns the
// refined scan-fps index, or null if it fails. Robust to lighting/shadow (it sees
// the club + ball) and precise (full-fps strip), unlike the pixel-diff peak.
async function refineImpact(
  videoPath: string,
  roughP7Sec: number,
  duration: number,
  apiKey: string,
  cameraAngle?: CameraAngle,
  club?: Club,
  windowOverride?: { before: number; after: number }
): Promise<number | null> {
  // The per-angle windows are biased to correct the HEURISTIC motion-peak's known
  // direction of error. Callers whose rough P7 has no such bias (e.g. the pose
  // selector, which is already within a few frames of impact) pass a symmetric
  // override so the model snaps to the exact strike instead of drifting.
  const win = windowOverride ?? IMPACT_REFINE_WINDOW[cameraAngle ?? "dtl"];
  const startSec = Math.max(0, roughP7Sec - win.before);
  const endSec = Math.min(duration, roughP7Sec + win.after);
  const count = Math.max(1, Math.round((endSec - startSec) * SCAN_FPS) + 1);
  const { dir, frames } = extractCandidateStrip(videoPath, startSec, endSec, count);
  try {
    if (frames.length < 3) return null;

    const client = new Anthropic({ apiKey, maxRetries: 3 });
    const content: Anthropic.MessageParam["content"] = [];
    frames.forEach((f, i) => {
      content.push({ type: "text", text: `Frame ${i + 1}:` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: readFileSync(f.path).toString("base64") },
      });
    });
    const angleLabel = cameraAngle === "dtl" ? "DOWN-THE-LINE" : cameraAngle === "face-on" ? "FACE-ON" : "UNKNOWN";
    content.push({
      type: "text",
      text: `These ${frames.length} frames are consecutive (in time order) around the moment of impact in a golf swing. Camera: ${angleLabel}${club ? `, club ${club.replace("-", " ")}` : ""}.

Identify the single frame at IMPACT — the clubhead exactly at the ball, the instant before the ball leaves. If you see a divot spray or the ball already gone, impact is the frame just before that. Pick the most precise ball-strike frame.

Respond with ONLY valid JSON, no markdown: {"impact": <frame number 1-${frames.length}>}`,
    });

    const tRefine = Date.now();
    const resp = await client.messages.create({
      model: IMPACT_REFINE_MODEL,
      max_tokens: 128,
      messages: [{ role: "user", content }],
    });
    console.log(`[timing] refineImpact model call: ${Date.now() - tRefine}ms`);

    const parsed = parseModelJson<{ impact: number }>((resp.content[0] as { text: string }).text, "impact refinement");
    let n = Math.round(Number(parsed.impact));
    if (!Number.isFinite(n)) return null;
    n = Math.min(Math.max(n, 1), frames.length);
    return Math.max(0, Math.round(frames[n - 1].sec * SCAN_FPS));
  } catch {
    return null;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// Moving P7 can invalidate the neighbouring downswing/follow-through frames. Re-space
// P5/P6 across [P4,P7] and P8/P9 across [P7,P10] by time ratio so ordering stays sane.
function reanchorAroundP7(indices: number[], newP7: number): number[] {
  const [p1, , , p4, , , , , , p10] = indices;
  const p7 = Math.min(Math.max(newP7, p4 + 1), p10 - 1);
  const p5 = p4 + Math.round((p7 - p4) * 0.45);
  const p6 = p4 + Math.round((p7 - p4) * 0.75);
  const p8 = p7 + Math.round((p10 - p7) * 0.25);
  const p9 = p7 + Math.round((p10 - p7) * 0.60);
  return [p1, indices[1], indices[2], p4, p5, p6, p7, p8, p9, p10];
}

// Orchestrator: trust the math pick (validation showed it beats AI frame-mapping
// on every DTL clip). Refine impact (P7) only on FACE-ON, where the motion-peak
// fires early and needs a visual fix — on DTL the motion-peak is reliable and the
// refine actively pulls impact pre-strike, so we leave it alone. Pure-math when no
// apiKey is supplied.
export async function selectSwingFramesSmart(
  videoPath: string,
  duration: number,
  opts?: ExtractOpts
): Promise<number[]> {
  const sel = selectSwingFrames(videoPath, duration);
  let indices = sel.indices;

  // The pixel-diff motion peak is an unreliable impact locator on BOTH angles: on
  // face-on it fires mid-downswing, and on DTL the club's fast mid-downswing sweep
  // (or a moving body-shadow) can outweigh the ball-strike frame. So always lock P7
  // visually when we have an API key — the model reads the club-vs-ball directly.
  const p7NeedsRefine = true;
  if (opts?.apiKey && p7NeedsRefine) {
    const refined = await refineImpact(videoPath, indices[6] / SCAN_FPS, duration, opts.apiKey, opts.cameraAngle, opts.club);
    // The refine may only push P7 LATER, never earlier. The math motion-peak (after
    // its -2 frame shift) lands at/just-after the ball on clean clips, so an earlier
    // refine pick there is the model mis-locating impact (it tends to pick the club
    // approaching, pre-strike). But when the math peak is a FALSE early peak — the
    // club's mid-downswing sweep on DTL, or the systematic early bias on face-on —
    // the real impact is later, and the refine correctly pushes it there. Capping at
    // "later only" gets both: clean clips keep their good math, early clips get fixed.
    const minP7 = indices[3] + Math.round(MIN_DOWNSWING_SEC * SCAN_FPS);
    const maxP7 = indices[9] - Math.round(MIN_DOWNSWING_SEC * SCAN_FPS);
    if (refined != null && refined > indices[6] && refined >= minP7 && refined <= maxP7) {
      indices = reanchorAroundP7(indices, refined);
    }
  }

  return indices;
}

// v2 frame selection: delegate to the Python SwingNet inference service (trained
// golf event-spotter + YOLO person auto-crop + monotonic-event DP). The service
// returns the 10 selected frames as base64 JPEGs in P1..P10 order; we just write
// them to disk so everything downstream (grading, UI, saving) is unchanged.
// Enabled by setting SWING_SERVICE_URL; falls back to the legacy selector if unset.
async function selectViaService(serviceUrl: string, videoPath: string, outputDir: string): Promise<string[]> {
  const buf = readFileSync(videoPath);
  const form = new FormData();
  form.append("video", new Blob([new Uint8Array(buf)], { type: "video/mp4" }), "video.mp4");

  const res = await fetch(`${serviceUrl.replace(/\/$/, "")}/select`, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Swing service error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { frames: (string | null)[] };
  if (!Array.isArray(data.frames) || data.frames.length !== 10) {
    throw new Error(`Swing service returned ${data.frames?.length ?? 0}/10 frames.`);
  }

  const paths: string[] = [];
  data.frames.forEach((b64, i) => {
    if (!b64) throw new Error(`Swing service missing frame ${i + 1}/10.`);
    const framePath = join(outputDir, `frame_${String(i + 1).padStart(3, "0")}.jpg`);
    writeFileSync(framePath, Buffer.from(b64, "base64"));
    paths.push(framePath);
  });
  return paths;
}

export async function extractFrames(videoPath: string, outputDir: string, opts?: ExtractOpts): Promise<string[]> {
  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  // v2 path: trained SwingNet service handles selection (auto-crop + event model).
  const serviceUrl = process.env.SWING_SERVICE_URL;
  if (serviceUrl) {
    opts?.onProgress?.("Detecting swing positions...");
    return selectViaService(serviceUrl, videoPath, outputDir);
  }

  const duration = probeDurationSec(videoPath);
  if (duration > MAX_DURATION_SEC) {
    throw new Error(`Video too long: ${duration.toFixed(1)}s. Max ${MAX_DURATION_SEC}s — please trim and try again.`);
  }

  // Frame selection: pose-based (experimental, flag-gated) or the motion heuristic.
  // USE_POSE_SELECTION=1 in .env.local switches to pose for local testing; default
  // stays on the shipped heuristic so production is unaffected. Dynamic import keeps
  // the tfjs stack out of the runtime entirely unless the flag is on.
  let frameSeconds: number[];
  if (process.env.USE_POSE_SELECTION === "1") {
    const { selectSwingFramesPose } = await import("./pose-select");
    const pose = await selectSwingFramesPose(videoPath, duration, opts?.onProgress);
    // Hybrid: pose gives robust swing STRUCTURE (P1/P4/P10 + spacing) that generalizes
    // across swing types, but it can't see the clubhead, so its P7 is ~1-3 frames off.
    // Lock impact visually with the same model refine the heuristic uses, then re-space
    // the downswing/follow-through around it. No "later-only" guard here: that guard
    // exists to protect the heuristic's good motion-peak math, but pose impact has no
    // systematic early bias, so we trust the visual pick within plausible bounds.
    let indices = pose.seconds.map((s) => Math.round(s * SCAN_FPS));
    // Refine P7 only where pose's wrist-based impact has a known bias the model can
    // correct: on DTL (and unknown angle) the clubhead reaches the ball a few frames
    // AFTER the wrists return to address height, so pose reads early and the visual
    // refine pulls it onto the strike. On FACE-ON the wrist height coincides with
    // impact (pose is already at the ball), and the model drifts late on ball-littered
    // range mats — so we trust pose and skip the model call entirely (also faster).
    const refineP7 = opts?.cameraAngle !== "face-on";
    if (opts?.apiKey && refineP7) {
      const refined = await refineImpact(videoPath, indices[6] / SCAN_FPS, duration, opts.apiKey, opts.cameraAngle, opts.club, POSE_IMPACT_REFINE_WINDOW);
      const minP7 = indices[3] + Math.round(MIN_DOWNSWING_SEC * SCAN_FPS);
      const maxP7 = indices[9] - Math.round(MIN_DOWNSWING_SEC * SCAN_FPS);
      if (refined != null && refined >= minP7 && refined <= maxP7) {
        indices = reanchorAroundP7(indices, refined);
      }
    }
    frameSeconds = indices.map((i) => i / SCAN_FPS);
  } else {
    const frameIndices = await selectSwingFramesSmart(videoPath, duration, opts);
    frameSeconds = frameIndices.map((i) => i / SCAN_FPS);
  }

  const frames: string[] = [];
  for (let i = 0; i < frameSeconds.length; i++) {
    const ts = frameSeconds[i].toFixed(4);
    const framePath = join(outputDir, `frame_${String(i + 1).padStart(3, "0")}.jpg`);
    execSync(
      `"${FFMPEG}" -ss ${ts} -i "${videoPath}" -vframes 1 -vf "scale=640:-2" -q:v 4 "${framePath}" -y -loglevel error`
    );
    if (existsSync(framePath)) frames.push(framePath);
  }

  if (frames.length !== 10) {
    throw new Error(`Frame extraction produced ${frames.length}/10 frames. Video may be too short or corrupt.`);
  }

  return frames;
}

function buildAnalysisPrompt(cameraAngle: CameraAngle, club: Club, historyContext?: string): string {
  const angleLabel = cameraAngle === "dtl" ? "down-the-line" : "face-on";

  const clubContext: Record<Club, string> = {
    driver: "Driver: widest stance, ball far forward (inside left heel), spine tilt away from target, positive AoA, wide arc.",
    fairway: "Fairway wood/hybrid: slightly narrower than driver, ball slightly forward of center, neutral to shallow attack angle.",
    "long-iron": "Long iron (3i-5i): neutral ball position, upright swing plane, steeper attack angle than driver, full shoulder turn.",
    "mid-iron": "Mid iron (6i-8i): neutral stance, ball slightly forward of center, standard swing plane, downward attack angle at impact.",
    wedge: "Wedge: narrow stance, ball center to slightly back, steepest attack angle, most shaft lean at impact.",
  };

  const angleContext: Record<CameraAngle, string> = {
    dtl: `Camera: DOWN-THE-LINE. Focus on: swing plane, club path and face angle, shaft angles, arm plane, hip/shoulder rotation, over-the-top or inside-out tendencies.`,
    "face-on": `Camera: FACE-ON. Focus on: weight transfer, spine tilt, hip slide vs turn, head position, knee flex, balance, shoulder plane.`,
  };

  const historySection = historyContext
    ? `\n## PLAYER HISTORY\n${historyContext}\n\nIf history is available, note whether patterns you observe in this swing are recurring (mention specific positions and whether you see improvement or regression). Reference this in the summary field only — do not change the P1-P10 grading criteria.\n`
    : "";

  return `You are an expert PGA-level golf instructor analyzing a golf swing. You have exactly 10 frames, each precisely detected at its swing position by a trained golf event-detection model — one per position. The mapping is fixed:

Frame 1 = P1 (Address)
Frame 2 = P2 (Takeaway)
Frame 3 = P3 (Lead arm parallel, backswing)
Frame 4 = P4 (Top of backswing)
Frame 5 = P5 (Lead arm parallel, downswing)
Frame 6 = P6 (Shaft parallel, downswing)
Frame 7 = P7 (Impact)
Frame 8 = P8 (Shaft parallel, follow-through)
Frame 9 = P9 (Trail arm parallel, follow-through)
Frame 10 = P10 (Finish)

Analyze each frame as its assigned position. Set the "frame" field in your JSON response to match the frame number (1–10) for each position.

CONTEXT:
- Camera: ${angleLabel.toUpperCase()}
- Club: ${club.replace("-", " ").toUpperCase()}
- ${clubContext[club]}

${angleContext[cameraAngle]}
${historySection}
POSITION IDENTIFICATION GUIDE — use these visual cues to identify which frame best matches each position:

P1 — ADDRESS: Golfer static at setup. Right knee flexed more than left. Spine neutral, head angled down toward ball. Both arms hanging, left arm straight. No movement yet.

P2 — TAKEAWAY (shaft parallel, backswing): Clubshaft and lead arm parallel to the target line at approximately hip height. Club positioned just outside the lead foot (face-on). Right knee beginning to lose flex, left knee beginning to flex. Right elbow starting to hinge.

P3 — LEAD ARM PARALLEL (backswing): Lead (left) arm parallel to the ground. Clubshaft pointing at the swing plane baseline, bisecting the lead bicep. Both elbows near level. Right knee still flexed. Lead arm angled slightly inside the baseline (~20 degrees).

P4 — TOP OF BACKSWING: Hands above and deeper than the trail shoulder. Right glute is the deepest point in the body. Trail knee has straightened (but not locked). Lead side of torso and lead thigh form roughly a 90-degree angle. Spine has extended from its P3 position. Head has moved toward the ball from its P3 position.

P5 — LEAD ARM PARALLEL (downswing): Mirror of P3 but on the way down. Lead side has shifted over the lead foot. Hands still above shoulder height. Lead shoulder moving up, trail shoulder moving down. Lead knee beginning to straighten. Lead wrist cocked at maximum. Lead arm pinned against the upper lead pec.

P6 — SHAFT PARALLEL (downswing): Clubshaft parallel to the ground on the way down. Trail elbow flexed approximately 120 degrees, connected to torso just above the belt. Lead knee continuing to straighten. Lead shoulder moving up. Lead wrist still fully cocked. Club approaching from inside the target line.

P7 — IMPACT: Club back at the ball. Lead knee straight. Lead shoulder up and beginning to move back away from target. Trail elbow still slightly flexed. Lead wrist uncocking through impact. Hips open to target, weight predominantly on lead side.

P8 — SHAFT PARALLEL (follow-through): Clubshaft parallel to ground past impact. Lead shoulder moving up and back (away from target). Trail shoulder moving down and forward (toward target). Lead ear now behind where the ball was. Only the heel of the trail foot lifted off ground.

P9 — TRAIL ARM PARALLEL (follow-through): Trail arm parallel to the ground in follow-through. Arms extended, chest rotating toward target. Full weight transfer to lead side. Club continuing to release.

P10 — FINISH: Full finish. Lead shoulder well behind original ball position. Belt buckle/hips pushed toward target. Weight on outside edge of lead foot, trail foot balanced on toe. Trail ear lower than lead ear. Lead elbow below lead shoulder. Thighs sealed together.

SCORING — give each position a score from 0 to 100 on a CALIBRATED scale, not a generous one. Anchor every position at 80: a sound, repeatable amateur position with nothing notably wrong is an 80 — that is the CENTER of the scale, not a high mark. Move UP from 80 only when the position is genuinely well-executed, and DOWN for any visible fault. The benchmark is a sound amateur, NOT a tour pro — but "no obvious fault" is an 80, not a 90. Most amateur positions land in the 75-85 range; reserve 90+ for a position you would screenshot as a model example. Score each position INDEPENDENTLY with fine-grained numbers and a real spread (e.g. a 78, an 84, a 91) — do NOT cluster everything in the high 80s / low 90s.
Bands: 90-100 = tour-quality, a model example (rare) | 85-89 = clearly better than the typical amateur, smallest refinement left | 80-84 = sound but unremarkable, the average competent amateur (DEFAULT) | 70-79 = a visible flaw a coach would point out | 60-69 = a real fault costing distance or accuracy | below 60 = a major fault.

IMPORTANT: Respond with ONLY valid JSON. No markdown, no code fences, no explanation.

{
  "summary": "<2-3 sentence executive summary>",
  "positions": {
    "P1": { "frame": <n>, "score": <0-100>, "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P2": { "frame": <n>, "score": <0-100>, "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P3": { "frame": <n>, "score": <0-100>, "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P4": { "frame": <n>, "score": <0-100>, "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P5": { "frame": <n>, "score": <0-100>, "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P6": { "frame": <n>, "score": <0-100>, "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P7": { "frame": <n>, "score": <0-100>, "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P8": { "frame": <n>, "score": <0-100>, "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P9": { "frame": <n>, "score": <0-100>, "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P10": { "frame": <n>, "score": <0-100>, "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" }
  },
  "priority_fix": {
    "position": "<P#>",
    "problem": "<description>",
    "why_it_matters": "<impact on ball flight>",
    "drill": "<specific drill>"
  },
  "drills": [
    {
      "name": "<drill name>",
      "target_position": "<P#>",
      "fault_addressed": "<specific fault this drill fixes>",
      "steps": ["<step 1>", "<step 2>", "<step 3>"],
      "youtube_search": "<short search query>",
      "youtube_url": "https://www.youtube.com/results?search_query=<url+encoded+query>"
    }
  ]
}

Provide 3–5 entries in "drills", ordered by priority — target the weakest positions and the priority_fix first. Each drill must be specific and actionable, with a real YouTube search URL (encode spaces as +).

Be specific and honest. Reference what you actually see in the frames.`;
}

function cleanJson(text: string): string {
  let t = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  // Strip any preface like "Here's the analysis:" — slice from the first { or [ to its matching close.
  const firstObj = t.indexOf("{");
  const firstArr = t.indexOf("[");
  const candidates = [firstObj, firstArr].filter(i => i >= 0);
  if (candidates.length === 0) return t;
  const start = Math.min(...candidates);
  const opener = t[start];
  const closer = opener === "{" ? "}" : "]";
  const end = t.lastIndexOf(closer);
  if (end > start) t = t.slice(start, end + 1);
  return t.trim();
}

function parseModelJson<T>(text: string, label: string): T {
  const cleaned = cleanJson(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    const preview = cleaned.slice(0, 200);
    throw new Error(`Model returned invalid JSON for ${label}: ${(e as Error).message}. Got: ${preview}`);
  }
}

const GRADE_ORDER: Record<string, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };

// Per-position weights for the overall score (sum = 100). Impact is king; the
// strike-defining positions (P4 top, P6 delivery, P7 impact, P10 finish/balance)
// carry the most weight; takeaway and early follow-through carry the least.
const POSITION_WEIGHTS: Record<string, number> = {
  P1: 10, P2: 5, P3: 8, P4: 12, P5: 9, P6: 12, P7: 18, P8: 7, P9: 7, P10: 12,
};

function scoreToGrade(s: number): Grade {
  if (s >= 90) return "A";
  if (s >= 80) return "B";
  if (s >= 70) return "C";
  if (s >= 60) return "D";
  return "F";
}

// Deterministic, weighted overall score from the per-position scores. Also
// backfills each position's letter grade from its score so the number and the
// letters can never disagree. Mutates and returns the analysis.
function computeWeightedScore(analysis: Analysis): Analysis {
  let weighted = 0;
  let totalWeight = 0;
  for (const [pos, data] of Object.entries(analysis.positions)) {
    const s = Math.max(0, Math.min(100, Math.round(data.score ?? 0)));
    data.score = s;
    data.grade = scoreToGrade(s);
    const w = POSITION_WEIGHTS[pos] ?? 0;
    weighted += s * w;
    totalWeight += w;
  }
  analysis.overall_score = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;
  return analysis;
}

export function buildHistoryContext(
  pastAnalyses: Array<{
    overall_score: number;
    overall_grade: string;
    positions: Record<string, { grade: string }>;
    priority_fix: { position: string; problem: string };
    club: string;
    camera_angle: string;
    created_at: string;
  }>
): string {
  const lines = pastAnalyses.map((a) => {
    const date = new Date(a.created_at).toISOString().slice(0, 10);
    const grades = Object.entries(a.positions)
      .map(([pos, d]) => `${pos}:${d.grade}`)
      .join(" ");
    return `- [${date}] ${a.club} ${a.camera_angle.toUpperCase()} | Score: ${a.overall_score} | Priority: ${a.priority_fix.position} ${a.priority_fix.problem.slice(0, 60)}\n  Position grades: ${grades}`;
  });
  return `PLAYER HISTORY (last ${pastAnalyses.length} session${pastAnalyses.length !== 1 ? "s" : ""}, most recent first):\n${lines.join("\n")}`;
}

export async function analyzeSwing(
  framePaths: string[],
  cameraAngle: CameraAngle,
  club: Club,
  apiKey: string,
  historyContext?: string
): Promise<Analysis> {
  const client = new Anthropic({ apiKey, maxRetries: 4 });

  const imageBlocks = framePaths.map((framePath) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/jpeg" as const,
      data: readFileSync(framePath).toString("base64"),
    },
  }));

  const contentBlocks: Anthropic.MessageParam["content"] = [];
  imageBlocks.forEach((block, i) => {
    contentBlocks.push({ type: "text", text: `Frame ${i + 1}/${framePaths.length}:` });
    contentBlocks.push(block);
  });
  contentBlocks.push({ type: "text", text: buildAnalysisPrompt(cameraAngle, club, historyContext) });

  const t0 = Date.now();
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 6144,
    messages: [{ role: "user", content: contentBlocks }],
  });
  console.log(`[timing] analyzeSwing model call: ${Date.now() - t0}ms`);

  const analysis = parseModelJson<Analysis>((response.content[0] as { text: string }).text, "swing analysis");
  if (!Array.isArray(analysis.drills)) analysis.drills = [];
  computeWeightedScore(analysis); // deterministic weighted overall + derive letter grades from scores
  return analysis;
}

export async function generateDrills(
  analysis: Analysis,
  club: Club,
  apiKey: string
): Promise<Drill[]> {
  const client = new Anthropic({ apiKey, maxRetries: 4 });
  return getDrillRecommendations(client, analysis, club);
}

async function getDrillRecommendations(
  client: Anthropic,
  analysis: Analysis,
  club: Club
): Promise<Drill[]> {
  const weakPositions = Object.entries(analysis.positions)
    .filter(([, data]) => data.issue)
    .sort((a, b) => GRADE_ORDER[a[1].grade] - GRADE_ORDER[b[1].grade])
    .slice(0, 4);

  const weakSummary = weakPositions
    .map(([pos, data]) => `${pos} (Grade: ${data.grade}): ${data.issue} — Fix: ${data.fix}`)
    .join("\n");

  const prompt = `You are a PGA golf instructor. Based on this swing analysis, recommend 3-5 targeted drills.

CLUB: ${club.replace("-", " ").toUpperCase()}
OVERALL SCORE: ${analysis.overall_score}/100

WEAKEST POSITIONS:
${weakSummary}

PRIORITY ISSUE: ${analysis.priority_fix.position} — ${analysis.priority_fix.problem}

IMPORTANT: Respond with ONLY valid JSON array. No markdown, no code fences.

[
  {
    "name": "<drill name>",
    "target_position": "<P#>",
    "fault_addressed": "<specific fault>",
    "steps": ["<step 1>", "<step 2>", "<step 3>"],
    "youtube_search": "<search query>",
    "youtube_url": "<https://www.youtube.com/results?search_query=encoded+query>"
  }
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  return parseModelJson<Drill[]>((response.content[0] as { text: string }).text, "drills");
}

export async function runAnalysis(
  videoPath: string,
  framesDir: string,
  cameraAngle: CameraAngle,
  club: Club,
  apiKey: string
) {
  const frames = await extractFrames(videoPath, framesDir, { apiKey, cameraAngle, club });
  if (frames.length === 0) throw new Error("No frames extracted from video.");

  const analysis = await analyzeSwing(frames, cameraAngle, club, apiKey);
  const drills: Drill[] = analysis.drills ?? [];

  const swingFrames: string[] = [];
  for (let n = 1; n <= 10; n++) {
    const framePath = join(framesDir, `frame_${String(n).padStart(3, "0")}.jpg`);
    if (existsSync(framePath)) {
      swingFrames.push(`data:image/jpeg;base64,${readFileSync(framePath).toString("base64")}`);
    }
  }

  return { analysis, drills, frames: swingFrames };
}
