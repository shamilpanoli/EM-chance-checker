import type { ScoreResult } from "@/lib/scoring";
import type { ProgrammeMatch } from "@/lib/match";
import type { FieldId } from "@/config/scoring";

export type FullReport = Omit<ScoreResult, "facts" | "primaryField"> & {
  programmes: ProgrammeMatch[];
  /** e.g. "Data Science & Analytics + Computer Science & AI" */
  targetFieldLabel: string;
  /** Chosen fields in selection order (absent in reports from older n8n workflows). */
  targetFields?: FieldId[];
};
