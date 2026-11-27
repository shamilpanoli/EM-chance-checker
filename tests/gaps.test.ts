import { describe, expect, it, vi } from "vitest";
import type { Extracted, Answers } from "@/lib/schema";

const NOW = new Date("2026-11-27T00:00:00Z");

// A profile with a shortfall in every category.
const thin: Extracted = {
  education: [],
  bachelorSubject: "BA History",
  bachelorFieldId: "humanities",
  backlogsMentioned: false,
  jobs: [{ title: "Intern", organization: "X", start: "2025-01", end: "2025-03", isInternship: true, relevantToTargetField: true }],
  publications: [],
  researchProjects: [],
  projects: [{ title: "App", substantial: true, relevantToTargetField: true }],
  skills: [],
  leadership: [],
  languages: [],
  englishTest: null,
  resumeQuality: { hasDatedEntries: true, hasQuantifiedResults: false, hasPhotoOrDob: true, europassStyleSections: false },
};
const answers: Answers = { cgpa: 7.2, cgpaScale: "10", englishType: "IELTS", englishScore: 6.5, targetField: "cs_ai", intakeYear: 2027 };

describe("fix texts for all 8 categories", () => {
  it("each fix is specific and contains concrete numbers", async () => {
    vi.resetModules();
    vi.doMock("@/config/scoring", async (orig) => ({ ...(await orig<typeof import("@/config/scoring")>()), GAP_COUNT: 8 }));
    const { scoreProfile } = await import("@/lib/scoring");
    const r = scoreProfile(thin, answers, 3, NOW);
    expect(r.gaps.map((g) => g.category).sort()).toEqual(
      ["academics", "degreeFit", "english", "leadership", "projects", "research", "resumeQuality", "work"].sort()
    );
    for (const g of r.gaps) {
      expect(g.fix).toMatch(/\d/); // real numbers, e.g. "you have 0 research points"
      expect(g.fix).not.toMatch(/\{\w+\}/); // no unfilled placeholders
    }
    if (process.env.PRINT_FIXES) for (const g of r.gaps) console.log(`${g.label}: ${g.fix}`);
    vi.doUnmock("@/config/scoring");
  });
});

describe("gaps are the pure 3 largest shortfalls; English hard gap is a separate flag", () => {
  it("does not force English into the 3 gaps, but flags it", async () => {
    vi.resetModules();
    const { scoreProfile } = await import("@/lib/scoring");
    // Weak academics (28 short), unrelated degree (12 short), no work (15 short), no English test (10 short).
    const ex: Extracted = { ...thin, jobs: [], resumeQuality: { ...thin.resumeQuality, hasPhotoOrDob: false } };
    const a: Answers = { ...answers, cgpa: 5.0, englishType: "NONE", englishScore: null };
    const r = scoreProfile(ex, a, 1, NOW);
    expect(r.gaps.map((g) => g.category)).toEqual(["academics", "work", "degreeFit"]);
    expect(r.englishHardGap).toBe(true);
    expect(r.englishFix).toMatch(/IELTS/);
  });
  it("no flag when the student has a test", async () => {
    vi.resetModules();
    const { scoreProfile } = await import("@/lib/scoring");
    const r = scoreProfile(thin, answers, 1, NOW);
    expect(r.englishHardGap).toBe(false);
    expect(r.englishFix).toBeNull();
  });
});