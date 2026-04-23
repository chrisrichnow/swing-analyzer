import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runAnalysis } from "@/lib/analyze";
import { CameraAngle, Club } from "@/types";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured." }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("video") as File | null;
  const cameraAngle = formData.get("cameraAngle") as CameraAngle | null;
  const club = formData.get("club") as Club | null;

  if (!file || !cameraAngle || !club) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const validAngles: CameraAngle[] = ["dtl", "face-on"];
  const validClubs: Club[] = ["driver", "fairway", "long-iron", "mid-iron", "wedge"];

  if (!validAngles.includes(cameraAngle) || !validClubs.includes(club)) {
    return NextResponse.json({ error: "Invalid angle or club." }, { status: 400 });
  }

  const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sessionDir = join(tmpdir(), `swing_${sessionId}`);
  const framesDir = join(sessionDir, "frames");
  const ext = file.name.split(".").pop() ?? "mov";
  const videoPath = join(sessionDir, `video.${ext}`);

  mkdirSync(sessionDir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  writeFileSync(videoPath, buffer);

  try {
    const { analysis, drills } = await runAnalysis(videoPath, framesDir, cameraAngle, club, apiKey);

    const result = {
      meta: {
        video: file.name,
        camera_angle: cameraAngle,
        club,
        analyzed_at: new Date().toISOString(),
      },
      analysis,
      drills,
    };

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
