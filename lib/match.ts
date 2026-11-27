import { RELATED_FIELDS, fieldLabel, type BandId, type FieldId } from "@/config/scoring";
import { EM_CATALOGUE_URL, type Programme } from "@/lib/programmes/source";

export type ProgrammeMatch = {
  id: string;
  name: string;
  acronym: string;
  tag: "Reach" | "Match" | "Safer";
  why: string;
  url: string;
};

/** Ideal competitiveness level per band: strong profiles aim higher, weaker ones aim safer. */
const TARGET_LEVEL: Record<BandId, number> = { STRONG: 3, COMPETITIVE: 2.5, NEEDS_WORK: 1.5, NOT_READY: 1 };

type Scored = { p: Programme; s: number; field: FieldId };

/** Score of one programme for one target field (unchanged from the single-field version). */
function scoreFor(p: Programme, field: FieldId, bachelorField: FieldId | "other", target: number): number {
  const related = RELATED_FIELDS[field];
  let s = 0;
  const pi = p.fields.indexOf(field);
  if (pi === 0) s += 10;
  else if (pi > 0) s += 7;
  else if (p.fields.some((f) => related.includes(f))) s += 2;
  if (bachelorField !== "other" && p.fields.includes(bachelorField)) s += 3;
  s -= Math.abs(p.competitiveness - target) * 1.5;
  return s;
}

const byScore = (a: Scored, b: Scored) => b.s - a.s || a.p.id.localeCompare(b.p.id);

/**
 * Deterministic: same inputs always give the same programmes in the same order.
 * With several target fields, each field first gets its best programme (in selection order),
 * then the remaining slots go to the highest scores across all fields.
 */
export function matchProgrammes(
  all: Programme[],
  targetFields: FieldId | FieldId[],
  bachelorField: FieldId | "other",
  band: BandId,
  count = 3
): ProgrammeMatch[] {
  const fields = (Array.isArray(targetFields) ? targetFields : [targetFields]).filter((f, i, arr) => arr.indexOf(f) === i);
  const target = TARGET_LEVEL[band];

  // Per field: ranked list of programmes with a positive score.
  const perField = fields.map((f) =>
    all
      .map((p) => ({ p, s: scoreFor(p, f, bachelorField, target), field: f }))
      .filter((x) => x.s > 0)
      .sort(byScore)
  );

  const picked: Scored[] = [];
  const taken = new Set<string>();
  // Round 1: one per field, in selection order.
  for (const list of perField) {
    if (picked.length >= count) break;
    const best = list.find((x) => !taken.has(x.p.id));
    if (best) {
      picked.push(best);
      taken.add(best.p.id);
    }
  }
  // Then: best remaining across all fields (each programme counted with its best field).
  const bestPerProgramme = new Map<string, Scored>();
  for (const list of perField)
    for (const x of list) {
      const cur = bestPerProgramme.get(x.p.id);
      if (!cur || x.s > cur.s) bestPerProgramme.set(x.p.id, x);
    }
  const rest = [...bestPerProgramme.values()].filter((x) => !taken.has(x.p.id)).sort(byScore);
  for (const x of rest) {
    if (picked.length >= count) break;
    picked.push(x);
  }
  // With one field this keeps the exact previous order (highest score first).
  if (fields.length === 1) picked.sort(byScore);

  return picked.map(({ p, field }) => ({
    id: p.id,
    name: p.name,
    acronym: p.acronym,
    tag: p.competitiveness > target + 0.4 ? "Reach" : p.competitiveness < target - 0.4 ? "Safer" : "Match",
    why: `${p.fields.includes(field) ? `Core ${fieldLabel(field)} programme` : `Related to ${fieldLabel(field)}`}${
      bachelorField !== "other" && p.fields.includes(bachelorField) && bachelorField !== field
        ? `, and builds on your ${fieldLabel(bachelorField)} degree`
        : ""
    }. ${["", "Less competitive intake", "Moderately competitive", "Highly competitive"][p.competitiveness]}.`,
    url: p.url ?? EM_CATALOGUE_URL,
  }));
}
