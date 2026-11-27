import { createHash } from "node:crypto";
import { AnswersInputSchema, LeadSchema, type Extracted } from "@/lib/schema";
import { AppError, errorResponse } from "@/lib/errors";
import { parseResume } from "@/lib/parse";
import { extractResume, EXTRACTION_MODEL } from "@/lib/extract";
import { allowScoring, cacheGet, cacheSet, RATE_LIMIT_PER_HOUR } from "@/lib/store";
import { scoreProfile } from "@/lib/scoring";
import { matchProgrammes } from "@/lib/match";
import { getProgrammeSource } from "@/lib/programmes/source";
import { fieldLabel } from "@/config/scoring";
import type { FullReport } from "@/lib/report";
import { buildLeadPayload, sendLead } from "@/lib/lead";
import { scoreViaN8n } from "@/lib/n8nScore";

type Engine = "builtin" | "n8n" | "builtin-fallback";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError("VALIDATION", "Upload failed. Please try again.", 400, true);
    }
    // Lead gate: the report is only produced for students who left valid details (checked before any parsing).
    let leadRaw: unknown;
    try {
      leadRaw = JSON.parse(String(form.get("lead") ?? "null"));
    } catch {
      leadRaw = null;
    }
    const lead = LeadSchema.safeParse(leadRaw);
    if (!lead.success)
      throw new AppError(
        "LOCKED",
        leadRaw && typeof leadRaw === "object"
          ? (lead.error.issues[0]?.message ?? "Please check your details.")
          : "Please fill in your name, phone and email first.",
        403,
        false
      );

    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION", "Please choose your resume file.", 400, false);

    let answersRaw: unknown;
    try {
      answersRaw = JSON.parse(String(form.get("answers") ?? "{}"));
    } catch {
      answersRaw = {};
    }
    const parsedAnswers = AnswersInputSchema.safeParse(answersRaw);
    if (!parsedAnswers.success)
      throw new AppError("VALIDATION", "Please check your 4 answers (CGPA, English score, field, intake) and try again.", 400, false);
    // Normalised: answers.targetFields = 1–3 fields in selection order, answers.targetField = the first (primary).
    const answers = parsedAnswers.data;
    const fieldsLabel = answers.targetFields.map(fieldLabel).join(" + ");

    // 1. Text extraction (in memory only)
    const { text, pageCount } = await parseResume(file);

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const rateLimited = () =>
      new AppError("RATE_LIMITED", `You've reached the limit of ${RATE_LIMIT_PER_HOUR} scorings per hour. Please come back a little later.`, 429, false);
    let rateChecked = false;
    let engine: Engine = "builtin";

    // 2a. Optional n8n scoring engine. Any failure silently falls back to the built-in engine below.
    if (form.get("engine") === "n8n") {
      if (!(await allowScoring(ip))) throw rateLimited();
      rateChecked = true;
      const n8n = await scoreViaN8n({ text, pageCount, answers, lead: lead.data });
      const n8nReport = n8n.report;
      if (n8nReport) {
        n8nReport.targetFields ??= answers.targetFields;
        if (n8nReport.programmes.length === 0) {
          // n8n doesn't tell us the bachelor field, so match on the chosen fields (primary as the degree hint).
          n8nReport.programmes = matchProgrammes(
            await (await getProgrammeSource()).list(),
            answers.targetFields,
            answers.targetField,
            n8nReport.band
          );
        }
        // n8n saves the lead itself, so the em-lead webhook is not called.
        return Response.json({ report: n8nReport, engine: "n8n" satisfies Engine });
      }
      // n8n couldn't read the text: same exact message as the site's own parser, no fallback needed.
      if (n8n.unreadable)
        throw new AppError("UNREADABLE_FILE", "We couldn't read text from this file. Upload a text PDF or DOCX.", 422, false);
      // Fallback is impossible without a Claude key: say clearly why n8n failed instead of a vague error.
      if (!process.env.ANTHROPIC_API_KEY)
        throw process.env.N8N_SCORE_WEBHOOK_URL
          ? new AppError("N8N_UNAVAILABLE", `We couldn't reach the n8n scorer (${n8n.reason}). Please try again in a moment.`, 502, true)
          : new AppError("N8N_UNAVAILABLE", "n8n scoring isn't set up yet: add N8N_SCORE_WEBHOOK_URL to .env.local and restart.", 500, false);
      engine = "builtin-fallback";
    } else if (!process.env.ANTHROPIC_API_KEY) {
      throw new AppError("NO_API_KEY", "Built-in scoring needs a Claude API key. Switch to n8n or add ANTHROPIC_API_KEY.", 500, false);
    }

    // 2b. Built-in: structured extraction, cached by text hash + sorted fields so the same resume always scores the same.
    // (With one field the key is identical to before, so existing cache entries stay valid.)
    const cacheKey = createHash("sha256").update(`v1|${[...answers.targetFields].sort().join("+")}|${text}`).digest("hex");
    // The cached record = extracted fields + parser page count (never the resume text).
    let extracted = await cacheGet<Extracted & { pageCount?: number }>(cacheKey);
    if (!extracted) {
      if (!rateChecked && !(await allowScoring(ip))) throw rateLimited();
      const out = await extractResume(text, answers.targetFields);
      extracted = out.data;
      console.log(`[score] model=${EXTRACTION_MODEL} in=${out.usage.input} out=${out.usage.output}`);
      await cacheSet(cacheKey, { ...extracted, pageCount });
    }

    // 3. Deterministic scoring + matching
    const result = scoreProfile(extracted, answers, pageCount);
    const programmes = matchProgrammes(
      await (await getProgrammeSource()).list(),
      answers.targetFields,
      extracted.bachelorFieldId,
      result.band
    );

    const { facts, primaryField: _primary, ...rest } = result;
    const report: FullReport = { ...rest, programmes, targetFieldLabel: fieldsLabel, targetFields: answers.targetFields };

    await sendLead(buildLeadPayload(lead.data, report, facts, answers.targetFields, answers.intakeYear));

    // The resume text is discarded; only the report goes back to the student.
    return Response.json({ report, engine });
  } catch (e) {
    return errorResponse(e);
  }
}
