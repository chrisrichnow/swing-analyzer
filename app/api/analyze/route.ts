import { NextRequest } from "next/server";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { extractFrames, analyzeSwing, generateDrills } from "@/lib/analyze";
import { CameraAngle, Club, Drill } from "@/types";

export const maxDuration = 300;

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function sseEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key not configured." }), { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid form data." }), { status: 400 });
  }

  const file = formData.get("video") as File | null;
  const cameraAngle = formData.get("cameraAngle") as CameraAngle | null;
  const club = formData.get("club") as Club | null;

  if (!file || !cameraAngle || !club) {
    return new Response(JSON.stringify({ error: "Missing required fields." }), { status: 400 });
  }

  const validAngles: CameraAngle[] = ["dtl", "face-on"];
  const validClubs: Club[] = ["driver", "fairway", "long-iron", "mid-iron", "wedge"];

  if (!validAngles.includes(cameraAngle) || !validClubs.includes(club)) {
    return new Response(JSON.stringify({ error: "Invalid angle or club." }), { status: 400 });
  }

  if (file.size > MAX_VIDEO_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return new Response(
      JSON.stringify({ error: `Video too large: ${mb}MB. Max 100MB — please trim or compress.` }),
      { status: 413 }
    );
  }

  const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sessionDir = join(tmpdir(), `swing_${sessionId}`);
  const framesDir = join(sessionDir, "frames");
  const ext = file.name.split(".").pop() ?? "mov";
  const videoPath = join(sessionDir, `video.${ext}`);

  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(videoPath, Buffer.from(await file.arrayBuffer()));

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(sseEvent(data));

      try {
        // Phase 1: extract frames
        send({ type: "status", step: 1, message: "Extracting frames..." });
        const framePaths = extractFrames(videoPath, framesDir);

        const swingFrames: string[] = [];
        for (let n = 1; n <= 10; n++) {
          const p = join(framesDir, `frame_${String(n).padStart(3, "0")}.jpg`);
          if (existsSync(p)) swingFrames.push(`data:image/jpeg;base64,${readFileSync(p).toString("base64")}`);
        }
        send({ type: "frames", frames: swingFrames });

        // Phase 2: analyze
        send({ type: "status", step: 2, message: "Analyzing your swing..." });
        const analysis = await analyzeSwing(framePaths, cameraAngle, club, apiKey);

        // Phase 3: drills
        send({ type: "status", step: 3, message: "Generating drills..." });
        let drills: Drill[] = [];
        try {
          drills = await generateDrills(analysis, club, apiKey);
        } catch {
          // drills are non-critical
        }

        send({
          type: "done",
          result: {
            meta: {
              video: file.name,
              camera_angle: cameraAngle,
              club,
              analyzed_at: new Date().toISOString(),
            },
            analysis,
            drills,
            frames: swingFrames,
          },
        });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Analysis failed." });
      } finally {
        try { rmSync(sessionDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
