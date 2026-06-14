"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import UploadZone from "@/components/UploadZone";
import LoadingOverlay from "@/components/LoadingOverlay";
import { CameraAngle, Club } from "@/types";
import { createClient } from "@/lib/supabase/client";

const CLUBS: { value: Club; label: string }[] = [
  { value: "driver", label: "Driver" },
  { value: "fairway", label: "3W / 5W" },
  { value: "long-iron", label: "Long Iron" },
  { value: "mid-iron", label: "Mid Iron" },
  { value: "wedge", label: "Wedge" },
];

export default function Home() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [angle, setAngle] = useState<CameraAngle>("dtl");
  const [club, setClub] = useState<Club>("mid-iron");
  const [loading, setLoading] = useState(false);
  const [loadStep, setLoadStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    if (supabase) supabase.auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user));
  }, []);

  async function handleAnalyze() {
    if (!file) return;
    setLoading(true);
    setLoadStep(0);
    setError(null);

    try {
      const form = new FormData();
      form.append("video", file);
      form.append("cameraAngle", angle);
      form.append("club", club);

      const res = await fetch("/api/analyze", { method: "POST", body: form });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Analysis failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";

        for (const msg of messages) {
          const dataLine = msg.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.slice(6));

          if (event.type === "status") {
            setLoadStep(event.step ?? 0);
          } else if (event.type === "error") {
            throw new Error(event.message);
          } else if (event.type === "done") {
            sessionStorage.setItem("swingResult", JSON.stringify(event.result));
            router.push("/results");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen text-[#F5F2EC]">
      {loading && <LoadingOverlay statusIndex={loadStep} />}
      <div className="max-w-xl lg:max-w-3xl mx-auto px-5 lg:px-10 py-10 sm:py-14 flex flex-col gap-10">

        {/* Header */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#D4A24C] to-[#A87A2E] flex items-center justify-center shadow-lg shadow-amber-900/30">
              {/* Golf flag icon */}
              <svg className="w-4.5 h-4.5 text-[#0A0908]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 3a1 1 0 011-1h.5a1 1 0 011 1v18a1 1 0 01-1 1H7a1 1 0 01-1-1V3z" />
                <path d="M9 4l9 2.5a.5.5 0 010 .96L9 10V4z" />
              </svg>
            </div>
            <span className="font-display text-xl font-semibold text-white/80 tracking-[0.18em] uppercase">
              Golf Swing Analyzer
            </span>
          </div>

          <div>
            <h1 className="font-display text-5xl sm:text-6xl font-bold uppercase leading-[0.95] tracking-tight">
              Analyze<br />
              <span className="bg-gradient-to-r from-[#D4A24C] to-[#E8C375] bg-clip-text text-transparent">your swing.</span>
            </h1>
            <p className="text-white/60 mt-4 text-[15px] leading-relaxed max-w-md">
              Upload a swing video and get a full P1–P10 breakdown with grades, feedback, and personalized drills — built by AI, scored like a coach.
            </p>
          </div>

          {/* Trust strip */}
          <div className="flex items-center gap-4 text-[11px] text-white/40 uppercase tracking-widest font-medium">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4A24C]" />
              P1–P10 Frames
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4A24C]" />
              Letter Grades
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4A24C]" />
              Custom Drills
            </span>
          </div>

          {/* Save-your-work banner for logged-out users */}
          {isLoggedIn === false && (
            <div className="flex items-center gap-3 bg-white/[0.04] border border-white/8 rounded-xl px-4 py-3">
              <svg className="w-4 h-4 text-[#D4A24C] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              <p className="text-xs text-white/45 leading-relaxed">
                <Link href="/signup" className="text-[#D4A24C] hover:text-[#E8C375] transition-colors font-medium">
                  Create a free account
                </Link>{" "}
                to save your analyses, track progress over time, and get AI coaching based on your history.
              </p>
            </div>
          )}
        </div>

        {/* Upload */}
        <div className="flex flex-col gap-3">
          <label className="font-display text-xs font-semibold text-[#D4A24C] uppercase tracking-[0.25em]">01 · Video</label>
          <UploadZone onFile={setFile} file={file} />
        </div>

        {/* Camera Angle */}
        <div className="flex flex-col gap-3">
          <label className="font-display text-xs font-semibold text-[#D4A24C] uppercase tracking-[0.25em]">02 · Camera Angle</label>
          <div className="grid grid-cols-2 gap-2">
            {(["dtl", "face-on"] as CameraAngle[]).map((a) => (
              <button
                key={a}
                onClick={() => setAngle(a)}
                className={`cursor-pointer py-3.5 px-4 rounded-xl border text-sm font-semibold transition-all duration-200 ${
                  angle === a
                    ? "bg-[var(--accent-soft)] border-[var(--accent-border)] text-[#D4A24C]"
                    : "bg-white/[0.03] border-white/10 text-white/60 hover:border-white/25 hover:text-white/90"
                }`}
              >
                {a === "dtl" ? "Down-the-Line" : "Face-On"}
              </button>
            ))}
          </div>
          <p className="text-xs text-white/35">
            {angle === "dtl"
              ? "Camera behind you, pointed toward the target."
              : "Camera facing you from in front."}
          </p>
        </div>

        {/* Club */}
        <div className="flex flex-col gap-3">
          <label className="font-display text-xs font-semibold text-[#D4A24C] uppercase tracking-[0.25em]">03 · Club</label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {CLUBS.map((c) => (
              <button
                key={c.value}
                onClick={() => setClub(c.value)}
                className={`cursor-pointer py-2.5 px-3 rounded-xl border text-sm font-semibold transition-all duration-200 ${
                  club === c.value
                    ? "bg-[var(--accent-soft)] border-[var(--accent-border)] text-[#D4A24C]"
                    : "bg-white/[0.03] border-white/10 text-white/60 hover:border-white/25 hover:text-white/90"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleAnalyze}
          disabled={!file || loading}
          className="cursor-pointer w-full py-4 rounded-2xl bg-gradient-to-r from-[#D4A24C] to-[#B8862F] hover:from-[#E0B05E] hover:to-[#C49237] disabled:from-white/10 disabled:to-white/10 disabled:text-white/30 text-[#0A0908] font-display font-bold text-lg uppercase tracking-widest transition-all duration-200 shadow-lg shadow-amber-900/30 disabled:shadow-none"
        >
          Analyze Swing
        </button>

        <p className="text-center text-xs text-white/25 tracking-wide">
          Analysis takes 30–60 seconds. Keep this screen open.
        </p>
      </div>
    </main>
  );
}
