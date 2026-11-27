import {
  BANDS,
  CATEGORIES,
  FIX_TEMPLATES,
  GAP_COUNT,
  GAP_TIE_BREAK,
  RELATED_FIELDS,
  SCORING,
  fieldLabel,
  type BandId,
  type CategoryId,
  type FieldId,
} from "@/config/scoring";
import { chosenFields, type Answers, type Extracted } from "@/lib/schema";

export type CategoryScore = { id: CategoryId; label: string; earned: number; max: number; reasons: string[] };
export type Gap = { category: CategoryId; label: string; shortfall: number; hard: boolean; fix: string };
export type ScoreResult = {
  total: number;
  band: BandId;
  bandLabel: string;
  message: string;
  crmPriority: "HOT" | "WARM" | "COLD";
  categories: CategoryScore[];
  gaps: Gap[];
  facts: Record<string, number | string | boolean>;
  /** True when the student has no usable English test (English earns 0). Shown as a separate banner. */
  englishHardGap: boolean;
  /** Fix text for the English hard gap (null when there is none). */
  englishFix: string | null;
  /** The chosen field that gave the best degree fit (ties: first selected). Used for fix texts. */
  primaryField: FieldId;
};

type Fit = "direct" | "related" | "unrelated";
const FIT_RANK: Record<Fit, number> = { direct: 2, related: 1, unrelated: 0 };

export function degreeFitFor(bachelorField: FieldId | "other", field: FieldId): Fit {
  return bachelorField === field
    ? "direct"
    : bachelorField !== "other" && RELATED_FIELDS[field].includes(bachelorField as FieldId)
      ? "related"
      : "unrelated";
}

/** Best degree fit across the chosen fields; ties go to the field selected first. */
export function bestFit(bachelorField: FieldId | "other", fields: FieldId[]): { field: FieldId; fit: Fit } {
  let best = { field: fields[0], fit: degreeFitFor(bachelorField, fields[0]) };
  for (const f of fields.slice(1)) {
    const fit = degreeFitFor(bachelorField, f);
    if (FIT_RANK[fit] > FIT_RANK[best.fit]) best = { field: f, fit };
  }
  return best;
}

/** Pure, deterministic. `now` is injectable so "present" job end dates are testable. */
export function scoreProfile(
  ex: Extracted,
  answers: Answers,
  pageCount: number,
  now: Date = new Date()
): ScoreResult {
  const fields = chosenFields(answers);
  const cats: Record<CategoryId, CategoryScore> = Object.fromEntries(
    CATEGORIES.map((c) => [c.id, { id: c.id, label: c.label, earned: 0, max: c.max, reasons: [] as string[] }])
  ) as Record<CategoryId, CategoryScore>;

  // 1. Academics — typed CGPA always wins over the resume.
  const pct = round1(answers.cgpa * SCORING.academics.scaleToPercent[answers.cgpaScale]);
  let acad: number = SCORING.academics.floorPoints;
  for (const [min, pts] of SCORING.academics.tiers) if (pct >= min) { acad = pts; break; }
  cats.academics.reasons.push(`CGPA ${answers.cgpa}/${answers.cgpaScale === "100" ? "100%" : answers.cgpaScale} = ${pct}%`);
  if (ex.backlogsMentioned) {
    acad = Math.max(0, acad - SCORING.academics.backlogPenalty);
    cats.academics.reasons.push(`Backlogs mentioned: −${SCORING.academics.backlogPenalty}`);
  }
  cats.academics.earned = acad;

  // 2. Degree fit
  const { field, fit } = bestFit(ex.bachelorFieldId, fields);
  cats.degreeFit.earned = SCORING.degreeFit[fit];
  cats.degreeFit.reasons.push(
    `${ex.bachelorSubject ?? "Bachelor's subject"} vs ${fieldLabel(field)}: ${fit} match`
  );

  // 3. Work and internships
  let relevantMonths = 0;
  let unrelatedMonths = 0;
  for (const j of ex.jobs) {
    const m = monthsBetween(j.start, j.end, now);
    if (j.relevantToTargetField) relevantMonths += m;
    else unrelatedMonths += m;
  }
  const effMonths = Math.floor(relevantMonths + unrelatedMonths * SCORING.work.unrelatedWeight);
  let work = 0;
  for (const [min, pts] of SCORING.work.tiers) if (effMonths >= min) { work = pts; break; }
  cats.work.earned = work;
  cats.work.reasons.push(
    `${relevantMonths} relevant months + ${unrelatedMonths} unrelated (counted half) = ${effMonths} months`
  );

  // 4. Research
  const hasPub = ex.publications.length > 0;
  const hasResearch = ex.researchProjects.length > 0;
  cats.research.earned = hasPub
    ? SCORING.research.publication
    : hasResearch
      ? SCORING.research.thesisOrProject
      : SCORING.research.none;
  cats.research.reasons.push(
    hasPub ? `${ex.publications.length} publication(s)` : hasResearch ? "Thesis / research project" : "No research found"
  );

  // 5. Projects and skills
  const goodProjects = ex.projects.filter((p) => p.substantial && p.relevantToTargetField).length;
  cats.projects.earned = Math.min(SCORING.projects.max, goodProjects * SCORING.projects.perProject);
  cats.projects.reasons.push(`${goodProjects} substantial relevant project(s)`);

  // 6. English — typed score wins; resume score used only if the student typed none.
  const eng =
    answers.englishType !== "NONE" && answers.englishScore != null
      ? { type: answers.englishType, score: answers.englishScore }
      : ex.englishTest;
  let engPts = 0;
  if (eng) {
    const table = eng.type === "IELTS" ? SCORING.english.ielts : SCORING.english.toefl;
    for (const [min, pts] of table) if (eng.score >= min) { engPts = pts; break; }
    cats.english.reasons.push(`${eng.type} ${eng.score}`);
  } else {
    cats.english.reasons.push("No English test");
  }
  cats.english.earned = engPts;
  const englishHardGap = engPts === 0;

  // 7. Leadership and international exposure
  let lead = 0;
  for (const l of ex.leadership) lead += SCORING.leadership.points[l.type];
  const foreignLangs = ex.languages.filter((l) => l.isForeignLanguage).length;
  lead += foreignLangs * SCORING.leadership.perForeignLanguage;
  cats.leadership.earned = Math.min(SCORING.leadership.max, lead);
  cats.leadership.reasons.push(`${ex.leadership.length} activity(ies), ${foreignLangs} foreign language(s)`);

  // 8. Resume quality — page count comes from the parser, not the LLM.
  const q = ex.resumeQuality;
  const checks: [boolean, string][] = [
    [pageCount <= SCORING.resumeQuality.maxPages, `${pageCount} page(s)`],
    [q.hasDatedEntries, "dated entries"],
    [q.hasQuantifiedResults, "quantified results"],
    [!q.hasPhotoOrDob, "no photo/DOB"],
    [q.europassStyleSections, "Europass-style sections"],
  ];
  cats.resumeQuality.earned = checks.filter(([ok]) => ok).length * SCORING.resumeQuality.pointPerCheck;
  cats.resumeQuality.reasons.push(checks.map(([ok, l]) => `${ok ? "✓" : "✗"} ${l}`).join(", "));

  const categories = CATEGORIES.map((c) => cats[c.id]);
  const total = categories.reduce((s, c) => s + c.earned, 0);
  const band = BANDS.find((b) => total >= b.min)!;

  // Gaps: the 3 largest shortfalls, stable tie-break. A missing English test is flagged separately (englishHardGap).
  const vars = {
    field: fieldLabel(field),
    months: String(effMonths),
    projects: String(goodProjects),
    needed: String(Math.max(1, Math.ceil((SCORING.projects.max - cats.projects.earned) / SCORING.projects.perProject))),
    pct: String(pct),
  };
  const ranked = [...categories]
    .map((c) => ({ c, shortfall: c.max - c.earned }))
    .filter((x) => x.shortfall > 0)
    .sort((a, b) => b.shortfall - a.shortfall || GAP_TIE_BREAK.indexOf(a.c.id) - GAP_TIE_BREAK.indexOf(b.c.id));
  const picked = ranked.slice(0, GAP_COUNT);
  const gaps: Gap[] = picked.map(({ c, shortfall }) => ({
    category: c.id,
    label: c.label,
    shortfall,
    hard: c.id === "english" && englishHardGap,
    fix: fillTemplate(
      c.id === "english" && !englishHardGap
        ? "Your English score earns {earned}/{max}. Retake to reach IELTS 7.0+ or TOEFL 100+ for full points; many EM programmes rank applicants on it."
        : FIX_TEMPLATES[c.id],
      { ...vars, earned: String(c.earned), max: String(c.max) }
    ),
  }));

  return {
    total,
    band: band.id,
    bandLabel: band.label,
    message: band.message,
    crmPriority: band.crm,
    categories,
    gaps,
    englishHardGap,
    englishFix: englishHardGap
      ? fillTemplate(FIX_TEMPLATES.english, { ...vars, earned: String(cats.english.earned), max: String(cats.english.max) })
      : null,
    primaryField: field,
    facts: {
      cgpaPercent: pct,
      bachelorSubject: ex.bachelorSubject ?? "",
      degreeFit: fit,
      relevantMonths,
      unrelatedMonths,
      publications: ex.publications.length,
      substantialProjects: goodProjects,
      englishTest: eng ? `${eng.type} ${eng.score}` : "none",
    },
  };
}

export function monthsBetween(start: string, end: string, now: Date): number {
  const s = parseYm(start);
  const e = end.trim().toLowerCase() === "present" ? { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 } : parseYm(end);
  if (!s || !e) return 0;
  const diff = (e.y - s.y) * 12 + (e.m - s.m) + 1; // inclusive of start month
  return Math.max(0, Math.min(diff, 600));
}

function parseYm(v: string): { y: number; m: number } | null {
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(v.trim());
  if (!m) return null;
  return { y: Number(m[1]), m: m[2] ? Math.min(12, Math.max(1, Number(m[2]))) : 1 };
}

function fillTemplate(t: string, vars: Record<string, string>) {
  return t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

const round1 = (n: number) => Math.round(n * 10) / 10;
