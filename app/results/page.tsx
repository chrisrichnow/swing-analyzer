"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SwingResult, Grade } from "@/types";
import GradeBadge from "@/components/Gradebadge";
import PositionCard from "@/components/PositionCard";
import DrillCard from "@/components/DrillCard";
import FrameLightbox from "@/components/FrameLightbox";
import Link from "next/link";

const GRADE_ORDER: Record<Grade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#eab308" : "#ef4444";
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative w-28 h-28 flex items-center justify-center">
      <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="8" />
        <circle
          cx="50" cy="50" r="40" fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold text-white">{score}</span>
        <span className="text-xs text-white/40">/100</span>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const router = useRouter();
  const [result, setResult] = useState<SwingResult | null>(null);
  const [tab, setTab] = useState<"positions" | "drills">("positions");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("swingResult");
    if (!raw) { router.push("/"); return; }
    setResult(JSON.parse(raw));
  }, [router]);

  if (!result) return null;

  const { analysis, drills, meta, frames, analysisId } = result;
  const positions = Object.entries(analysis.positions);
  const avgGrade = positions.reduce((sum, [, d]) => sum + GRADE_ORDER[d.grade], 0) / positions.length;
  const overallGrade: Grade = avgGrade >= 3.5 ? "A" : avgGrade >= 2.5 ? "B" : avgGrade >= 1.5 ? "C" : avgGrade >= 0.5 ? "D" : "F";

  const clubLabel: Record<string, string> = {
    driver: "Driver", fairway: "3W / 5W", "long-iron": "Long Iron", "mid-iron": "Mid Iron", wedge: "Wedge",
  };

  return (
    <main className="min-h-screen bg-[#080808] text-white pb-16">
      <div className="max-w-lg lg:max-w-6xl mx-auto px-5 lg:px-10">

        {/* Header */}
        <div className="py-8 flex items-center justify-between">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            New Analysis
          </button>
          <div className="flex items-center gap-3">
            {analysisId && (
              <Link
                href="/history"
                className="flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Saved to history
              </Link>
            )}
            <div className="flex items-center gap-2 text-xs text-white/30">
              <span>{clubLabel[meta.club]}</span>
              <span>·</span>
              <span>{meta.camera_angle.toUpperCase()}</span>
            </div>
          </div>
        </div>

        {/* Top row — Score Card + Priority Fix side-by-side on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
          {/* Score Card */}
          <div className="bg-white/5 border border-white/10 rounded-3xl p-6">
            <div className="flex items-center gap-6">
              <ScoreRing score={analysis.overall_score} />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-white/40 uppercase tracking-widest">Overall Grade</span>
                  <GradeBadge grade={overallGrade} size="sm" />
                </div>
                <p className="text-sm text-white/70 leading-relaxed">{analysis.summary}</p>
              </div>
            </div>
          </div>

          {/* Priority Fix */}
          <div className="bg-green-500/10 border border-green-500/20 rounded-3xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-xs font-semibold text-green-400 uppercase tracking-widest">Priority Fix — {analysis.priority_fix.position}</span>
            </div>
            <p className="text-white font-medium mb-1">{analysis.priority_fix.problem}</p>
            <p className="text-sm text-white/50 mb-3">{analysis.priority_fix.why_it_matters}</p>
            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-xs text-white/40 mb-1">Drill</p>
              <p className="text-sm text-white/80">{analysis.priority_fix.drill}</p>
            </div>
          </div>
        </div>

        {/* Filmstrip — horizontal scroll on mobile, 10-col grid edge-to-edge on desktop */}
        {frames && frames.length > 0 && (
          <div className="mb-8">
            <p className="text-xs text-white/30 uppercase tracking-widest mb-3">Your Swing — {frames.length} Frames</p>
            <div className="flex lg:grid lg:grid-cols-10 gap-2 overflow-x-auto lg:overflow-visible pb-2 scrollbar-hide">
              {frames.map((src, i) => (
                <button key={i} className="relative shrink-0 lg:shrink lg:w-full" onClick={() => setExpandedIndex(i)}>
                  <img
                    src={src}
                    alt={`Frame ${i + 1}`}
                    className="h-40 lg:h-auto w-auto lg:w-full rounded-lg object-cover lg:aspect-[3/5]"
                  />
                  <span className="absolute bottom-1 left-1 text-[10px] font-bold text-white/70 bg-black/60 rounded px-1">{i + 1}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Frame lightbox */}
        {frames && (
          <FrameLightbox
            frames={frames}
            index={expandedIndex}
            onClose={() => setExpandedIndex(null)}
            onIndexChange={setExpandedIndex}
          />
        )}

        {/* Tabs */}
        <div className="sticky top-0 z-20 -mx-5 px-5 pt-2 pb-3 bg-[#080808]/95 backdrop-blur-sm">
          <div className="flex gap-1 bg-white/5 rounded-xl p-1">
            {(["positions", "drills"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all capitalize ${
                  tab === t ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                {t === "positions" ? "P1–P10 Breakdown" : `Drills (${drills.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Positions — 1 col on mobile, 2 col on desktop */}
        {tab === "positions" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
            {positions.map(([pos, data]) => (
              <PositionCard
                key={pos}
                position={pos}
                data={data}
              />
            ))}
          </div>
        )}

        {/* Drills — 1 col on mobile, 2 col on desktop */}
        {tab === "drills" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
            {drills.length === 0 ? (
              <p className="text-white/40 text-sm text-center py-8 col-span-full">No drills generated.</p>
            ) : (
              drills.map((drill, i) => <DrillCard key={i} drill={drill} index={i} />)
            )}
          </div>
        )}
      </div>
    </main>
  );
}
