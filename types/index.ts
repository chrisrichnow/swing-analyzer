export type Grade = "A" | "B" | "C" | "D" | "F";

export interface PositionData {
  frame: number;
  score: number;        // 0-100, model-assigned; grade is derived from it
  grade: Grade;
  what_is_good: string;
  issue: string | null;
  fix: string;
}

export interface PriorityFix {
  position: string;
  problem: string;
  why_it_matters: string;
  drill: string;
}

export interface Analysis {
  overall_score: number;
  summary: string;
  positions: Record<string, PositionData>;
  priority_fix: PriorityFix;
  drills: Drill[];
}

export interface Drill {
  name: string;
  target_position: string;
  fault_addressed: string;
  steps: string[];
  youtube_search: string;
  youtube_url: string;
}

export interface SwingResult {
  meta: {
    video: string;
    camera_angle: string;
    club: string;
    analyzed_at: string;
  };
  analysis: Analysis;
  drills: Drill[];
  frames?: string[];
  analysisId?: string | null;
}

export type CameraAngle = "dtl" | "face-on";
export type Club = "driver" | "fairway" | "long-iron" | "mid-iron" | "wedge";
