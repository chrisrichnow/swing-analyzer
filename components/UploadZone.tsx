"use client";

import { useRef, useState, DragEvent, ChangeEvent } from "react";

interface Props {
  onFile: (file: File) => void;
  file: File | null;
}

export default function UploadZone({ onFile, file }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
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

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`
        relative flex flex-col items-center justify-center gap-3 w-full h-44 rounded-2xl border-2 border-dashed cursor-pointer transition-all
        ${dragging ? "border-green-500 bg-green-500/10" : "border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/10"}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*,.mov,.mp4,.hevc,.avi,.webm,.mkv"
        className="hidden"
        onChange={handleChange}
      />
      {file ? (
        <>
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-white">{file.name}</p>
          <p className="text-xs text-white/40">{(file.size / 1024 / 1024).toFixed(1)} MB — tap to change</p>
        </>
      ) : (
        <>
          <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.87V15.13a1 1 0 01-1.447.899L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-white/80">Drop your swing video here</p>
          <p className="text-xs text-white/40">or tap to browse — MOV, MP4, HEVC supported</p>
        </>
      )}
    </div>
  );
}
