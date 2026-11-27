import type { FieldId } from "@/config/scoring";

export type Programme = {
  id: string;
  name: string;
  acronym: string;
  fields: FieldId[];
  /** 1 = less competitive, 2 = moderate, 3 = highly competitive (our heuristic) */
  competitiveness: 1 | 2 | 3;
  url?: string;
};

/** Pluggable programme data source. Swap the implementation via PROGRAMME_SOURCE later (n8n, Sheet, DB). */
export interface ProgrammeSource {
  list(): Promise<Programme[]>;
}

export const EM_CATALOGUE_URL = "https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en";

export async function getProgrammeSource(): Promise<ProgrammeSource> {
  // Only the bundled JSON source exists today.
  const { JsonProgrammeSource } = await import("./json");
  return new JsonProgrammeSource();
}
