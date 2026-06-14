import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Grade } from "@/types";

const GRADE_COLORS: Record<Grade, string> = {
  A: "text-green-400 bg-green-400/10 border-green-400/20",
  B: "text-lime-400 bg-lime-400/10 border-lime-400/20",
  C: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  D: "text-orange-400 bg-orange-400/10 border-orange-400/20",
  F: "text-red-400 bg-red-400/10 border-red-400/20",
};

const SCORE_COLOR = (s: number) =>
  s >= 80 ? "#22c55e" : s >= 60 ? "#eab308" : "#ef4444";

function MiniScoreRing({ score }: { score: number }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="relative w-14 h-14 flex items-center justify-center shrink-0">
      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r={r} fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="4" />
        <circle
          cx="25" cy="25" r={r} fill="none"
          stroke={SCORE_COLOR(score)} strokeWidth="4"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute text-xs font-bold text-white">{score}</span>
    </div>
  );
}

const CLUB_LABELS: Record<string, string> = {
  driver: "Driver",
  fairway: "3W / 5W",
  "long-iron": "Long Iron",
  "mid-iron": "Mid Iron",
  wedge: "Wedge",
};

interface AnalysisRow {
  id: string;
  created_at: string;
  club: string;
  camera_angle: string;
  overall_score: number;
  overall_grade: string;
  priority_fix: { position: string; problem: string };
}

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/history");

  const { data: analyses, error } = await supabase
    .from("analyses")
    .select("id, created_at, club, camera_angle, overall_score, overall_grade, priority_fix")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-5">
        <p className="text-red-400 text-sm">Failed to load history. Try again later.</p>
      </main>
    );
  }

  const rows = (analyses ?? []) as AnalysisRow[];

  return (
    <main className="min-h-screen text-[#F5F2EC] pb-16">
      <div className="max-w-xl lg:max-w-3xl mx-auto px-5 lg:px-10 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold uppercase leading-tight tracking-tight">
              My History
            </h1>
            <p className="text-white/40 text-sm mt-1">
              {rows.length} {rows.length === 1 ? "analysis" : "analyses"} saved
            </p>
          </div>
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New analysis
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center mb-5">
              <svg className="w-7 h-7 text-white/25" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            </div>
            <p className="text-white/50 font-medium mb-2">No analyses yet</p>
            <p className="text-white/30 text-sm mb-6">Upload your first swing to start tracking your progress.</p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#D4A24C] to-[#B8862F] text-[#0A0908] font-display font-bold text-sm uppercase tracking-widest shadow-lg shadow-amber-900/30"
            >
              Analyze a swing
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((row) => {
              const date = new Date(row.created_at);
              const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
              const grade = (row.overall_grade || "C") as Grade;

              return (
                <Link
                  key={row.id}
                  href={`/analysis/${row.id}`}
                  className="group flex items-center gap-4 bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 hover:border-white/15 rounded-2xl px-5 py-4 transition-all duration-200"
                >
                  <MiniScoreRing score={row.overall_score} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-display text-sm font-semibold text-white/80 uppercase tracking-wide">
                        {CLUB_LABELS[row.club] ?? row.club}
                      </span>
                      <span className="text-white/20 text-xs">·</span>
                      <span className="text-xs text-white/40 uppercase tracking-widest">
                        {row.camera_angle}
                      </span>
                      <span
                        className={`ml-auto text-[11px] font-bold uppercase px-2 py-0.5 rounded-md border ${GRADE_COLORS[grade]}`}
                      >
                        {grade}
                      </span>
                    </div>
                    <p className="text-xs text-white/30 truncate">
                      Priority: {row.priority_fix.position} — {row.priority_fix.problem}
                    </p>
                    <p className="text-[11px] text-white/20 mt-1">
                      {dateStr} · {timeStr}
                    </p>
                  </div>

                  <svg
                    className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors shrink-0"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
