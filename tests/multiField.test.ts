import { describe, expect, it } from "vitest";
import { scoreProfile, bestFit } from "@/lib/scoring";
import { matchProgrammes } from "@/lib/match";
import programmes from "@/data/programmes.json";
import { AnswersInputSchema, type Extracted, type Answers } from "@/lib/schema";
import type { Programme } from "@/lib/programmes/source";
import type { FieldId } from "@/config/scoring";

const all = programmes as Programme[];
const NOW = new Date("2026-11-27T00:00:00Z");

const ex: Extracted = {
  education: [],
  bachelorSubject: "B.Tech Computer Science",
  bachelorFieldId: "cs_ai",
  backlogsMentioned: false,
  jobs: [],
  publications: [],
  researchProjects: [],
  projects: [],
  skills: [],
  leadership: [],
  languages: [],
  englishTest: null,
  resumeQuality: { hasDatedEntries: true, hasQuantifiedResults: false, hasPhotoOrDob: false, europassStyleSections: false },
};
const answers = (fields: FieldId[]): Answers => ({
  cgpa: 8.2,
  cgpaScale: "10",
  englishType: "IELTS",
  englishScore: 7,
  targetFields: fields,
  intakeYear: 2027,
});

describe("answers schema", () => {
  const raw = { cgpa: 8.2, cgpaScale: "10", englishType: "IELTS", englishScore: 7, intakeYear: 2027 };
  it("accepts 1–3 fields and sets targetField to the first", () => {
    const a = AnswersInputSchema.parse({ ...raw, targetFields: ["data_science", "cs_ai"] });
    expect(a.targetFields).toEqual(["data_science", "cs_ai"]);
    expect(a.targetField).toBe("data_science");
  });
  it("still accepts the legacy single targetField", () => {
    const a = AnswersInputSchema.parse({ ...raw, targetField: "cs_ai" });
    expect(a.targetFields).toEqual(["cs_ai"]);
  });
  it("rejects 0, 4 or duplicate fields", () => {
    expect(AnswersInputSchema.safeParse({ ...raw, targetFields: [] }).success).toBe(false);
    expect(AnswersInputSchema.safeParse({ ...raw, targetFields: ["cs_ai", "physics", "energy", "education"] }).success).toBe(false);
    expect(AnswersInputSchema.safeParse({ ...raw, targetFields: ["cs_ai", "cs_ai"] }).success).toBe(false);
  });
});

describe("degree fit across several fields", () => {
  it("uses the best fit: direct beats related beats unrelated", () => {
    expect(bestFit("cs_ai", ["humanities", "data_science", "cs_ai"])).toEqual({ field: "cs_ai", fit: "direct" });
    expect(bestFit("cs_ai", ["humanities", "data_science"])).toEqual({ field: "data_science", fit: "related" });
  });
  it("breaks ties with the first selected field", () => {
    expect(bestFit("cs_ai", ["data_science", "electrical"])).toEqual({ field: "data_science", fit: "related" });
    expect(bestFit("other", ["humanities", "education"])).toEqual({ field: "humanities", fit: "unrelated" });
  });
  it("adding a better-fitting field raises degree fit; fix texts use that field", () => {
    const one = scoreProfile(ex, answers(["humanities"]), 1, NOW);
    const two = scoreProfile(ex, answers(["humanities", "cs_ai"]), 1, NOW);
    expect(one.categories[1].earned).toBe(3);
    expect(two.categories[1].earned).toBe(15);
    expect(two.primaryField).toBe("cs_ai");
  });
  it("one field in the new form scores exactly like the legacy form", () => {
    const legacy = scoreProfile(ex, { ...answers(["cs_ai"]), targetFields: undefined, targetField: "cs_ai" }, 1, NOW);
    expect(scoreProfile(ex, answers(["cs_ai"]), 1, NOW)).toEqual(legacy);
  });
});

describe("programme matching across fields", () => {
  const fieldsOf = (id: string) => all.find((p) => p.id === id)!.fields;

  it("1 field: same as the single-field call", () => {
    expect(matchProgrammes(all, ["data_science"], "cs_ai", "COMPETITIVE")).toEqual(
      matchProgrammes(all, "data_science", "cs_ai", "COMPETITIVE")
    );
  });
  it("2 fields: each field gets at least one programme", () => {
    const r = matchProgrammes(all, ["public_health", "media_comm"], "other", "COMPETITIVE");
    expect(r).toHaveLength(3);
    expect(new Set(r.map((p) => p.id)).size).toBe(3);
    expect(r.some((p) => fieldsOf(p.id).includes("public_health"))).toBe(true);
    expect(r.some((p) => fieldsOf(p.id).includes("media_comm"))).toBe(true);
  });
  it("3 fields: one programme per field, in selection order, and `why` names the field", () => {
    const fields: FieldId[] = ["energy", "humanities", "agri_food"];
    const r = matchProgrammes(all, fields, "other", "NEEDS_WORK");
    expect(r).toHaveLength(3);
    fields.forEach((f, i) => expect(fieldsOf(r[i].id)).toContain(f));
    expect(r[1].why).toMatch(/Humanities, Languages & Heritage/);
  });
  it("is deterministic", () => {
    const f: FieldId[] = ["cs_ai", "biotech_life", "econ_business"];
    expect(matchProgrammes(all, f, "cs_ai", "STRONG")).toEqual(matchProgrammes(all, f, "cs_ai", "STRONG"));
  });
});
