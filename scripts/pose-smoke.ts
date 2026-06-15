/**
 * Smoke test: confirm MoveNet pose detection runs in this env (WASM backend).
 *   npx tsx scripts/pose-smoke.ts "C:\\path\\to\\video.mov"
 * Extracts one frame, runs pose, prints detected keypoints + scores.
 */
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-converter";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import "@tensorflow/tfjs-backend-wasm";
import * as poseDetection from "@tensorflow-models/pose-detection";
import jpeg from "jpeg-js";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { join, resolve } from "path";

const ext = process.platform === "win32" ? ".exe" : "";
const FFMPEG = join(process.cwd(), `node_modules/ffmpeg-static/ffmpeg${ext}`);

function frameToTensor(jpgPath: string): tf.Tensor3D {
  const { data, width, height } = jpeg.decode(readFileSync(jpgPath), { useTArray: true });
  const n = width * height;
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  return tf.tensor3d(rgb, [height, width, 3]);
}

async function main() {
  const video = resolve(process.argv[2] ?? "test-videos/IMG_6732.mov");
  setWasmPaths(join(process.cwd(), "node_modules/@tensorflow/tfjs-backend-wasm/dist/"));
  await tf.setBackend("wasm");
  await tf.ready();
  console.log("Backend:", tf.getBackend());

  const framePath = join(process.cwd(), "test-videos", "_pose_smoke.jpg");
  execSync(`"${FFMPEG}" -ss 1.0 -i "${video}" -vframes 1 -vf "scale=512:-2" -q:v 3 "${framePath}" -y -loglevel error`);
  console.log("Extracted test frame from", video);

  const t0 = Date.now();
  const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
  });
  console.log(`Detector ready in ${Date.now() - t0}ms`);

  const input = frameToTensor(framePath);
  const t1 = Date.now();
  const poses = await detector.estimatePoses(input);
  console.log(`Pose inference: ${Date.now() - t1}ms`);
  input.dispose();

  if (!poses.length) { console.log("NO POSE DETECTED"); return; }
  const kp = poses[0].keypoints;
  const want = ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip"];
  for (const name of want) {
    const p = kp.find((k) => k.name === name);
    if (p) console.log(`${name.padEnd(15)} x=${p.x.toFixed(0)} y=${p.y.toFixed(0)} score=${(p.score ?? 0).toFixed(2)}`);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
