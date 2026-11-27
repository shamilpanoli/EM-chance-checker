/**
 * ALL scoring weights, thresholds, bands and fix templates live here.
 * This is our internal heuristic (from the brief), not an official Erasmus Mundus formula.
 * Tune numbers here; lib/scoring.ts contains only logic.
 */

export const FIELDS = [
  { id: "cs_ai", label: "Computer Science & AI" },
  { id: "data_science", label: "Data Science & Analytics" },
  { id: "electrical", label: "Electrical & Electronics" },
  { id: "mechanical_robotics", label: "Mechanical, Aerospace & Robotics" },
  { id: "civil_env", label: "Civil & Environmental Engineering" },
  { id: "energy", label: "Energy & Sustainability" },
  { id: "physics", label: "Physics & Photonics" },
  { id: "chemistry_materials", label: "Chemistry & Materials" },
  { id: "biotech_life", label: "Biotechnology & Life Sciences" },
  { id: "public_health", label: "Public Health & Medicine" },
  { id: "agri_food", label: "Agriculture, Food & Forestry" },
  { id: "econ_business", label: "Economics, Business & Law" },
  { id: "social_policy", label: "Social Sciences & Public Policy" },
  { id: "education", label: "Education" },
  { id: "humanities", label: "Humanities, Languages & Heritage" },
  { id: "media_comm", label: "Media & Communication" },
] as const;

export type FieldId = (typeof FIELDS)[number]["id"];
export const FIELD_IDS = FIELDS.map((f) => f.id) as [FieldId, ...FieldId[]];
export const fieldLabel = (id: string) => FIELDS.find((f) => f.id === id)?.label ?? id;

/** Degree fit: which bachelor's fields count as "related" to each target field. Same field = direct. */
export const RELATED_FIELDS: Record<FieldId, FieldId[]> = {
  cs_ai: ["data_science", "electrical", "physics"],
  data_science: ["cs_ai", "electrical", "physics", "econ_business"],
  electrical: ["cs_ai", "physics", "mechanical_robotics", "energy"],
  mechanical_robotics: ["electrical", "civil_env", "energy", "physics", "cs_ai"],
  civil_env: ["mechanical_robotics", "energy", "agri_food", "chemistry_materials"],
  energy: ["electrical", "mechanical_robotics", "civil_env", "physics", "chemistry_materials"],
  physics: ["electrical", "chemistry_materials", "energy", "cs_ai"],
  chemistry_materials: ["physics", "biotech_life", "energy", "mechanical_robotics"],
  biotech_life: ["chemistry_materials", "public_health", "agri_food"],
  public_health: ["biotech_life", "social_policy", "data_science"],
  agri_food: ["biotech_life", "civil_env", "chemistry_materials"],
  econ_business: ["social_policy", "data_science"],
  social_policy: ["econ_business", "education", "humanities", "media_comm", "public_health"],
  education: ["social_policy", "humanities"],
  humanities: ["social_policy", "media_comm", "education"],
  media_comm: ["humanities", "social_policy", "econ_business"],
};

export const CATEGORIES = [
  { id: "academics", label: "Academics", max: 30 },
  { id: "degreeFit", label: "Degree fit", max: 15 },
  { id: "work", label: "Work & internships", max: 15 },
  { id: "research", label: "Research", max: 10 },
  { id: "projects", label: "Projects & skills", max: 10 },
  { id: "english", label: "English", max: 10 },
  { id: "leadership", label: "Leadership & international", max: 5 },
  { id: "resumeQuality", label: "Resume quality", max: 5 },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const SCORING = {
  academics: {
    // [minimum percentage, points], checked top-down
    tiers: [
      [85, 30],
      [75, 24],
      [65, 16],
      [55, 8],
    ] as [number, number][],
    floorPoints: 2,
    backlogPenalty: 4,
    // How CGPA scales convert to a percentage
    scaleToPercent: { "10": 10, "4": 25, "100": 1 } as Record<"10" | "4" | "100", number>,
  },
  degreeFit: { direct: 15, related: 9, unrelated: 3 },
  work: {
    // [minimum effective months, points]
    tiers: [
      [24, 15],
      [12, 11],
      [6, 7],
      [1, 4],
    ] as [number, number][],
    unrelatedWeight: 0.5,
  },
  research: { publication: 10, thesisOrProject: 6, none: 0 },
  projects: { perProject: 2, max: 10 },
  english: {
    ielts: [
      [7.0, 10],
      [6.5, 7],
      [6.0, 4],
    ] as [number, number][],
    toefl: [
      [100, 10],
      [90, 7],
      [80, 4],
    ] as [number, number][],
  },
  leadership: {
    points: { club_lead: 2, exchange: 2, volunteering: 1, other: 1 } as Record<
      "club_lead" | "exchange" | "volunteering" | "other",
      number
    >,
    perForeignLanguage: 1,
    max: 5,
  },
  resumeQuality: { maxPages: 2, pointPerCheck: 1 },
} as const;

export const BANDS = [
  { id: "STRONG", min: 80, label: "Strong", message: "Competitive for scholarship rounds.", crm: "HOT" },
  { id: "COMPETITIVE", min: 60, label: "Competitive", message: "Good base; fix the top gaps before applying.", crm: "HOT" },
  { id: "NEEDS_WORK", min: 40, label: "Needs work", message: "Apply only after strengthening 2–3 areas.", crm: "WARM" },
  { id: "NOT_READY", min: 0, label: "Not ready yet", message: "Build the profile first; target a later intake.", crm: "COLD" },
] as const;

export type BandId = (typeof BANDS)[number]["id"];

/** Order used to break ties when two categories have the same shortfall (keeps results stable). */
export const GAP_TIE_BREAK: CategoryId[] = [
  "english",
  "academics",
  "research",
  "work",
  "degreeFit",
  "projects",
  "leadership",
  "resumeQuality",
];

export const GAP_COUNT = 3;

/**
 * Fix templates per category. Placeholders: {earned} {max} {field} {months} {projects} {pct}
 * Each category picks the first template whose condition matches (see lib/scoring.ts).
 */
export const FIX_TEMPLATES: Record<CategoryId, string> = {
  academics:
    "Your CGPA works out to {pct}%, worth {earned}/{max} points. Highlight strong final-year grades, relevant coursework and class rank, and avoid adding backlogs; if you're still studying, aim to push your aggregate above the next band.",
  degreeFit:
    "Your bachelor's is only loosely linked to {field} ({earned}/{max} points). Add 1–2 courses, MOOCs or certifications in {field} and explain the switch clearly in your motivation letter.",
  work:
    "You have about {months} months of relevant experience ({earned}/{max} points). Add an internship or job in {field}; 12+ relevant months moves you up two tiers.",
  research:
    "Add 1 research project or thesis in {field}; you have {earned} research points. A conference paper or publication would earn the full {max}.",
  projects:
    "You have {projects} substantial {field} project(s) ({earned}/{max} points). Add {needed} more hands-on project(s) with a GitHub link or report and quantified results.",
  english:
    "English is a hard gap: you have {earned}/{max} points. Book IELTS (target 7.0+) or TOEFL iBT (target 100+); most EM programmes require a valid test score to apply.",
  leadership:
    "Leadership and international exposure scores {earned}/{max}. Lead a club or event, volunteer, or start a European language (A1/A2 certificate counts).",
  resumeQuality:
    "Your resume layout scores {earned}/{max}. Keep it to 2 pages, date every entry, quantify results, remove photo/DOB, and use Europass-style sections (Education, Experience, Skills, Languages).",
};
