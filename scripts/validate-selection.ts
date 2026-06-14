/**
 * Phase 8 validation — runs the REAL frame-selection pipeline against a video.
 *   npx tsx scripts/validate-selection.ts test-videos/IMG_6732.mov [dtl|face-on] [club]
 *
 * Prints the math pick + confidence, whether it escalated to AI-mapping, the
 * final picks as timestamps, and writes the 10 chosen frames for eyeballing.
 */
import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import * as dotenv from "dotenv";
import { selectSwingFrames, selectSwingFramesSmart, probeDurationSec } from "@/lib/analyze";
import type { CameraAngle, Club } from "@/types";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const ext = process.platform === "win32" ? ".exe" : "";
const FFMPEG = join(process.cwd(), `node_modules/ffmpeg-static/ffmpeg${ext}`);
const SCAN_FPS = 60;

const videoArg = process.argv[2];
const cameraAngle = (process.argv[3] as CameraAngle) ?? "dtl";
const club = (process.argv[4] as Club) ?? "mid-iron";
if (!videoArg) { console.error("Usage: npx tsx scripts/validate-selection.ts <video> [angle] [club]"); process.exit(1); }

const video = resolve(videoArg);
const labels = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"];
const ts = (i: number) => (i / SCAN_FPS).toFixed(3) + "s";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log(`\nVideo:  ${video}`);
  console.log(`Angle:  ${cameraAngle} | Club: ${club} | API key: ${apiKey ? "yes" : "NO (math-only)"}`);

  const duration = probeDurationSec(video);
  console.log(`Duration: ${duration.toFixed(2)}s\n`);

  // 1) Math path — confidence + picks
  const sel = selectSwingFrames(video, duration);
  console.log(`── MATH PATH ─────────────────────────────`);
  console.log(`Confidence: ${sel.confidence.toFixed(2)}  (threshold 0.60 → ${sel.confidence >= 0.6 ? "TRUST math" : "ESCALATE to AI"})`);
  console.log(`Clean segment: ${sel.segStartSec.toFixed(2)}s–${sel.segEndSec.toFixed(2)}s`);
  console.log(`Picks: ${sel.indices.map((idx, i) => `${labels[i]}=${ts(idx)}`).join("  ")}\n`);

  // 2) Full smart pipeline (escalates to AI-mapping if low confidence)
  let escalated = false;
  const finalIdx = await selectSwingFramesSmart(video, duration, {
    apiKey, cameraAngle, club,
    onProgress: (m) => { escalated = true; console.log(`[escalated] ${m}`); },
  });
  console.log(`── FINAL PICK ${escalated ? "(AI-mapping)" : "(math)"} ──────────────`);
  console.log(`Picks: ${finalIdx.map((idx, i) => `${labels[i]}=${ts(idx)}`).join("  ")}\n`);

  // 3) Extract the final frames for visual inspection
  const outDir = resolve(process.cwd(), "test-videos", "frames-out");
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  finalIdx.forEach((idx, i) => {
    const out = join(outDir, `${String(i + 1).padStart(2, "0")}_${labels[i]}_${ts(idx).replace(".", "p")}.jpg`);
    execSync(`"${FFMPEG}" -ss ${(idx / SCAN_FPS).toFixed(4)} -i "${video}" -vframes 1 -vf "scale=640:-2" -q:v 4 "${out}" -y -loglevel error`);
  });
  console.log(`Frames written to: ${outDir}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
