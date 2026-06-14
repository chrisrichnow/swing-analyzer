/**
 * P7 impact tuning — for each clip, print the math-detected impact time and
 * extract a fine-grained strip (±range around detection, one frame per scan
 * frame) so true ball-strike can be located by eye and the offset measured.
 *
 *   npx tsx scripts/tune-p7.ts
 */
import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { selectSwingFrames, probeDurationSec } from "@/lib/analyze";

const ext = process.platform === "win32" ? ".exe" : "";
const FFMPEG = join(process.cwd(), `node_modules/ffmpeg-static/ffmpeg${ext}`);
const SCAN_FPS = 60;
const BEFORE = 0.20; // seconds before detected impact
const AFTER = 0.10;  // seconds after detected impact

const CLIPS = [
  { file: "IMG_6732.mov", angle: "dtl", club: "mid-iron" },
  { file: "dtl_driver.mov", angle: "dtl", club: "driver" },
  { file: "dtl_driver_2.mov", angle: "dtl", club: "driver" },
  { file: "dtl_iron_2.mov", angle: "dtl", club: "iron" },
  { file: "dtl_iron_3.mp4", angle: "dtl", club: "iron" },
  { file: "dtl_iron_mid.mov", angle: "dtl", club: "mid-iron" },
  { file: "faceon_iron.mov", angle: "face-on", club: "iron" },
];

const VID_DIR = resolve(process.cwd(), "test-videos");
const OUT_ROOT = join(VID_DIR, "p7-tune");

function main() {
  if (existsSync(OUT_ROOT)) rmSync(OUT_ROOT, { recursive: true });
  mkdirSync(OUT_ROOT, { recursive: true });

  for (const clip of CLIPS) {
    const video = join(VID_DIR, clip.file);
    if (!existsSync(video)) { console.log(`SKIP (missing): ${clip.file}`); continue; }

    const dur = probeDurationSec(video);
    const sel = selectSwingFrames(video, dur);
    const detectedP7 = sel.indices[6] / SCAN_FPS;

    const name = clip.file.replace(/\.[^.]+$/, "");
    const outDir = join(OUT_ROOT, name);
    mkdirSync(outDir, { recursive: true });

    const startSec = Math.max(0, detectedP7 - BEFORE);
    const endSec = Math.min(dur, detectedP7 + AFTER);
    const frames: string[] = [];
    for (let t = startSec; t <= endSec + 1e-9; t += 1 / SCAN_FPS) {
      const ms = Math.round(t * 1000);
      const flag = Math.abs(t - detectedP7) < 0.5 / SCAN_FPS ? "_DET" : "";
      const out = join(outDir, `t${String(ms).padStart(4, "0")}${flag}.jpg`);
      execSync(`"${FFMPEG}" -ss ${t.toFixed(4)} -i "${video}" -vframes 1 -vf "scale=480:-2" -q:v 4 "${out}" -y -loglevel error`);
      frames.push(out);
    }

    console.log(`${clip.file.padEnd(20)} angle=${clip.angle.padEnd(8)} club=${clip.club.padEnd(9)} dur=${dur.toFixed(2)}s conf=${sel.confidence.toFixed(2)} detectedP7=${detectedP7.toFixed(3)}s  strip=${frames.length}f -> ${name}/`);
  }
  console.log(`\nStrips in: ${OUT_ROOT}`);
}

main();
