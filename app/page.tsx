"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UploadZone from "@/components/UploadZone";
import { CameraAngle, Club } from "@/types";

const CLUBS: { value: Club; label: string }[] = [
  { value: "driver", label: "Driver" },
  { value: "fairway", label: "3W / 5W" },
  { value: "long-iron", label: "Long Iron" },
  { value: "mid-iron", label: "Mid Iron" },
  { value: "wedge", label: "Wedge" },
];

const STEPS = ["Uploading video...", "Extracting frames...", "Analyzing swing...", "Generating drills..."];

export default function Home() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [angle, setAngle] = useState<CameraAngle>("dtl");
  const [club, setClub] = useState<Club>("mid-iron");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setStep(0);

    const stepInterval = setInterval(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 8000);

    try {
      const form = new FormData();
      form.append("video", file);
      form.append("cameraAngle", angle);
      form.append("club", club);

      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Analysis failed.");

      sessionStorage.setItem("swingResult", JSON.stringify(data));
      router.push("/results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      clearInterval(stepInterval);
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#080808] text-white">
      <div className="max-w-lg mx-auto px-5 py-12 flex flex-col gap-10">

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-sm font-medium text-white/40 tracking-widest uppercase">Swing Analyzer</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Analyze your swing.</h1>
          <p className="text-white/50 mt-2 text-sm leading-relaxed">
            Upload a swing video and get a full P1-P10 breakdown with grades, feedback, and personalized drills.
          </p>
        </div>

        {/* Upload */}
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold text-white/40 uppercase tracking-widest">Video</label>
          <UploadZone onFile={setFile} file={file} />
        </div>

        {/* Camera Angle */}
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold text-white/40 uppercase tracking-widest">Camera Angle</label>
          <div className="grid grid-cols-2 gap-2">
            {(["dtl", "face-on"] as CameraAngle[]).map((a) => (
              <button
                key={a}
                onClick={() => setAngle(a)}
                className={`py-3 px-4 rounded-xl border text-sm font-medium transition-all ${
                  angle === a
                    ? "bg-green-500/20 border-green-500/50 text-green-400"
                    : "bg-white/5 border-white/10 text-white/50 hover:border-white/30 hover:text-white/80"
                }`}
              >
                {a === "dtl" ? "Down-the-Line" : "Face-On"}
              </button>
            ))}
          </div>
          <p className="text-xs text-white/30">
            {angle === "dtl"
              ? "Camera behind you, pointed toward the target."
              : "Camera facing you from in front."}
          </p>
        </div>

        {/* Club */}
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold text-white/40 uppercase tracking-widest">Club</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {CLUBS.map((c) => (
              <button
                key={c.value}
                onClick={() => setClub(c.value)}
                className={`py-2.5 px-3 rounded-xl border text-sm font-medium transition-all ${
                  club === c.value
                    ? "bg-green-500/20 border-green-500/50 text-green-400"
                    : "bg-white/5 border-white/10 text-white/50 hover:border-white/30 hover:text-white/80"
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
          className="w-full py-4 rounded-2xl bg-green-500 hover:bg-green-400 disabled:bg-white/10 disabled:text-white/30 text-white font-semibold text-base transition-all"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-3">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {STEPS[step]}
            </span>
          ) : (
            "Analyze Swing"
          )}
        </button>

        <p className="text-center text-xs text-white/20">
          Analysis takes 30–60 seconds. Keep this screen open.
        </p>
      </div>
    </main>
  );
}
