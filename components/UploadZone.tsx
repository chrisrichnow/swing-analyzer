"use client";

import { useRef, useState, DragEvent, ChangeEvent } from "react";

interface Props {
  onFile: (file: File) => void;
  file: File | null;
}

export default function UploadZone({ onFile, file }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) onFile(selected);
  }

  if (file) {
    return (
      <div className="flex items-center justify-between gap-4 w-full px-4 py-4 rounded-2xl bg-green-500/10 border border-green-500/20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 shrink-0 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{file.name}</p>
            <p className="text-xs text-white/40">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
          </div>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 text-xs text-white/40 hover:text-white/70 transition-colors px-3 py-1.5 rounded-lg bg-white/5 border border-white/10"
        >
          Change
        </button>
        <input ref={fileInputRef} type="file" accept="video/*,.mov,.mp4,.hevc" className="hidden" onChange={handleChange} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Mobile: two action buttons */}
      <div className="flex gap-3 sm:hidden">
        <button
          onClick={() => cameraInputRef.current?.click()}
          className="flex-1 flex flex-col items-center justify-center gap-2 py-5 rounded-2xl bg-green-500/10 border border-green-500/20 active:bg-green-500/20 transition-colors"
        >
          <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.87V15.13a1 1 0 01-1.447.899L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
          <span className="text-sm font-medium text-green-400">Record Video</span>
          <span className="text-xs text-white/30">Use camera</span>
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 flex flex-col items-center justify-center gap-2 py-5 rounded-2xl bg-white/5 border border-white/10 active:bg-white/10 transition-colors"
        >
          <svg className="w-6 h-6 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-sm font-medium text-white/70">From Library</span>
          <span className="text-xs text-white/30">Choose file</span>
        </button>
      </div>

      {/* Desktop: drag-drop zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`
          hidden sm:flex relative flex-col items-center justify-center gap-3 w-full h-44 rounded-2xl border-2 border-dashed cursor-pointer transition-all
          ${dragging ? "border-green-500 bg-green-500/10" : "border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/10"}
        `}
      >
        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
          <svg className="w-5 h-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.87V15.13a1 1 0 01-1.447.899L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-white/80">Drop your swing video here</p>
        <p className="text-xs text-white/40">or click to browse — MOV, MP4, HEVC supported</p>
      </div>

      {/* Hidden inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mov,.mp4,.hevc,.avi,.webm,.mkv"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
