import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";
import SavedAnalysisView from "@/components/SavedAnalysisView";
import type { Analysis, Drill } from "@/types";

interface AnalysisRecord {
  id: string;
  user_id: string;
  created_at: string;
  club: string;
  camera_angle: string;
  overall_score: number;
  overall_grade: string;
  summary: string;
  positions: Analysis["positions"];
  priority_fix: Analysis["priority_fix"];
  drills: Drill[];
  frame_paths: string[];
}

async function getSignedFrameUrls(framePaths: string[], userId: string): Promise<string[]> {
  const supabaseAdmin = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  );

  const urls: string[] = [];
  for (const path of framePaths) {
    if (!path.startsWith(`${userId}/`)) {
      urls.push("");
      continue;
    }
    const { data } = await supabaseAdmin.storage
      .from("swing-frames")
      .createSignedUrl(path, 3600);
    urls.push(data?.signedUrl ?? "");
  }
  return urls;
}

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=/analysis/${id}`);

  const { data, error } = await supabase
    .from("analyses")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) notFound();

  const record = data as AnalysisRecord;
  const signedUrls = await getSignedFrameUrls(record.frame_paths, user.id);

  const analysis: Analysis = {
    overall_score: record.overall_score,
    summary: record.summary,
    positions: record.positions,
    priority_fix: record.priority_fix,
    drills: record.drills,
  };

  const date = new Date(record.created_at).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  return (
    <main className="min-h-screen bg-[#080808] text-white pb-16">
      <div className="max-w-lg lg:max-w-6xl mx-auto px-5 lg:px-10">

        {/* Breadcrumb header */}
        <div className="py-8 flex items-center justify-between">
          <Link
            href="/history"
            className="flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            My History
          </Link>
          <div className="flex items-center gap-2 text-xs text-white/30">
            <span>{record.club.replace("-", " ")}</span>
            <span>·</span>
            <span>{record.camera_angle.toUpperCase()}</span>
            <span>·</span>
            <span>{date}</span>
          </div>
        </div>

        <SavedAnalysisView
          analysis={analysis}
          drills={record.drills}
          frames={signedUrls}
          meta={{
            club: record.club,
            camera_angle: record.camera_angle,
            analyzed_at: record.created_at,
          }}
        />
      </div>
    </main>
  );
}
