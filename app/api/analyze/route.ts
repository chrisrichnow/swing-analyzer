import { NextRequest } from "next/server";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { extractFrames, analyzeSwing, buildHistoryContext } from "@/lib/analyze";
import { CameraAngle, Club, Drill } from "@/types";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const maxDuration = 300;

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function sseEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

async function getUserAndHistory(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch { /* noop */ }
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { user: null, historyContext: null, supabase: null };

    const { data: pastAnalyses } = await supabase
      .from("analyses")
      .select("overall_score, overall_grade, positions, priority_fix, club, camera_angle, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);

    const historyContext = pastAnalyses && pastAnalyses.length > 0
      ? buildHistoryContext(pastAnalyses)
      : null;

    return { user, historyContext, supabase };
  } catch {
    return { user: null, historyContext: null, supabase: null };
  }
}

async function saveAnalysis(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  analysisId: string,
  framePaths: string[],
  cameraAngle: CameraAngle,
  club: Club,
  analysis: Awaited<ReturnType<typeof analyzeSwing>>,
  drills: Drill[]
): Promise<string[]> {
  const supabaseAdmin = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  );

  const storagePaths: string[] = [];

  // Upload frames to Supabase Storage
  for (let i = 0; i < framePaths.length; i++) {
    const frameNum = String(i + 1).padStart(2, "0");
    const storagePath = `${userId}/${analysisId}/frame_${frameNum}.jpg`;
    const buffer = readFileSync(framePaths[i]);

    const { error } = await supabaseAdmin.storage
      .from("swing-frames")
      .upload(storagePath, buffer, { contentType: "image/jpeg", upsert: false });

    if (!error) storagePaths.push(storagePath);
  }

  // Compute overall grade from positions
  const GRADE_ORDER: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
  const GRADE_LABELS = ["F", "D", "C", "B", "A"];
  const positionEntries = Object.entries(analysis.positions);
  const avg = positionEntries.reduce((sum, [, d]) => sum + (GRADE_ORDER[d.grade] ?? 0), 0) / positionEntries.length;
  const overallGrade = GRADE_LABELS[Math.round(avg)] ?? "C";

  const { error: insertError } = await supabaseAdmin.from("analyses").insert({
    id: analysisId,
    user_id: userId,
    club,
    camera_angle: cameraAngle,
    overall_score: analysis.overall_score,
    overall_grade: overallGrade,
    summary: analysis.summary,
    positions: analysis.positions,
    priority_fix: analysis.priority_fix,
    drills,
    frame_paths: storagePaths,
  });

  if (insertError) console.error("Failed to save analysis:", insertError.message);

  return storagePaths;
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

  const { user, historyContext, supabase } = await getUserAndHistory(req);

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
        // Phase 1: extract frames (math selection + visual impact refine)
        send({ type: "status", step: 1, message: "Extracting frames..." });
        const tExtract = Date.now();
        const framePaths = await extractFrames(videoPath, framesDir, {
          apiKey,
          cameraAngle,
          club,
          onProgress: (message) => send({ type: "status", step: 1, message }),
        });
        console.log(`[timing] extractFrames total: ${Date.now() - tExtract}ms`);

        const swingFrames: string[] = [];
        for (let n = 1; n <= 10; n++) {
          const p = join(framesDir, `frame_${String(n).padStart(3, "0")}.jpg`);
          if (existsSync(p)) swingFrames.push(`data:image/jpeg;base64,${readFileSync(p).toString("base64")}`);
        }
        send({ type: "frames", frames: swingFrames });

        // Phase 2: analyze + drills in a SINGLE model call (no separate round-trip)
        send({ type: "status", step: 2, message: "Analyzing your swing..." });
        const tAnalyze = Date.now();
        const analysis = await analyzeSwing(framePaths, cameraAngle, club, apiKey, historyContext ?? undefined);
        console.log(`[timing] analyzeSwing total: ${Date.now() - tAnalyze}ms`);

        // Drills now come back with the analysis (folded into the same call).
        send({ type: "status", step: 3, message: "Generating drills..." });
        const drills: Drill[] = analysis.drills ?? [];

        // Save to Supabase if user is logged in
        let analysisId: string | null = null;
        if (user && supabase) {
          analysisId = randomUUID();
          await saveAnalysis(supabase, user.id, analysisId, framePaths, cameraAngle, club, analysis, drills);
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
            analysisId,
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
