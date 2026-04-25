"use client";

import { useEffect, useState } from "react";

const STATUS_MESSAGES = [
  "Uploading video...",
  "Extracting frames...",
  "Analyzing your swing...",
  "Generating drills...",
  "Almost done...",
];

export default function LoadingOverlay() {
  const [progress, setProgress] = useState(0);
  const [statusIdx, setStatusIdx] = useState(0);

  // Logarithmic fake progress — fast at first, eases off, parks at 90% until parent unmounts
  useEffect(() => {
    let raf = 0;
    const start = Date.now();
    const ESTIMATED_MS = 90000;
    const tau = ESTIMATED_MS / 2.3;

    function tick() {
      const elapsed = Date.now() - start;
      const p = Math.min(90, 90 * (1 - Math.exp(-elapsed / tau)));
      setProgress(p);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Cycle status messages every ~14s
  useEffect(() => {
    const id = setInterval(() => {
      setStatusIdx((i) => Math.min(STATUS_MESSAGES.length - 1, i + 1));
    }, 14000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-[#0A0908]/95 backdrop-blur-md flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 px-8">
        <img
          src="/golfer-loading.webp"
          alt=""
          className="w-48 h-48 sm:w-56 sm:h-56 object-contain opacity-90"
        />

        <div className="w-72 sm:w-80">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[11px] font-display font-semibold tracking-[0.25em] uppercase text-white/50">
              Analyzing
            </span>
            <span className="text-[11px] font-display font-semibold tracking-widest text-[#D4A24C]">
              {Math.floor(progress)}%
            </span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${progress}%`,
                background: "linear-gradient(to right, #D4A24C, #E8C375)",
                boxShadow: "0 0 12px rgba(212, 162, 76, 0.5)",
              }}
            />
          </div>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <p className="text-sm text-white/70 font-medium tracking-wide">
            {STATUS_MESSAGES[statusIdx]}
          </p>
          <p className="text-xs text-white/30">Usually takes 60–90 seconds</p>
        </div>
      </div>
    </div>
  );
}
