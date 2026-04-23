"use client";

import { useState } from "react";
import { PositionData } from "@/types";
import GradeBadge from "./Gradebadge";

const POSITION_LABELS: Record<string, string> = {
  P1: "Address",
  P2: "Takeaway",
  P3: "Backswing",
  P4: "Top",
  P5: "Downswing",
  P6: "Delivery",
  P7: "Impact",
  P8: "Early Follow-Through",
  P9: "Follow-Through",
  P10: "Finish",
};

function YouTubeThumbnail({ videoId }: { videoId: string }) {
  const [failed, setFailed] = useState(false);
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  if (failed) {
    return (
      <a
        href={`https://www.youtube.com/results?search_query=${encodeURIComponent("golf swing " + videoId)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col items-center justify-center gap-2 w-full aspect-video rounded-xl bg-white/5 border border-white/10 text-white/30 text-xs hover:border-white/20 hover:text-white/50 transition-colors"
      >
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
        Search on YouTube
      </a>
    );
  }

  return (
    <a
      href={youtubeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block relative group rounded-xl overflow-hidden"
    >
      <img
        src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
        alt="Ideal position reference"
        className="w-full aspect-video object-cover"
        onError={() => setFailed(true)}
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-2 bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
          </svg>
          Watch on YouTube
        </div>
      </div>
    </a>
  );
}

interface Props {
  position: string;
  data: PositionData;
  frameDataUrl?: string;
}

export default function PositionCard({ position, data, frameDataUrl }: Props) {
  const hasIssue = !!data.issue;
  const hasReference = hasIssue && !!data.reference_youtube_id;
  const showImages = frameDataUrl || hasReference;

  return (
    <div className={`bg-white/5 border rounded-2xl p-4 flex flex-col gap-4 ${hasIssue ? "border-white/10" : "border-white/[0.06]"}`}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">{position}</span>
          <span className="text-xs text-white/35">{POSITION_LABELS[position]}</span>
        </div>
        <GradeBadge grade={data.grade} />
      </div>

      {/* Images — stacked vertically for mobile clarity */}
      {showImages && (
        <div className="flex flex-col gap-3">
          {frameDataUrl && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Your Swing</p>
              <div className="rounded-xl overflow-hidden bg-black/40">
                <img
                  src={frameDataUrl}
                  alt={`Your swing at ${position}`}
                  className="w-full object-contain"
                />
              </div>
            </div>
          )}
          {hasReference && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-green-400/50">Ideal Position</p>
              <YouTubeThumbnail videoId={data.reference_youtube_id!} />
            </div>
          )}
        </div>
      )}

      {/* Text content */}
      <div className="space-y-3 text-sm">
        <p className="text-white/65 leading-relaxed">{data.what_is_good}</p>
        {hasIssue && (
          <div className="pt-3 border-t border-white/10 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-red-400/70">Issue</p>
            <p className="text-white/70 leading-relaxed">{data.issue}</p>
          </div>
        )}
        {data.fix && (
          <div className="pt-3 border-t border-white/10 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-green-400/70">Fix</p>
            <p className="text-white/70 leading-relaxed">{data.fix}</p>
          </div>
        )}
      </div>

      {/* Reference video link */}
      {hasReference && (
        <a
          href={`https://www.youtube.com/watch?v=${data.reference_youtube_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-red-400/80 hover:text-red-400 transition-colors mt-1"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
          </svg>
          Watch reference video on YouTube
          <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  );
}
