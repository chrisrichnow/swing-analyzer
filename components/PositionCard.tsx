import { PositionData } from "@/types";
import GradeBadge from "./Gradebadge";

interface Props {
  position: string;
  data: PositionData;
}

export default function PositionCard({ position, data }: Props) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white/60">{position}</span>
        <GradeBadge grade={data.grade} />
      </div>
      <div className="space-y-2 text-sm">
        <p className="text-white/80 leading-relaxed">{data.what_is_good}</p>
        {data.issue && (
          <div className="pt-2 border-t border-white/10">
            <p className="text-red-400/80 text-xs mb-1">Issue</p>
            <p className="text-white/70 leading-relaxed">{data.issue}</p>
          </div>
        )}
        {data.fix && (
          <div className="pt-2 border-t border-white/10">
            <p className="text-green-400/80 text-xs mb-1">Fix</p>
            <p className="text-white/70 leading-relaxed">{data.fix}</p>
          </div>
        )}
      </div>
    </div>
  );
}
