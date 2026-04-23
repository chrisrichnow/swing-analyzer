import { Drill } from "@/types";

export default function DrillCard({ drill, index }: { drill: Drill; index: number }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
              {drill.target_position}
            </span>
          </div>
          <h3 className="text-base font-semibold text-white">{drill.name}</h3>
          <p className="text-sm text-white/50 mt-0.5">{drill.fault_addressed}</p>
        </div>
        <span className="text-2xl font-bold text-white/10 shrink-0">#{index + 1}</span>
      </div>

      <ol className="space-y-2">
        {drill.steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-sm text-white/70 leading-relaxed">
            <span className="shrink-0 w-5 h-5 rounded-full bg-white/10 text-white/50 text-xs flex items-center justify-center font-medium mt-0.5">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      <a
        href={drill.youtube_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors group"
      >
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
        Watch on YouTube
        <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    </div>
  );
}
