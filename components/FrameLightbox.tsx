"use client";

import { useEffect, useCallback } from "react";

const POSITION_LABELS = [
  "Address",
  "Takeaway",
  "Backswing",
  "Top",
  "Downswing",
  "Delivery",
  "Impact",
  "Early Follow-Through",
  "Follow-Through",
  "Finish",
];

interface Props {
  frames: (string | null)[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}

// Full-screen frame viewer with prev/next navigation. Lets the user step through
// the P1-P10 swing frames in place (arrows / keyboard) instead of closing and
// reopening each one.
export default function FrameLightbox({ frames, index, onClose, onIndexChange }: Props) {
  // Next/prev skip over any null (missing) frames so the arrows never land on a blank.
  const step = useCallback(
    (dir: 1 | -1) => {
      if (index === null) return;
      let i = index + dir;
      while (i >= 0 && i < frames.length && !frames[i]) i += dir;
      if (i >= 0 && i < frames.length) onIndexChange(i);
    },
    [index, frames, onIndexChange]
  );

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, step, onClose]);

  if (index === null) return null;
  const src = frames[index];
  if (!src) return null;

  const hasPrev = frames.slice(0, index).some(Boolean);
  const hasNext = frames.slice(index + 1).some(Boolean);
  const label = POSITION_LABELS[index] ?? "";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Prev arrow */}
      <button
        onClick={(e) => { e.stopPropagation(); step(-1); }}
        disabled={!hasPrev}
        aria-label="Previous frame"
        className="absolute left-2 sm:left-6 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 disabled:cursor-default text-white flex items-center justify-center transition-colors"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Image + caption (clicking the image steps forward, not closes) */}
      <div className="flex flex-col items-center gap-3 max-h-full" onClick={(e) => e.stopPropagation()}>
        <img
          src={src}
          alt={`P${index + 1} ${label}`}
          onClick={() => step(1)}
          className="max-w-full max-h-[80vh] rounded-xl object-contain cursor-pointer select-none"
        />
        <div className="flex items-center gap-2 text-sm">
          <span className="font-bold text-white">P{index + 1}</span>
          <span className="text-white/50">{label}</span>
          <span className="text-white/30">·</span>
          <span className="text-white/40">{index + 1} / {frames.length}</span>
        </div>
      </div>

      {/* Next arrow */}
      <button
        onClick={(e) => { e.stopPropagation(); step(1); }}
        disabled={!hasNext}
        aria-label="Next frame"
        className="absolute right-2 sm:right-6 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 disabled:cursor-default text-white flex items-center justify-center transition-colors"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
