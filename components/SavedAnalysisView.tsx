"use client";

import { useState } from "react";
import { Analysis, Drill, Grade } from "@/types";
import GradeBadge from "@/components/Gradebadge";
import PositionCard from "@/components/PositionCard";
import DrillCard from "@/components/DrillCard";

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

interface Props {
  analysis: Analysis;
  drills: Drill[];
  frames: string[];
  meta: { club: string; camera_angle: string; analyzed_at: string };
}

export default function SavedAnalysisView({ analysis, drills, frames }: Props) {
  const [tab, setTab] = useState<"positions" | "drills">("positions");
  const [expandedFrame, setExpandedFrame] = useState<string | null>(null);

  const positions = Object.entries(analysis.positions);
  const avgGrade =
    positions.reduce((sum, [, d]) => sum + GRADE_ORDER[d.grade], 0) / positions.length;
  const overallGrade: Grade =
    avgGrade >= 3.5 ? "A" : avgGrade >= 2.5 ? "B" : avgGrade >= 1.5 ? "C" : avgGrade >= 0.5 ? "D" : "F";

  return (
    <>
      {/* Top row — Score Card + Priority Fix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
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

        <div className="bg-green-500/10 border border-green-500/20 rounded-3xl p-6">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-xs font-semibold text-green-400 uppercase tracking-widest">
              Priority Fix — {analysis.priority_fix.position}
            </span>
          </div>
          <p className="text-white font-medium mb-1">{analysis.priority_fix.problem}</p>
          <p className="text-sm text-white/50 mb-3">{analysis.priority_fix.why_it_matters}</p>
          <div className="bg-white/5 rounded-xl p-3">
            <p className="text-xs text-white/40 mb-1">Drill</p>
            <p className="text-sm text-white/80">{analysis.priority_fix.drill}</p>
          </div>
        </div>
      </div>

      {/* Filmstrip */}
      {frames.length > 0 && (
        <div className="mb-8">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-3">
            Your Swing — {frames.length} Frames
          </p>
          <div className="flex lg:grid lg:grid-cols-10 gap-2 overflow-x-auto lg:overflow-visible pb-2 scrollbar-hide">
            {frames.map((src, i) =>
              src ? (
                <button
                  key={i}
                  className="relative shrink-0 lg:shrink lg:w-full"
                  onClick={() => setExpandedFrame(src)}
                >
                  <img
                    src={src}
                    alt={`Frame ${i + 1}`}
                    className="h-40 lg:h-auto w-auto lg:w-full rounded-lg object-cover lg:aspect-[3/5]"
                  />
                  <span className="absolute bottom-1 left-1 text-[10px] font-bold text-white/70 bg-black/60 rounded px-1">
                    {i + 1}
                  </span>
                </button>
              ) : (
                <div
                  key={i}
                  className="relative shrink-0 lg:shrink lg:w-full h-40 lg:h-auto lg:aspect-[3/5] rounded-lg bg-white/5 border border-white/8 flex items-center justify-center"
                >
                  <span className="text-[10px] text-white/20">{i + 1}</span>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Frame lightbox */}
      {expandedFrame && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setExpandedFrame(null)}
        >
          <img
            src={expandedFrame}
            alt="Frame"
            className="max-w-full max-h-full rounded-xl object-contain"
          />
        </div>
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

      {/* Positions */}
      {tab === "positions" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
          {positions.map(([pos, data]) => (
            <PositionCard key={pos} position={pos} data={data} />
          ))}
        </div>
      )}

      {/* Drills */}
      {tab === "drills" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
          {drills.length === 0 ? (
            <p className="text-white/40 text-sm text-center py-8 col-span-full">
              No drills generated.
            </p>
          ) : (
            drills.map((drill, i) => <DrillCard key={i} drill={drill} index={i} />)
          )}
        </div>
      )}
    </>
  );
}
