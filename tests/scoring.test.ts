import { describe, expect, it } from "vitest";
import { scoreProfile, monthsBetween } from "@/lib/scoring";
import { matchProgrammes } from "@/lib/match";
import programmes from "@/data/programmes.json";
import type { Extracted, Answers } from "@/lib/schema";
import type { Programme } from "@/lib/programmes/source";

const NOW = new Date("2026-11-27T00:00:00Z");

const base: Extracted = {
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

const strong: Extracted = {
  ...base,
  education: [{ degree: "B.Tech", subject: "Computer Science", institution: "X", endYear: 2024, cgpa: 9.1, cgpaScale: "10" }],
  jobs: [{ title: "ML Engineer", organization: "Y", start: "2024-07", end: "2025-12", isInternship: false, relevantToTargetField: true }],
  publications: [{ title: "Paper", type: "conference" }],
  projects: [
    { title: "A", substantial: true, relevantToTargetField: true },
    { title: "B", substantial: true, relevantToTargetField: true },
  ],
  leadership: [{ description: "Led coding club", type: "club_lead" }],
  resumeQuality: { hasDatedEntries: true, hasQuantifiedResults: true, hasPhotoOrDob: false, europassStyleSections: true },
};
const strongAnswers: Answers = { cgpa: 9.1, cgpaScale: "10", englishType: "IELTS", englishScore: 7.5, targetField: "cs_ai", intakeYear: 2027 };

const weak: Extracted = { ...base, bachelorSubject: "B.Com", bachelorFieldId: "econ_business" };
const weakAnswers: Answers = { cgpa: 6.0, cgpaScale: "10", englishType: "NONE", englishScore: null, targetField: "cs_ai", intakeYear: 2027 };

describe("acceptance-style scoring", () => {
  it("test 2: strong profile scores 80+ and band Strong", () => {
    const r = scoreProfile(strong, strongAnswers, 2, NOW);
    expect(r.total).toBeGreaterThanOrEqual(80);
    expect(r.band).toBe("STRONG");
    expect(r.crmPriority).toBe("HOT");
    expect(r.categories.find((c) => c.id === "work")!.earned).toBe(11); // 18 months
  });

  it("test 3: weak profile scores under 40 with English flagged as a gap", () => {
    const r = scoreProfile(weak, weakAnswers, 1, NOW);
    expect(r.total).toBeLessThan(40);
    expect(r.band).toBe("NOT_READY");
    const eng = r.gaps.find((g) => g.category === "english");
    expect(eng?.hard).toBe(true);
    expect(r.gaps).toHaveLength(3);
  });

  it("test 6: typed CGPA overrides resume CGPA", () => {
    const resumeSays: Extracted = { ...strong, education: [{ ...strong.education[0], cgpa: 6.0 }] };
    const r = scoreProfile(resumeSays, strongAnswers, 2, NOW);
    expect(r.categories.find((c) => c.id === "academics")!.earned).toBe(30);
  });

  it("typed English score overrides resume English score", () => {
    const r = scoreProfile({ ...strong, englishTest: { type: "IELTS", score: 5.5 } }, strongAnswers, 2, NOW);
    expect(r.categories.find((c) => c.id === "english")!.earned).toBe(10);
  });

  it("test 1: identical input gives identical output", () => {
    const a = scoreProfile(strong, strongAnswers, 2, NOW);
    const b = scoreProfile(strong, strongAnswers, 2, NOW);
    expect(a).toEqual(b);
  });
});

describe("rubric details", () => {
  it("CGPA scales and backlog penalty", () => {
    const four = scoreProfile(base, { ...weakAnswers, cgpa: 3.5, cgpaScale: "4" }, 1, NOW); // 87.5%
    expect(four.categories[0].earned).toBe(30);
    const pctBacklog = scoreProfile({ ...base, backlogsMentioned: true }, { ...weakAnswers, cgpa: 78, cgpaScale: "100" }, 1, NOW);
    expect(pctBacklog.categories[0].earned).toBe(20);
    const low = scoreProfile(base, { ...weakAnswers, cgpa: 5.0 }, 1, NOW);
    expect(low.categories[0].earned).toBe(2);
  });

  it("degree fit direct / related / unrelated", () => {
    expect(scoreProfile(base, strongAnswers, 1, NOW).categories[1].earned).toBe(15);
    expect(scoreProfile({ ...base, bachelorFieldId: "electrical" }, strongAnswers, 1, NOW).categories[1].earned).toBe(9);
    expect(scoreProfile({ ...base, bachelorFieldId: "humanities" }, strongAnswers, 1, NOW).categories[1].earned).toBe(3);
  });

  it("unrelated work counts half", () => {
    const ex = { ...base, jobs: [{ title: "Sales", organization: "Z", start: "2024-01", end: "2025-12", isInternship: false, relevantToTargetField: false }] };
    const r = scoreProfile(ex, strongAnswers, 1, NOW); // 24 months -> 12 effective
    expect(r.categories.find((c) => c.id === "work")!.earned).toBe(11);
  });

  it("english tiers", () => {
    const e = (t: "IELTS" | "TOEFL", s: number) =>
      scoreProfile(base, { ...strongAnswers, englishType: t, englishScore: s }, 1, NOW).categories.find((c) => c.id === "english")!.earned;
    expect(e("IELTS", 7)).toBe(10);
    expect(e("IELTS", 6.5)).toBe(7);
    expect(e("IELTS", 6)).toBe(4);
    expect(e("TOEFL", 95)).toBe(7);
    expect(e("TOEFL", 79)).toBe(0);
  });

  it("monthsBetween is inclusive and handles present", () => {
    expect(monthsBetween("2024-01", "2024-06", NOW)).toBe(6);
    expect(monthsBetween("2026-06", "present", NOW)).toBe(6);
  });
});

describe("programme matching", () => {
  it("returns 3 deterministic matches in the target field", () => {
    const a = matchProgrammes(programmes as Programme[], "data_science", "cs_ai", "COMPETITIVE");
    const b = matchProgrammes(programmes as Programme[], "data_science", "cs_ai", "COMPETITIVE");
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
  });
  it("every field gets 3 matches", () => {
    for (const f of ["cs_ai","data_science","electrical","mechanical_robotics","civil_env","energy","physics","chemistry_materials","biotech_life","public_health","agri_food","econ_business","social_policy","education","humanities","media_comm"] as const) {
      expect(matchProgrammes(programmes as Programme[], f, "other", "NOT_READY")).toHaveLength(3);
    }
  });
});
