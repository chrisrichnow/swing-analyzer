/**
 * Swing Analyzer — A/B Test Harness
 *
 * Usage:
 *   node scripts/test-harness.mjs --video path/to/swing.mp4 [options]
 *
 * Options:
 *   --video <path>       Path to the swing video file (required)
 *   --angle <dtl|face-on>  Camera angle (default: dtl)
 *   --club <driver|fairway|long-iron|mid-iron|wedge>  Club type (default: mid-iron)
 *   --variants <a,b,c>   Comma-separated variant names to run (default: all)
 *   --out <dir>          Output directory (default: test-results/run-{timestamp})
 *
 * Examples:
 *   node scripts/test-harness.mjs --video my_swing.mp4
 *   node scripts/test-harness.mjs --video my_swing.mp4 --variants baseline,opus-vision
 *   node scripts/test-harness.mjs --video my_swing.mp4 --angle face-on --club driver
 */

import { execSync } from "child_process";
import { readFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";

// ─── Setup ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

dotenv.config({ path: join(PROJECT_ROOT, ".env.local") });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Error: ANTHROPIC_API_KEY not found in .env.local");
  process.exit(1);
}

const ext = process.platform === "win32" ? ".exe" : "";
const FFMPEG = join(PROJECT_ROOT, `node_modules/ffmpeg-static/ffmpeg${ext}`);
const FFPROBE = join(PROJECT_ROOT, `node_modules/ffprobe-static/bin/${process.platform}/${process.arch}/ffprobe${ext}`);

// ─── Config schema & defaults ─────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  // Frame extraction
  scanFps: 60,
  scanWidth: 160,
  scanHeight: 90,
  outputWidth: 640,
  smoothWindow: 3,
  // Motion thresholds
  p7ThresholdPct: 0.80,
  p4ThresholdPct: 0.15,
  p1ThresholdPct: 0.05,
  p1QuietFrames: 5,
  p10ThresholdPct: 0.08,
  p10QuietSeconds: 0.3,
  // Cumulative ratios
  p2TakeawayPct: 0.15,
  p3Ratio: 0.60,
  p5Ratio: 0.35,
  p6Ratio: 0.75,
  p8Ratio: 0.25,
  p9Ratio: 0.60,
  // Model
  analysisModel: "claude-sonnet-4-6",
  drillsModel: "claude-sonnet-4-6",
  maxTokensAnalysis: 4096,
  maxTokensDrills: 2048,
};

// ─── Variants ─────────────────────────────────────────────────────────────────

const VARIANTS = {
  // — Model variants —
  "baseline": {},
  "opus-vision": {
    analysisModel: "claude-opus-4-7",
  },
  "opus-full": {
    analysisModel: "claude-opus-4-7",
    drillsModel: "claude-opus-4-7",
  },

  // — Output resolution variants —
  "frames-480": { outputWidth: 480 },
  "frames-1024": { outputWidth: 1024 },

  // — Scan FPS variants —
  "scan-30fps": { scanFps: 30 },
  "scan-24fps": { scanFps: 24 },

  // — Scan resolution variants —
  "scan-hires": { scanWidth: 320, scanHeight: 180 },

  // — P7 (impact detection) threshold variants —
  "p7-strict": { p7ThresholdPct: 0.90 },
  "p7-loose":  { p7ThresholdPct: 0.70 },

  // — P4 (top of backswing) threshold variants —
  "p4-strict": { p4ThresholdPct: 0.10 },
  "p4-loose":  { p4ThresholdPct: 0.20 },

  // — Cumulative ratio variants —
  "ratios-conservative": { p3Ratio: 0.50, p5Ratio: 0.30, p6Ratio: 0.70, p8Ratio: 0.20, p9Ratio: 0.55 },
  "ratios-aggressive":   { p3Ratio: 0.70, p5Ratio: 0.40, p6Ratio: 0.80, p8Ratio: 0.30, p9Ratio: 0.65 },

  // — P10 (finish detection) variants — default triggers too early (66ms after impact) —
  "p10-wait-longer":  { p10QuietSeconds: 1.0 },                // need 1s of quiet before declaring finish
  "p10-stricter":     { p10ThresholdPct: 0.03 },               // motion must drop to <3% of max (was 8%)
  "p10-both":         { p10QuietSeconds: 1.0, p10ThresholdPct: 0.03 },

  // — P1 (address detection) variants — default fails to find address (lands on frame 0) —
  "p1-relaxed":       { p1ThresholdPct: 0.10, p1QuietFrames: 3 }, // easier quiet requirement
  "p1-very-relaxed":  { p1ThresholdPct: 0.15, p1QuietFrames: 2 }, // even easier

  // — Combined P1 + P10 fix —
  "detection-fix":    { p1ThresholdPct: 0.10, p1QuietFrames: 3, p10QuietSeconds: 1.0, p10ThresholdPct: 0.03 },

  // — Combo: best-guess quality upgrade —
  "quality-max": {
    outputWidth: 1024,
    analysisModel: "claude-opus-4-7",
    maxTokensAnalysis: 8192,
  },
};

// ─── Frame extraction helpers ─────────────────────────────────────────────────

function smooth(diffs, window) {
  return diffs.map((_, i) => {
    const lo = Math.max(0, i - window);
    const hi = Math.min(diffs.length - 1, i + window);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += diffs[j];
    return sum / (hi - lo + 1);
  });
}

function cumulativeSum(arr, start, end) {
  const cum = [0];
  for (let i = start + 1; i <= end; i++) cum.push(cum[cum.length - 1] + arr[i]);
  return cum;
}

function frameAtRatio(start, cum, ratio) {
  const target = cum[cum.length - 1] * ratio;
  for (let i = 0; i < cum.length; i++) {
    if (cum[i] >= target) return start + i;
  }
  return start + cum.length - 1;
}

function selectSwingFrames(videoPath, config) {
  const { scanFps, scanWidth, scanHeight, smoothWindow } = config;
  const frameSize = scanWidth * scanHeight;
  const warnings = [];

  const rawFrames = execSync(
    `"${FFMPEG}" -i "${videoPath}" -vf "fps=${scanFps},scale=${scanWidth}:${scanHeight},format=gray" -f rawvideo pipe:1 -loglevel error`,
    { maxBuffer: 200 * 1024 * 1024 }
  );

  const frameCount = Math.floor(rawFrames.length / frameSize);
  const evenSpacing = Array.from({ length: 10 }, (_, i) => Math.floor(i * frameCount / 10));
  if (frameCount < 30) {
    warnings.push("Video too short for motion analysis — using evenly spaced frames.");
    return { indices: evenSpacing, warnings, timestamps: evenSpacing.map(i => (i / scanFps).toFixed(3)), anchors: { p1: evenSpacing[0], p4: evenSpacing[3], p7: evenSpacing[6], p10: evenSpacing[9] } };
  }

  const raw = [0];
  for (let i = 1; i < frameCount; i++) {
    let d = 0;
    const p = (i - 1) * frameSize, c = i * frameSize;
    for (let j = 0; j < frameSize; j++) d += Math.abs(rawFrames[p + j] - rawFrames[c + j]);
    raw.push(d);
  }
  const s = smooth(raw, smoothWindow);
  const maxDiff = Math.max(...s);
  if (maxDiff === 0) {
    warnings.push("No motion detected — using evenly spaced frames.");
    return { indices: evenSpacing, warnings, timestamps: evenSpacing.map(i => (i / scanFps).toFixed(3)), anchors: { p1: evenSpacing[0], p4: evenSpacing[3], p7: evenSpacing[6], p10: evenSpacing[9] } };
  }

  // P7
  let p7 = s.indexOf(maxDiff);
  for (let i = frameCount - 1; i >= 0; i--) {
    if (s[i] >= maxDiff * config.p7ThresholdPct) { p7 = i; break; }
  }
  const refineWindow = scanFps;
  for (let i = Math.max(0, p7 - refineWindow); i <= Math.min(frameCount - 1, p7 + Math.floor(refineWindow * 0.5)); i++) {
    if (s[i] > s[p7]) p7 = i;
  }

  // P4
  let p4 = Math.floor(p7 * 0.5);
  for (let i = p7 - 1; i >= 0; i--) {
    if (s[i] < maxDiff * config.p4ThresholdPct) { p4 = i; break; }
  }

  // P1 — try sustained quiet window; fall back to lowest-motion frame before P4
  let p1 = 0;
  const addressQuietFrames = config.p1QuietFrames;
  for (let i = p4 - addressQuietFrames; i >= addressQuietFrames; i--) {
    let quiet = true;
    for (let j = i; j < i + addressQuietFrames; j++) {
      if (s[j] >= maxDiff * config.p1ThresholdPct) { quiet = false; break; }
    }
    if (quiet) { p1 = i + addressQuietFrames; break; }
  }
  if (p1 === 0) {
    let minVal = Infinity;
    for (let i = 0; i < p4; i++) {
      if (s[i] < minVal) { minVal = s[i]; p1 = i; }
    }
    warnings.push(`P1: no still address detected — using lowest-motion frame before backswing (${(p1 / scanFps).toFixed(2)}s).`);
  }

  // P10 — first sustained quiet after P7; fall back to end of video
  const finishQuietFrames = Math.floor(scanFps * config.p10QuietSeconds);
  let p10 = Math.min(frameCount - 1, p7 + Math.floor(scanFps * 2.5));
  for (let i = p7 + 1; i < frameCount - finishQuietFrames; i++) {
    let quiet = true;
    for (let j = i; j < i + finishQuietFrames; j++) {
      if (s[j] >= maxDiff * config.p10ThresholdPct) { quiet = false; break; }
    }
    if (quiet) { p10 = i + Math.floor(finishQuietFrames / 2); break; }
  }

  // Spread P10 if follow-through window too short
  const minFollowThrough = Math.floor(scanFps * 0.8);
  if (p10 - p7 < minFollowThrough) {
    const available = frameCount - 1 - p7;
    if (available > 3) {
      p10 = p7 + Math.floor(available * 0.90);
      warnings.push(`P10: video ends ${(available / scanFps).toFixed(2)}s after impact — P8/P9/P10 spread across available follow-through footage.`);
    } else {
      warnings.push(`P10: video ends immediately after impact — follow-through positions unreliable.`);
    }
  }

  // Intermediates
  const bsSlice = s.slice(p1, p4 + 1);
  const bsPeak = Math.max(...bsSlice);
  let p2 = p1 + 1;
  for (let i = p1; i < p4; i++) {
    if (s[i] >= bsPeak * config.p2TakeawayPct) { p2 = i; break; }
  }
  if (p2 === p1) {
    p2 = p1 + Math.max(1, Math.floor((p4 - p1) * 0.25));
    warnings.push(`P2: takeaway onset not detected — estimated at 25% of backswing window (${(p2 / scanFps).toFixed(2)}s).`);
  }

  const bsCum = cumulativeSum(s, p1, p4);
  const p3 = frameAtRatio(p1, bsCum, config.p3Ratio);

  const dsCum = cumulativeSum(s, p4, p7);
  const p5 = frameAtRatio(p4, dsCum, config.p5Ratio);
  const p6 = frameAtRatio(p4, dsCum, config.p6Ratio);

  const ftCum = cumulativeSum(s, p7, p10);
  const p8 = frameAtRatio(p7, ftCum, config.p8Ratio);
  const p9 = frameAtRatio(p7, ftCum, config.p9Ratio);

  const indices = [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10];
  const timestamps = indices.map(idx => (idx / scanFps).toFixed(3));

  return { indices, warnings, timestamps, anchors: { p1, p4, p7, p10 } };
}

function extractFrames(videoPath, outputDir, config) {
  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  const { indices: frameIndices, warnings, timestamps, anchors } = selectSwingFrames(videoPath, config);

  const frames = [];
  for (let i = 0; i < frameIndices.length; i++) {
    const ts = (frameIndices[i] / config.scanFps).toFixed(4);
    const framePath = join(outputDir, `frame_${String(i + 1).padStart(3, "0")}.jpg`);
    execSync(
      `"${FFMPEG}" -ss ${ts} -i "${videoPath}" -vframes 1 -vf "scale=${config.outputWidth}:-2" -q:v 4 "${framePath}" -y -loglevel error`
    );
    if (existsSync(framePath)) frames.push(framePath);
  }

  return { frames, warnings, timestamps, anchors };
}

// ─── AI analysis ─────────────────────────────────────────────────────────────

function buildPrompt(cameraAngle, club) {
  const angleLabel = cameraAngle === "dtl" ? "down-the-line" : "face-on";
  const clubContext = {
    driver: "Driver: widest stance, ball far forward (inside left heel), spine tilt away from target, positive AoA, wide arc.",
    fairway: "Fairway wood/hybrid: slightly narrower than driver, ball slightly forward of center, neutral to shallow attack angle.",
    "long-iron": "Long iron (3i-5i): neutral ball position, upright swing plane, steeper attack angle than driver, full shoulder turn.",
    "mid-iron": "Mid iron (6i-8i): neutral stance, ball slightly forward of center, standard swing plane, downward attack angle at impact.",
    wedge: "Wedge: narrow stance, ball center to slightly back, steepest attack angle, most shaft lean at impact.",
  };
  const angleContext = {
    dtl: "Camera: DOWN-THE-LINE. Focus on: swing plane, club path and face angle, shaft angles, arm plane, hip/shoulder rotation, over-the-top or inside-out tendencies.",
    "face-on": "Camera: FACE-ON. Focus on: weight transfer, spine tilt, hip slide vs turn, head position, knee flex, balance, shoulder plane.",
  };

  return `You are an expert PGA-level golf instructor analyzing a golf swing. You have exactly 10 frames, one per position:

Frame 1=P1(Address), Frame 2=P2(Takeaway), Frame 3=P3(Lead arm parallel backswing), Frame 4=P4(Top), Frame 5=P5(Lead arm parallel downswing), Frame 6=P6(Shaft parallel downswing), Frame 7=P7(Impact), Frame 8=P8(Shaft parallel follow-through), Frame 9=P9(Trail arm parallel), Frame 10=P10(Finish)

CONTEXT:
- Camera: ${angleLabel.toUpperCase()}
- Club: ${club.replace("-", " ").toUpperCase()}
- ${clubContext[club]}

${angleContext[cameraAngle]}

IMPORTANT: Respond with ONLY valid JSON. No markdown, no code fences.

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

function cleanJson(text) {
  return text.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
}

async function runVariant(variantName, config, videoPath, framesDir, cameraAngle, club) {
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  console.log(`  [${variantName}] Extracting frames...`);
  const { frames, warnings, timestamps, anchors } = extractFrames(videoPath, framesDir, config);
  if (warnings.length > 0) {
    warnings.forEach(w => console.log(`  [${variantName}] WARN: ${w}`));
  }
  if (frames.length === 0) throw new Error("No frames extracted.");

  const imageBlocks = frames.map((framePath) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: "image/jpeg",
      data: readFileSync(framePath).toString("base64"),
    },
  }));

  const contentBlocks = [];
  imageBlocks.forEach((block, i) => {
    contentBlocks.push({ type: "text", text: `Frame ${i + 1}/${frames.length}:` });
    contentBlocks.push(block);
  });
  contentBlocks.push({ type: "text", text: buildPrompt(cameraAngle, club) });

  console.log(`  [${variantName}] Calling ${config.analysisModel}...`);
  const analysisResponse = await client.messages.create({
    model: config.analysisModel,
    max_tokens: config.maxTokensAnalysis,
    messages: [{ role: "user", content: contentBlocks }],
  });

  const analysis = JSON.parse(cleanJson(analysisResponse.content[0].text));

  return {
    analysis,
    warnings,
    timestamps,
    anchors,
    inputTokens: analysisResponse.usage.input_tokens,
    outputTokens: analysisResponse.usage.output_tokens,
  };
}

// ─── Comparison report ────────────────────────────────────────────────────────

const POSITIONS = ["P1","P2","P3","P4","P5","P6","P7","P8","P9","P10"];
const GRADE_EMOJI = { A: "A", B: "B", C: "C", D: "D", F: "F" };

function buildComparison(runDir, videoFile, cameraAngle, club, results) {
  const successful = results.filter(r => r.status === "ok");
  const failed = results.filter(r => r.status === "error");

  const now = new Date().toISOString();
  const lines = [];

  lines.push(`# Swing Analyzer — A/B Test Results`);
  lines.push(``);
  lines.push(`**Video:** ${videoFile} | **Angle:** ${cameraAngle} | **Club:** ${club}`);
  lines.push(`**Run:** ${now}`);
  lines.push(`**Output:** ${runDir}`);
  lines.push(``);

  // Summary table
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Variant | Score | Duration | Input Tokens | Status |`);
  lines.push(`|---------|-------|----------|--------------|--------|`);
  for (const r of results) {
    if (r.status === "ok") {
      lines.push(`| ${r.name} | ${r.analysis.overall_score}/100 | ${r.duration}s | ${r.inputTokens?.toLocaleString() ?? "—"} | OK |`);
    } else {
      lines.push(`| ${r.name} | — | ${r.duration}s | — | ERROR: ${r.error} |`);
    }
  }
  lines.push(``);

  if (successful.length === 0) {
    lines.push(`No successful variants to compare.`);
    return lines.join("\n");
  }

  // Grade comparison table
  lines.push(`## Grade Comparison`);
  lines.push(``);
  const variantNames = successful.map(r => r.name);
  lines.push(`| Position | ${variantNames.join(" | ")} |`);
  lines.push(`|----------|${variantNames.map(() => "---").join("|")}|`);
  for (const pos of POSITIONS) {
    const grades = variantNames.map(name => {
      const r = successful.find(r => r.name === name);
      return r?.analysis?.positions?.[pos]?.grade ?? "—";
    });
    lines.push(`| ${pos} | ${grades.join(" | ")} |`);
  }
  lines.push(``);

  // Priority fix comparison
  lines.push(`## Priority Fix`);
  lines.push(``);
  lines.push(`| Variant | Position | Problem |`);
  lines.push(`|---------|----------|---------|`);
  for (const r of successful) {
    const pf = r.analysis.priority_fix;
    lines.push(`| ${r.name} | ${pf.position} | ${pf.problem} |`);
  }
  lines.push(``);

  // Frame timestamps (for debugging extraction quality)
  lines.push(`## Frame Timestamps`);
  lines.push(``);
  lines.push(`*Timestamps in seconds where each frame was extracted. Compare across variants to see how threshold/ratio changes shift frame selection.*`);
  lines.push(``);
  const allVariantsWithTimestamps = results.filter(r => r.timestamps);
  if (allVariantsWithTimestamps.length > 0) {
    lines.push(`| Position | ${allVariantsWithTimestamps.map(r => r.name).join(" | ")} |`);
    lines.push(`|----------|${allVariantsWithTimestamps.map(() => "---").join("|")}|`);
    for (let i = 0; i < 10; i++) {
      const pos = POSITIONS[i];
      const times = allVariantsWithTimestamps.map(r => r.timestamps?.[i] ?? "—");
      lines.push(`| ${pos} | ${times.join(" | ")} |`);
    }
    lines.push(``);

    // Anchor points
    lines.push(`### Anchor Points (P1/P4/P7/P10 detection)`);
    lines.push(``);
    lines.push(`| Anchor | ${allVariantsWithTimestamps.map(r => r.name).join(" | ")} |`);
    lines.push(`|--------|${allVariantsWithTimestamps.map(() => "---").join("|")}|`);
    for (const anchor of ["p1", "p4", "p7", "p10"]) {
      const label = anchor.toUpperCase();
      const times = allVariantsWithTimestamps.map(r => {
        const idx = r.anchors?.[anchor];
        return idx != null ? (idx / r.scanFps).toFixed(3) + "s" : "—";
      });
      lines.push(`| ${label} | ${times.join(" | ")} |`);
    }
    lines.push(``);
  }

  // Warnings per variant
  const withWarnings = successful.filter(r => r.warnings?.length > 0);
  if (withWarnings.length > 0) {
    lines.push(`## Video Quality Warnings`);
    lines.push(``);
    for (const r of withWarnings) {
      lines.push(`### ${r.name}`);
      r.warnings.forEach(w => lines.push(`- ${w}`));
      lines.push(``);
    }
  }

  // Per-variant summaries
  lines.push(`## Summaries`);
  lines.push(``);
  for (const r of successful) {
    lines.push(`### ${r.name}`);
    lines.push(``);
    lines.push(r.analysis.summary);
    lines.push(``);
  }

  if (failed.length > 0) {
    lines.push(`## Errors`);
    lines.push(``);
    for (const r of failed) {
      lines.push(`- **${r.name}:** ${r.error}`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Frames saved to \`${runDir}/{variant}/frames/\`*`);

  return lines.join("\n");
}

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };

  const videoPath = get("--video");
  if (!videoPath) {
    console.error("Usage: node scripts/test-harness.mjs --video <path> [--angle dtl|face-on] [--club mid-iron] [--variants a,b] [--out dir]");
    console.error("\nAvailable variants:");
    Object.keys(VARIANTS).forEach(v => console.error(`  ${v}`));
    process.exit(1);
  }

  const cameraAngle = get("--angle") ?? "dtl";
  const club = get("--club") ?? "mid-iron";
  const variantArg = get("--variants");
  const outArg = get("--out");

  const selectedVariants = variantArg
    ? variantArg.split(",").map(v => v.trim()).filter(v => {
        if (!VARIANTS[v]) { console.warn(`Warning: unknown variant "${v}", skipping`); return false; }
        return true;
      })
    : Object.keys(VARIANTS);

  return { videoPath, cameraAngle, club, selectedVariants, outArg };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { videoPath, cameraAngle, club, selectedVariants, outArg } = parseArgs();

  const resolvedVideo = resolve(videoPath);
  if (!existsSync(resolvedVideo)) {
    console.error(`Video file not found: ${resolvedVideo}`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = outArg
    ? resolve(outArg)
    : join(PROJECT_ROOT, "test-results", `run-${timestamp}`);

  mkdirSync(runDir, { recursive: true });

  console.log(`\nSwing Analyzer A/B Test Harness`);
  console.log(`================================`);
  console.log(`Video:    ${resolvedVideo}`);
  console.log(`Angle:    ${cameraAngle}`);
  console.log(`Club:     ${club}`);
  console.log(`Variants: ${selectedVariants.join(", ")}`);
  console.log(`Output:   ${runDir}`);
  console.log(``);

  const results = [];

  for (const variantName of selectedVariants) {
    const overrides = VARIANTS[variantName];
    const config = { ...DEFAULT_CONFIG, ...overrides };

    const variantDir = join(runDir, variantName);
    const framesDir = join(variantDir, "frames");
    mkdirSync(variantDir, { recursive: true });

    console.log(`Running variant: ${variantName}`);
    const configDiff = Object.entries(overrides);
    if (configDiff.length > 0) {
      configDiff.forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    } else {
      console.log(`  (default config)`);
    }

    const start = Date.now();
    try {
      const { analysis, warnings, timestamps, anchors, inputTokens, outputTokens } =
        await runVariant(variantName, config, resolvedVideo, framesDir, cameraAngle, club);

      const duration = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  Score: ${analysis.overall_score}/100 | Duration: ${duration}s | Tokens in: ${inputTokens?.toLocaleString()}`);

      // Save analysis.json
      writeFileSync(
        join(variantDir, "analysis.json"),
        JSON.stringify({ meta: { variant: variantName, config, cameraAngle, club, videoPath }, analysis, timestamps, anchors, inputTokens, outputTokens }, null, 2)
      );

      results.push({ name: variantName, status: "ok", analysis, warnings, timestamps, anchors, duration, inputTokens, outputTokens, scanFps: config.scanFps });
    } catch (err) {
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${errMsg}`);
      results.push({ name: variantName, status: "error", error: errMsg, duration });
    }

    console.log(``);
  }

  // Write comparison report
  const report = buildComparison(runDir, videoPath, cameraAngle, club, results);
  const reportPath = join(runDir, "comparison.md");
  writeFileSync(reportPath, report);

  console.log(`Done.`);
  console.log(`Report: ${reportPath}`);
  console.log(`Frames: ${runDir}/{variant}/frames/`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
