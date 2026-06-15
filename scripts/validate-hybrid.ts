/**
 * Hybrid pose-selection validator: runs the REAL production path
 * (selectSwingFramesPose -> visual impact refine -> reanchor) via extractFrames
 * with USE_POSE_SELECTION=1, so it tests pose + refine together, not pose alone.
 *
 *   npx tsx scripts/validate-hybrid.ts <video> [angle] [club]
 *
 * Writes the 10 final frames to test-videos/hybrid-out/ for visual inspection.
 */
import { existsSync, mkdirSync, rmSync, copyFileSync, readdirSync } from "fs";
import { join, resolve, basename } from "path";
import * as dotenv from "dotenv";
import { extractFrames, probeDurationSec, type ExtractOpts } from "@/lib/analyze";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const labels = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"];

async function main() {
  process.env.USE_POSE_SELECTION = "1";
  const videoArg = process.argv[2];
  if (!videoArg) {
    console.error("Usage: npx tsx scripts/validate-hybrid.ts <video> [angle] [club]");
    process.exit(1);
  }
  const video = resolve(videoArg);
  const angle = (process.argv[3] as ExtractOpts["cameraAngle"]) ?? undefined;
  const club = (process.argv[4] as ExtractOpts["club"]) ?? undefined;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("No ANTHROPIC_API_KEY in .env.local"); process.exit(1); }

  const duration = probeDurationSec(video);
  console.log(`\nVideo: ${basename(video)}  Duration: ${duration.toFixed(2)}s  angle=${angle ?? "?"} club=${club ?? "?"}`);

  const workDir = `${video}_hybridframes`;
  const t0 = Date.now();
  const frames = await extractFrames(video, workDir, {
    apiKey, cameraAngle: angle, club,
    onProgress: (m) => process.stdout.write(`\r${m}        `),
  });
  console.log(`\nHybrid pipeline: ${((Date.now() - t0) / 1000).toFixed(1)}s | frames=${frames.length}`);

  const outDir = resolve(process.cwd(), "test-videos", "hybrid-out");
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  readdirSync(workDir).filter((f) => f.endsWith(".jpg")).sort().forEach((f, i) => {
    copyFileSync(join(workDir, f), join(outDir, `${String(i + 1).padStart(2, "0")}_${labels[i]}.jpg`));
  });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Frames written to ${outDir}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
