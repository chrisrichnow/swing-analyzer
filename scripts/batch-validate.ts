/**
 * Batch pose-selection validator. Runs the REAL production path
 * (extractFrames with USE_POSE_SELECTION=1 -> pose + visual impact refine)
 * over a manifest of clips and dumps each clip's 10 final frames into
 * test-videos/batch-out/<clip>/ for visual grading.
 *
 *   npx tsx scripts/batch-validate.ts
 *
 * Add clips by appending to CLIPS below (file is resolved under test-videos/).
 */
import { existsSync, mkdirSync, rmSync, copyFileSync, readdirSync } from "fs";
import { join, resolve, basename } from "path";
import * as dotenv from "dotenv";
import { extractFrames, probeDurationSec, type ExtractOpts } from "@/lib/analyze";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const labels = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"];

type Clip = { file: string; angle: ExtractOpts["cameraAngle"]; club: ExtractOpts["club"] };

const CLIPS: Clip[] = [
  { file: "IMG_6732.mov",     angle: "dtl",     club: "iron" },
  { file: "dtl_iron_2.mov",   angle: "dtl",     club: "iron" },
  { file: "dtl_iron_3.mp4",   angle: "dtl",     club: "iron" },
  { file: "dtl_iron_mid.mov", angle: "dtl",     club: "iron" },
  { file: "dtl_driver.mov",   angle: "dtl",     club: "driver" },
  { file: "dtl_driver_2.mov", angle: "dtl",     club: "driver" },
  { file: "faceon_iron.mov",  angle: "face-on", club: "iron" },
];

async function main() {
  process.env.USE_POSE_SELECTION = "1";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("No ANTHROPIC_API_KEY in .env.local"); process.exit(1); }

  const videoDir = resolve(process.cwd(), "test-videos");
  const batchOut = resolve(videoDir, "batch-out");
  if (existsSync(batchOut)) rmSync(batchOut, { recursive: true });
  mkdirSync(batchOut, { recursive: true });

  const summary: string[] = [];

  for (const clip of CLIPS) {
    const video = resolve(videoDir, clip.file);
    if (!existsSync(video)) { console.log(`SKIP (missing): ${clip.file}`); continue; }

    const duration = probeDurationSec(video);
    console.log(`\n=== ${clip.file}  ${duration.toFixed(2)}s  angle=${clip.angle} club=${clip.club} ===`);

    const workDir = `${video}_batchframes`;
    const t0 = Date.now();
    let frames;
    try {
      frames = await extractFrames(video, workDir, {
        apiKey, cameraAngle: clip.angle, club: clip.club,
        onProgress: (m) => process.stdout.write(`\r${m}        `),
      });
    } catch (e) {
      console.log(`\nFAILED: ${(e as Error).message}`);
      summary.push(`${clip.file}\tERROR`);
      continue;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n${secs}s | frames=${frames.length}`);

    const outDir = join(batchOut, basename(clip.file).replace(/\.[^.]+$/, ""));
    mkdirSync(outDir, { recursive: true });
    readdirSync(workDir).filter((f) => f.endsWith(".jpg")).sort().forEach((f, i) => {
      copyFileSync(join(workDir, f), join(outDir, `${String(i + 1).padStart(2, "0")}_${labels[i]}.jpg`));
    });
    rmSync(workDir, { recursive: true, force: true });
    summary.push(`${clip.file}\t${secs}s\t${frames.length} frames`);
  }

  console.log(`\n\n=== BATCH SUMMARY ===`);
  summary.forEach((s) => console.log(s));
  console.log(`\nFrames written under: ${batchOut}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
