import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import { readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { Analysis, Drill, CameraAngle, Club } from "@/types";

const ext = process.platform === "win32" ? ".exe" : "";
const FFMPEG = join(process.cwd(), `node_modules/ffmpeg-static/ffmpeg${ext}`);
const FFPROBE = join(process.cwd(), `node_modules/ffprobe-static/bin/${process.platform}/${process.arch}/ffprobe${ext}`);

const SCAN_FPS = 60;
const FRAME_SIZE = 160 * 90;
const MIN_SWING_FRAMES = SCAN_FPS * 1.0;   // 60 frames = 1.0s minimum swing
const MAX_SWING_FRAMES = SCAN_FPS * 6.0;   // 360 frames = 6.0s maximum swing
const QUIET_ZONE_FRAMES = SCAN_FPS;         // 60 frames = 1s to qualify as a quiet zone
const QUIET_THRESHOLD = 0.10;              // below 10% of global max = quiet
const SWING_PEAK_THRESHOLD = 0.25;         // swing window must peak above 25% of global max

function smooth(diffs: number[], window: number): number[] {
  return diffs.map((_, i) => {
    const lo = Math.max(0, i - window);
    const hi = Math.min(diffs.length - 1, i + window);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += diffs[j];
    return sum / (hi - lo + 1);
  });
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

function detectSwingWindow(s: number[], frameCount: number): [number, number] {
  const globalMax = Math.max(...s);

  // Find contiguous "quiet zones" — runs of frames below 10% of global max, lasting >= 1 second
  const quietZones: Array<[number, number]> = [];
  let runStart = -1;
  for (let i = 0; i < frameCount; i++) {
    if (s[i] < globalMax * QUIET_THRESHOLD) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1 && (i - runStart) >= QUIET_ZONE_FRAMES) {
        quietZones.push([runStart, i - 1]);
      }
      runStart = -1;
    }
  }
  if (runStart !== -1 && (frameCount - runStart) >= QUIET_ZONE_FRAMES) {
    quietZones.push([runStart, frameCount - 1]);
  }

  // Candidate swing windows are the gaps between adjacent quiet zones
  const gapBoundaries: Array<[number, number]> = [];
  if (quietZones.length === 0) {
    gapBoundaries.push([0, frameCount - 1]);
  } else {
    if (quietZones[0][0] > 0) gapBoundaries.push([0, quietZones[0][0] - 1]);
    for (let i = 0; i < quietZones.length - 1; i++) {
      gapBoundaries.push([quietZones[i][1] + 1, quietZones[i + 1][0] - 1]);
    }
    if (quietZones[quietZones.length - 1][1] < frameCount - 1) {
      gapBoundaries.push([quietZones[quietZones.length - 1][1] + 1, frameCount - 1]);
    }
  }

  // Filter candidates by duration and peak motion, pick the one with the highest peak
  let bestWindow: [number, number] | null = null;
  let bestPeak = 0;
  for (const [gStart, gEnd] of gapBoundaries) {
    const duration = gEnd - gStart + 1;
    if (duration < MIN_SWING_FRAMES || duration > MAX_SWING_FRAMES) continue;
    let windowPeak = 0;
    for (let i = gStart; i <= gEnd; i++) {
      if (s[i] > windowPeak) windowPeak = s[i];
    }
    if (windowPeak < globalMax * SWING_PEAK_THRESHOLD) continue;
    if (windowPeak > bestPeak) { bestPeak = windowPeak; bestWindow = [gStart, gEnd]; }
  }
  if (bestWindow) return bestWindow;

  // Fallback: 4-second window centered on the global peak
  let globalPeakFrame = 0;
  for (let i = 0; i < frameCount; i++) { if (s[i] > s[globalPeakFrame]) globalPeakFrame = i; }
  const halfWindow = SCAN_FPS * 2;
  return [Math.max(0, globalPeakFrame - halfWindow), Math.min(frameCount - 1, globalPeakFrame + halfWindow)];
}

function validateAndRefine(
  s: number[],
  swingStart: number,
  swingEnd: number,
  swingMax: number,
  p1: number,
  p4: number,
  p7: number,
  p10: number
): [number, number, number, number] {
  const MIN_BS = 15, MAX_BS = 240;   // backswing frames
  const MIN_DS = 6,  MAX_DS = 120;   // downswing frames
  const MIN_FT = 12, MAX_FT = 180;   // follow-through frames

  function valid(a: number, b: number, c: number, d: number): boolean {
    return (b - a) >= MIN_BS && (b - a) <= MAX_BS &&
           (c - b) >= MIN_DS && (c - b) <= MAX_DS &&
           (d - c) >= MIN_FT && (d - c) <= MAX_FT;
  }

  if (valid(p1, p4, p7, p10)) return [p1, p4, p7, p10];

  // Pass 2: relax quiet thresholds by 2x and re-search
  let p4r = swingStart + Math.floor((p7 - swingStart) * 0.5);
  for (let i = p7 - 1; i >= swingStart; i--) {
    if (s[i] < swingMax * 0.30) { p4r = i; break; }
  }
  let p1r = swingStart;
  for (let i = p4r - 3; i >= swingStart + 3; i--) {
    let quiet = true;
    for (let j = i; j < i + 3; j++) { if (s[j] >= swingMax * 0.10) { quiet = false; break; } }
    if (quiet) { p1r = i + 3; break; }
  }
  let p10r = Math.min(swingEnd, p7 + Math.floor(SCAN_FPS * 2.5));
  for (let i = p7 + 1; i <= swingEnd - 9; i++) {
    let quiet = true;
    for (let j = i; j < i + 9; j++) { if (s[j] >= swingMax * 0.16) { quiet = false; break; } }
    if (quiet) { p10r = i + 4; break; }
  }
  if (valid(p1r, p4r, p7, p10r)) return [p1r, p4r, p7, p10r];

  // Pass 3: use window extremes as bounds
  const p4exp = swingStart + Math.floor((p7 - swingStart) * 0.40);
  if (valid(swingStart, p4exp, p7, swingEnd)) return [swingStart, p4exp, p7, swingEnd];

  // Final fallback: evenly distribute 4 anchors within the window
  const span = swingEnd - swingStart;
  return [
    swingStart,
    swingStart + Math.floor(span * 0.33),
    swingStart + Math.floor(span * 0.55),
    swingEnd,
  ];
}

function selectSwingFrames(videoPath: string, videoDuration: number): number[] {
  const rawFrames = execSync(
    `"${FFMPEG}" -i "${videoPath}" -vf "fps=${SCAN_FPS},scale=160:90,format=gray" -f rawvideo pipe:1 -loglevel error`,
    { maxBuffer: 200 * 1024 * 1024 }
  );

  const frameCount = Math.floor(rawFrames.length / FRAME_SIZE);
  if (frameCount < 30) {
    // Too few frames — distribute evenly across whole video
    return Array.from({ length: 10 }, (_, i) => Math.floor(i * frameCount / 10));
  }

  // Compute raw diffs then smooth
  const raw: number[] = [0];
  for (let i = 1; i < frameCount; i++) {
    let d = 0;
    const p = (i - 1) * FRAME_SIZE, c = i * FRAME_SIZE;
    for (let j = 0; j < FRAME_SIZE; j++) d += Math.abs(rawFrames[p + j] - rawFrames[c + j]);
    raw.push(d);
  }
  const s = smooth(raw, 3);
  const maxDiff = Math.max(...s);

  // Evenly distribute within the whole video as the last-resort fallback
  const fallback = Array.from({ length: 10 }, (_, i) => Math.floor(i * frameCount / 10));
  if (maxDiff === 0) return fallback;

  // Isolate the actual swing window to avoid locking onto TikTok loading screens or pre-roll
  const [swingStart, swingEnd] = detectSwingWindow(s, frameCount);
  const windowFallback = Array.from({ length: 10 }, (_, i) =>
    swingStart + Math.floor(i * (swingEnd - swingStart) / 10)
  );

  // Compute the window-local max so all thresholds scale to the actual swing, not global noise
  let swingMax = 0;
  for (let i = swingStart; i <= swingEnd; i++) { if (s[i] > swingMax) swingMax = s[i]; }
  if (swingMax === 0) return windowFallback;

  // P7 — highest motion peak within the swing window
  let p7 = swingStart;
  for (let i = swingStart; i <= swingEnd; i++) { if (s[i] > s[p7]) p7 = i; }
  // Refine to the local max in a 1s window around that candidate
  const refineWindow = SCAN_FPS;
  for (
    let i = Math.max(swingStart, p7 - refineWindow);
    i <= Math.min(swingEnd, p7 + Math.floor(refineWindow * 0.5));
    i++
  ) { if (s[i] > s[p7]) p7 = i; }

  // P4 — last quiet point before P7, bounded by swingStart
  let p4 = swingStart + Math.floor((p7 - swingStart) * 0.5);
  for (let i = p7 - 1; i >= swingStart; i--) {
    if (s[i] < swingMax * 0.15) { p4 = i; break; }
  }

  // P1 — last sustained quiet window before P4, bounded by swingStart
  let p1 = swingStart;
  const addressQuietFrames = 5;
  for (let i = p4 - addressQuietFrames; i >= swingStart + addressQuietFrames; i--) {
    let quiet = true;
    for (let j = i; j < i + addressQuietFrames; j++) {
      if (s[j] >= swingMax * 0.05) { quiet = false; break; }
    }
    if (quiet) { p1 = i + addressQuietFrames; break; }
  }

  // P10 — first sustained quiet window after P7, bounded by swingEnd
  const finishQuietFrames = Math.floor(SCAN_FPS * 0.3);
  let p10 = Math.min(swingEnd, p7 + Math.floor(SCAN_FPS * 2.5));
  for (let i = p7 + 1; i <= swingEnd - finishQuietFrames; i++) {
    let quiet = true;
    for (let j = i; j < i + finishQuietFrames; j++) {
      if (s[j] >= swingMax * 0.08) { quiet = false; break; }
    }
    if (quiet) { p10 = i + Math.floor(finishQuietFrames / 2); break; }
  }

  // Validate temporal plausibility and progressively relax if needed
  const [p1f, p4f, p7f, p10f] = validateAndRefine(s, swingStart, swingEnd, swingMax, p1, p4, p7, p10);

  // Safety guard — monotonicity must hold
  if (!(p1f < p4f && p4f < p7f && p7f < p10f)) return windowFallback;

  // Intermediates via cumulative motion with biomechanical priors
  // P2: takeaway onset — first frame in P1→P4 exceeding 15% of backswing segment peak
  const bsSlice = s.slice(p1f, p4f + 1);
  const bsPeak = Math.max(...bsSlice);
  let p2 = p1f + 1;
  for (let i = p1f; i < p4f; i++) {
    if (s[i] >= bsPeak * 0.15) { p2 = i; break; }
  }

  // P3: 60% cumulative motion through backswing
  const bsCum = cumulativeSum(s, p1f, p4f);
  const p3 = frameAtRatio(p1f, bsCum, 0.60);

  // P5, P6: 35% and 75% cumulative motion through downswing
  const dsCum = cumulativeSum(s, p4f, p7f);
  const p5 = frameAtRatio(p4f, dsCum, 0.35);
  const p6 = frameAtRatio(p4f, dsCum, 0.75);

  // P8, P9: 25% and 60% cumulative motion through follow-through
  const ftCum = cumulativeSum(s, p7f, p10f);
  const p8 = frameAtRatio(p7f, ftCum, 0.25);
  const p9 = frameAtRatio(p7f, ftCum, 0.60);

  return [p1f, p2, p3, p4f, p5, p6, p7f, p8, p9, p10f];
}

function extractFrames(videoPath: string, outputDir: string): string[] {
  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  const probeResult = execSync(
    `"${FFPROBE}" -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "${videoPath}"`,
    { encoding: "utf8" }
  ).trim();

  const duration = parseFloat(probeResult);
  const frameIndices = selectSwingFrames(videoPath, duration);

  const frames: string[] = [];
  for (let i = 0; i < frameIndices.length; i++) {
    const ts = (frameIndices[i] / SCAN_FPS).toFixed(4);
    const framePath = join(outputDir, `frame_${String(i + 1).padStart(3, "0")}.jpg`);
    execSync(
      `"${FFMPEG}" -ss ${ts} -i "${videoPath}" -vframes 1 -vf "scale=640:-2" -q:v 4 "${framePath}" -y -loglevel error`
    );
    if (existsSync(framePath)) frames.push(framePath);
  }

  return frames;
}

function buildAnalysisPrompt(cameraAngle: CameraAngle, club: Club): string {
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

  return `You are an expert PGA-level golf instructor analyzing a golf swing. You have exactly 10 frames, evenly extracted across the full swing window — one per position. The mapping is fixed:

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

CONTENT QUALITY CHECK: Before analyzing, scan all 10 frames. If any frame appears to show a loading screen, social media overlay, title card, or non-golf content (no golfer visible), set that position's "grade" to "F", set "issue" to "Frame does not contain golf swing content — video may need trimming before re-upload", and set "what_is_good" to "N/A". Flag this in the "summary" so the user knows the video quality is the issue.

IMPORTANT: Respond with ONLY valid JSON. No markdown, no code fences, no explanation.

{
  "overall_score": <0-100>,
  "summary": "<2-3 sentence executive summary>",
  "positions": {
    "P1": { "frame": <n>, "grade": "<A|B|C|D|F>", "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P2": { "frame": <n>, "grade": "<A|B|C|D|F>", "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P3": { "frame": <n>, "grade": "<A|B|C|D|F>", "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P4": { "frame": <n>, "grade": "<A|B|C|D|F>", "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P5": { "frame": <n>, "grade": "<A|B|C|D|F>", "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P6": { "frame": <n>, "grade": "<A|B|C|D|F>", "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P7": { "frame": <n>, "grade": "<A|B|C|D|F>", "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P8": { "frame": <n>, "grade": "<A|B|C|D|F>", "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P9": { "frame": <n>, "grade": "<A|B|C|D|F>", "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" },
    "P10": { "frame": <n>, "grade": "<A|B|C|D|F>", "what_is_good": "<string>", "issue": "<string or null>", "fix": "<string>" }
  },
  "priority_fix": {
    "position": "<P#>",
    "problem": "<description>",
    "why_it_matters": "<impact on ball flight>",
    "drill": "<specific drill>"
  }
}

Be specific and honest. Reference what you actually see in the frames.`;
}

function cleanJson(text: string): string {
  return text.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
}

const GRADE_ORDER: Record<string, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };

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

  return JSON.parse(cleanJson((response.content[0] as { text: string }).text));
}

export async function runAnalysis(
  videoPath: string,
  framesDir: string,
  cameraAngle: CameraAngle,
  club: Club,
  apiKey: string
) {
  const client = new Anthropic({ apiKey, maxRetries: 4 });

  const frames = extractFrames(videoPath, framesDir);
  if (frames.length === 0) throw new Error("No frames extracted from video.");

  const imageBlocks = frames.map((framePath) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/jpeg" as const,
      data: readFileSync(framePath).toString("base64"),
    },
  }));

  const contentBlocks: Anthropic.MessageParam["content"] = [];
  imageBlocks.forEach((block, i) => {
    contentBlocks.push({ type: "text", text: `Frame ${i + 1}/${frames.length}:` });
    contentBlocks.push(block);
  });
  contentBlocks.push({ type: "text", text: buildAnalysisPrompt(cameraAngle, club) });

  const analysisResponse = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: contentBlocks }],
  });

  const analysis: Analysis = JSON.parse(
    cleanJson((analysisResponse.content[0] as { text: string }).text)
  );

  let drills: Drill[] = [];
  try {
    drills = await getDrillRecommendations(client, analysis, club);
  } catch {
    // drills are non-critical
  }

  const swingFrames: string[] = [];
  for (let n = 1; n <= 10; n++) {
    const framePath = join(framesDir, `frame_${String(n).padStart(3, "0")}.jpg`);
    if (existsSync(framePath)) {
      swingFrames.push(`data:image/jpeg;base64,${readFileSync(framePath).toString("base64")}`);
    }
  }

  rmSync(framesDir, { recursive: true });

  return { analysis, drills, frames: swingFrames };
}
