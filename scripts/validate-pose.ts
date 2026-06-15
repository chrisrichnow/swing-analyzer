/**
 * Pose-based selection validator (parallels validate-selection.ts).
 *   npx tsx scripts/validate-pose.ts <video> [angle] [club]
 * Runs the pose pipeline, prints anchors + picks, writes 10 frames to
 * test-videos/pose-out/ for visual inspection.
 */
import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import * as dotenv from "dotenv";
import { selectSwingFramesPose } from "@/lib/pose-select";
import { probeDurationSec } from "@/lib/analyze";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const ext = process.platform === "win32" ? ".exe" : "";
const FFMPEG = join(process.cwd(), `node_modules/ffmpeg-static/ffmpeg${ext}`);
const labels = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"];

async function main() {
  const videoArg = process.argv[2];
  if (!videoArg) { console.error("Usage: npx tsx scripts/validate-pose.ts <video> [angle] [club]"); process.exit(1); }
  const video = resolve(videoArg);

  const duration = probeDurationSec(video);
  console.log(`\nVideo: ${video}\nDuration: ${duration.toFixed(2)}s`);

  const t0 = Date.now();
  const sel = await selectSwingFramesPose(video, duration, (m) => process.stdout.write(`\r${m}    `));
  console.log(`\nPose pipeline: ${((Date.now() - t0) / 1000).toFixed(1)}s | frames=${sel.debug.nFrames} | avgKeypointScore=${sel.debug.avgScore.toFixed(2)}`);
  console.log(`Anchors (frame#): P1=${sel.debug.p1} P4=${sel.debug.p4} P7=${sel.debug.p7} P10=${sel.debug.p10}`);
  console.log(`Picks: ${sel.seconds.map((s, i) => `${labels[i]}=${s.toFixed(3)}s`).join("  ")}\n`);

  const outDir = resolve(process.cwd(), "test-videos", "pose-out");
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  sel.seconds.forEach((sec, i) => {
    const out = join(outDir, `${String(i + 1).padStart(2, "0")}_${labels[i]}_${sec.toFixed(3).replace(".", "p")}.jpg`);
    execSync(`"${FFMPEG}" -ss ${sec.toFixed(4)} -i "${video}" -vframes 1 -vf "scale=640:-2" -q:v 4 "${out}" -y -loglevel error`);
  });
  console.log(`Frames written to: ${outDir}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
