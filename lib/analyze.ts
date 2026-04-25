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
  try {
    const out = execSync(
      `"${FFMPEG}" -i "${videoPath}" -filter:v "select='gt(scene,0.4)',showinfo" -f null - 2>&1`,
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
    );
    const matches = out.match(/pts_time:[0-9.]+/g) ?? [];
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

function selectSwingFrames(videoPath: string, videoDuration: number): number[] {
  const rawFrames = execSync(
    `"${FFMPEG}" -i "${videoPath}" -vf "fps=${SCAN_FPS},scale=160:90,format=gray" -f rawvideo pipe:1 -loglevel error`,
    { maxBuffer: 200 * 1024 * 1024 }
  );

  const frameCount = Math.floor(rawFrames.length / FRAME_SIZE);
  const evenly = (start: number, end: number) =>
    Array.from({ length: 10 }, (_, i) => Math.floor(start + (i * (end - start)) / 9));
  const fallback = evenly(0, frameCount - 1);
  if (frameCount < 30) return fallback;

  // Crop analysis to the longest cut-free segment — kills TikTok overlays / edits.
  // Pad inward by 0.2s on each side so cut transitions don't bleed into the diff signal.
  const cuts = detectSceneCuts(videoPath);
  const [segStartSec, segEndSec] = longestCleanSegment(cuts, videoDuration);
  const padFrames = Math.floor(SCAN_FPS * 0.2);
  const segStart = Math.max(0, Math.floor(segStartSec * SCAN_FPS) + padFrames);
  const segEnd = Math.min(frameCount - 1, Math.floor(segEndSec * SCAN_FPS) - padFrames);
  if (segEnd - segStart < 30) return fallback;

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
  if (maxDiff === 0) return evenly(segStart, segEnd);

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

  // P4 — top of backswing. Constrained to a biomechanically realistic window
  // (downswing duration is 0.18–0.55s for human swings). Pick the LOCAL MINIMUM
  // in that window — that's the transition pause at the top. This avoids placing
  // P4 way too early at a setup/waggle lull.
  const p4SearchEnd = p7 - Math.floor(SCAN_FPS * 0.18);
  const p4SearchStart = Math.max(segStart, p7 - Math.floor(SCAN_FPS * 0.55));
  let p4 = p4SearchStart;
  let p4Min = Infinity;
  for (let i = p4SearchStart; i <= p4SearchEnd; i++) {
    if (s[i] < p4Min) { p4Min = s[i]; p4 = i; }
  }

  // P1 — last quiet frame before P4 (motion < 5% of max, sustained 5+ frames)
  let p1 = 0;
  const addressQuietFrames = 5;
  for (let i = p4 - addressQuietFrames; i >= addressQuietFrames; i--) {
    let quiet = true;
    for (let j = i; j < i + addressQuietFrames; j++) {
      if (s[j] >= maxDiff * 0.05) { quiet = false; break; }
    }
    if (quiet) { p1 = i + addressQuietFrames; break; }
  }

  // P10 — first quiet frame after P7 (motion < 8% of max, sustained 0.3s = 18 frames),
  // bounded by the clean segment so we never walk into a scene cut / TikTok screen
  const finishQuietFrames = Math.floor(SCAN_FPS * 0.3);
  let p10 = Math.min(segEnd, p7 + Math.floor(SCAN_FPS * 2.5));
  for (let i = p7 + 1; i < segEnd - finishQuietFrames; i++) {
    let quiet = true;
    for (let j = i; j < i + finishQuietFrames; j++) {
      if (s[j] >= maxDiff * 0.08) { quiet = false; break; }
    }
    if (quiet) { p10 = i + Math.floor(finishQuietFrames / 2); break; }
  }

  // P2, P3 — placed via cumulative motion through the backswing window.
  // Cumulative integration washes out brief waggle motion that would otherwise
  // pull P2 way back into the setup. P2 ≈ early takeaway, P3 ≈ late backswing.
  const bsCum = cumulativeSum(s, p1, p4);
  const p2 = frameAtRatio(p1, bsCum, 0.20);
  const p3 = frameAtRatio(p1, bsCum, 0.65);

  // P5, P6: 35% and 75% cumulative motion through downswing
  const dsCum = cumulativeSum(s, p4, p7);
  const p5 = frameAtRatio(p4, dsCum, 0.35);
  const p6 = frameAtRatio(p4, dsCum, 0.75);

  // P8, P9: 25% and 60% cumulative motion through follow-through
  const ftCum = cumulativeSum(s, p7, p10);
  const p8 = frameAtRatio(p7, ftCum, 0.25);
  const p9 = frameAtRatio(p7, ftCum, 0.60);

  // Sanity check — a real swing is roughly 1.0–4.5s end-to-end. If our picks collapse
  // (all the same frame, or duration outside that range), fall back to evenly-spaced
  // frames within the clean segment instead of returning garbage.
  const swingDurationSec = (p10 - p1) / SCAN_FPS;
  const positions = [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10];
  const uniqueFrames = new Set(positions).size;
  if (swingDurationSec < 1.0 || swingDurationSec > 5.0 || uniqueFrames < 8) {
    return evenly(segStart, segEnd);
  }

  return positions;
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
