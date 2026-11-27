import { z } from "zod";
import { FIELD_IDS, type FieldId } from "@/config/scoring";
import { NAME_MSG, checkEmail, checkFullPhone } from "@/lib/leadRules";

/** What the LLM returns from one extraction call. Scoring never asks the LLM for points, only facts. */
export const ExtractedSchema = z.object({
  education: z.array(
    z.object({
      degree: z.string().describe("e.g. B.Tech, B.Sc, BA, M.Sc, 12th"),
      subject: z.string(),
      institution: z.string(),
      endYear: z.number().int().nullable(),
      cgpa: z.number().nullable().describe("Grade as written, or null"),
      cgpaScale: z.enum(["10", "4", "100"]).nullable(),
    })
  ),
  bachelorSubject: z.string().nullable().describe("Subject of the bachelor's degree, or null"),
  bachelorFieldId: z
    .enum([...FIELD_IDS, "other"])
    .describe("Which field id best matches the bachelor's subject"),
  backlogsMentioned: z.boolean().describe("True only if the resume mentions backlogs / arrears / failed subjects"),
  jobs: z.array(
    z.object({
      title: z.string(),
      organization: z.string(),
      start: z.string().describe("YYYY-MM, or YYYY-01 if only the year is known"),
      end: z.string().describe("YYYY-MM, or 'present'"),
      isInternship: z.boolean(),
      relevantToTargetField: z.boolean(),
    })
  ),
  publications: z.array(
    z.object({ title: z.string(), type: z.enum(["journal", "conference", "preprint", "other"]) })
  ),
  researchProjects: z.array(
    z.object({ title: z.string(), isThesis: z.boolean() })
  ),
  projects: z.array(
    z.object({
      title: z.string(),
      substantial: z.boolean().describe("A real build/analysis with clear scope, not a one-line course exercise"),
      relevantToTargetField: z.boolean(),
    })
  ),
  skills: z.array(z.string()),
  leadership: z.array(
    z.object({
      description: z.string(),
      type: z.enum(["club_lead", "volunteering", "exchange", "other"]),
    })
  ),
  languages: z.array(
    z.object({
      name: z.string(),
      isForeignLanguage: z
        .boolean()
        .describe("True for languages other than English and the candidate's native/Indian regional languages, e.g. German, French"),
    })
  ),
  englishTest: z
    .object({ type: z.enum(["IELTS", "TOEFL"]), score: z.number() })
    .nullable(),
  resumeQuality: z.object({
    hasDatedEntries: z.boolean(),
    hasQuantifiedResults: z.boolean(),
    hasPhotoOrDob: z.boolean(),
    europassStyleSections: z.boolean().describe("Clear standard sections: Education, Experience, Skills, Languages"),
  }),
});

export type Extracted = z.infer<typeof ExtractedSchema>;

export const AnswersSchema = z
  .object({
    cgpa: z.coerce.number().positive(),
    cgpaScale: z.enum(["10", "4", "100"]),
    englishType: z.enum(["IELTS", "TOEFL", "NONE"]),
    englishScore: z.coerce.number().nonnegative().optional().nullable(),
    // 1–3 target fields in selection order. The legacy single `targetField` is still accepted.
    targetFields: z.array(z.enum(FIELD_IDS)).optional(),
    targetField: z.enum(FIELD_IDS).optional(),
    intakeYear: z.coerce.number().int().min(2025).max(2035),
  })
  .superRefine((a, ctx) => {
    const fields = a.targetFields?.length ? a.targetFields : a.targetField ? [a.targetField] : [];
    if (fields.length < 1) ctx.addIssue({ code: "custom", path: ["targetFields"], message: "Choose at least 1 field" });
    if (fields.length > 3) ctx.addIssue({ code: "custom", path: ["targetFields"], message: "Choose up to 3 fields" });
    if (new Set(fields).size !== fields.length)
      ctx.addIssue({ code: "custom", path: ["targetFields"], message: "Each field can only be chosen once" });
    const max = { "10": 10, "4": 4, "100": 100 }[a.cgpaScale];
    if (a.cgpa > max) ctx.addIssue({ code: "custom", path: ["cgpa"], message: `CGPA can't be above ${max}` });
    if (a.englishType === "IELTS" && (a.englishScore == null || a.englishScore > 9))
      ctx.addIssue({ code: "custom", path: ["englishScore"], message: "Enter an IELTS band from 0 to 9" });
    if (a.englishType === "TOEFL" && (a.englishScore == null || a.englishScore > 120))
      ctx.addIssue({ code: "custom", path: ["englishScore"], message: "Enter a TOEFL score from 0 to 120" });
  });

/** Normalised: `targetFields` always set (1–3, selection order) and `targetField` = the first one. */
export const AnswersInputSchema = AnswersSchema.transform((a) => {
  const targetFields = (a.targetFields?.length ? a.targetFields : [a.targetField!]) as FieldId[];
  return { ...a, targetFields, targetField: targetFields[0] };
});

type AnswersBase = Omit<z.infer<typeof AnswersSchema>, "targetFields" | "targetField">;
/** Either form is accepted by the scoring code; use `chosenFields()` to read the list. */
export type Answers = AnswersBase &
  ({ targetFields: FieldId[]; targetField?: FieldId } | { targetField: FieldId; targetFields?: FieldId[] });

/** The chosen target fields in selection order (handles the legacy single-field form). */
export const chosenFields = (a: Pick<Answers, "targetFields" | "targetField">): FieldId[] =>
  a.targetFields?.length ? a.targetFields : [a.targetField as FieldId];

/** Same rules as the About you step (lib/leadRules.ts). Outputs normalised phone and lowercased email. */
export const LeadSchema = z.object({
  name: z.string().trim().min(2, NAME_MSG).max(100),
  email: z.string().transform((v, ctx) => {
    const r = checkEmail(v);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.value;
  }),
  phone: z.string().transform((v, ctx) => {
    const r = checkFullPhone(v);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.value;
  }),
  consent: z.literal(true, { message: "Please tick the consent box" }),
});

export type Lead = z.infer<typeof LeadSchema>;
