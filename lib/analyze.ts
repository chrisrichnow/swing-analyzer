import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import { readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { Analysis, Drill, CameraAngle, Club } from "@/types";

const ext = process.platform === "win32" ? ".exe" : "";
const FFMPEG = join(process.cwd(), `node_modules/ffmpeg-static/ffmpeg${ext}`);
const FFPROBE = join(process.cwd(), `node_modules/ffprobe-static/bin/${process.platform}/${process.arch}/ffprobe${ext}`);

const FRAME_COUNT = 18;

function detectSwingWindow(videoPath: string, videoDuration: number): { start: number; duration: number } {
  const scanFps = 6;
  const frameSize = 160 * 90;

  const rawFrames = execSync(
    `"${FFMPEG}" -i "${videoPath}" -vf "fps=${scanFps},scale=160:90,format=gray" -f rawvideo pipe:1 -loglevel error`,
    { maxBuffer: 50 * 1024 * 1024 }
  );

  const frameCount = Math.floor(rawFrames.length / frameSize);
  if (frameCount < 3) return { start: 0, duration: videoDuration };

  // Compute per-frame diffs
  const diffs: number[] = [0];
  let maxDiff = 0;
  let peakIdx = Math.floor(frameCount / 2);

  for (let i = 1; i < frameCount; i++) {
    let diff = 0;
    const prevOff = (i - 1) * frameSize;
    const currOff = i * frameSize;
    for (let j = 0; j < frameSize; j++) {
      diff += Math.abs(rawFrames[prevOff + j] - rawFrames[currOff + j]);
    }
    diffs.push(diff);
    if (diff > maxDiff) {
      maxDiff = diff;
      peakIdx = i;
    }
  }

  // Walk backwards from impact to find where motion drops below threshold (address/setup)
  const motionThreshold = maxDiff * 0.06;
  let motionOnset = peakIdx;
  for (let i = peakIdx; i >= 1; i--) {
    if (diffs[i] < motionThreshold) {
      motionOnset = i;
      break;
    }
  }

  // Start 0.5s before motion onset to include one clean address frame
  const windowStart = Math.max(0, (motionOnset / scanFps) - 0.5);
  const windowEnd = Math.min(videoDuration, (peakIdx / scanFps) + 2.0);

  return { start: windowStart, duration: windowEnd - windowStart };
}

function extractFrames(videoPath: string, outputDir: string): string[] {
  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  const probeResult = execSync(
    `"${FFPROBE}" -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "${videoPath}"`,
    { encoding: "utf8" }
  ).trim();

  const duration = parseFloat(probeResult);
  const swing = detectSwingWindow(videoPath, duration);

  execSync(
    `"${FFMPEG}" -ss ${swing.start.toFixed(3)} -i "${videoPath}" -t ${swing.duration.toFixed(3)} -vf "fps=${FRAME_COUNT}/${swing.duration.toFixed(3)},scale=640:-2" -q:v 4 "${outputDir}/frame_%03d.jpg" -y -loglevel error`
  );

  const frames: string[] = [];
  for (let i = 1; i <= FRAME_COUNT; i++) {
    const framePath = join(outputDir, `frame_${String(i).padStart(3, "0")}.jpg`);
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

  return `You are an expert PGA-level golf instructor analyzing a golf swing. You have ${FRAME_COUNT} sequential frames captured from address (static setup) through finish — the full swing window. Frame 1 should show the golfer at address before any movement begins.

CONTEXT:
- Camera: ${angleLabel.toUpperCase()}
- Club: ${club.replace("-", " ").toUpperCase()}
- ${clubContext[club]}

${angleContext[cameraAngle]}

Analyze using P1-P10: P1=Address, P2=Takeaway, P3=Lead arm parallel (backswing), P4=Top, P5=Lead arm parallel (downswing), P6=Delivery, P7=Impact, P8=Shaft parallel (follow-through), P9=Lead arm parallel (follow-through), P10=Finish.

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
  for (let n = 1; n <= FRAME_COUNT; n++) {
    const framePath = join(framesDir, `frame_${String(n).padStart(3, "0")}.jpg`);
    if (existsSync(framePath)) {
      swingFrames.push(`data:image/jpeg;base64,${readFileSync(framePath).toString("base64")}`);
    }
  }

  rmSync(framesDir, { recursive: true });

  return { analysis, drills, frames: swingFrames };
}
