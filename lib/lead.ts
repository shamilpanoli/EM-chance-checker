import type { Lead } from "@/lib/schema";
import type { FullReport } from "@/lib/report";
import type { ScoreResult } from "@/lib/scoring";

/** Builds the n8n payload (score summary only, never the resume text). */
export function buildLeadPayload(
  lead: Lead,
  report: FullReport,
  facts: ScoreResult["facts"],
  targetFields: string[],
  intakeYear: number
) {
  const cat = Object.fromEntries(report.categories.map((c) => [c.id, c.earned]));
  return {
    lead,
    score: report.total,
    band: report.band,
    crmPriority: report.crmPriority,
    targetField: targetFields[0], // primary = first selected (unchanged column for older sheets)
    targetFields: targetFields.join(","), // all chosen field ids, comma-separated
    intakeYear,
    categories: {
      academics: cat.academics,
      degreeFit: cat.degreeFit,
      work: cat.work,
      research: cat.research,
      projects: cat.projects,
      english: cat.english,
      leadership: cat.leadership,
      resumeQuality: cat.resumeQuality,
    },
    extractedSummary: {
      degreeSubject: String(facts.bachelorSubject ?? ""),
      monthsRelevantWork: Number(facts.relevantMonths ?? 0),
      publications: Number(facts.publications ?? 0),
    },
  };
}

/** Sends the lead to the n8n webhook (which appends to Google Sheets). Never blocks the student if n8n is down. */
export async function sendLead(payload: unknown) {
  const url = process.env.N8N_LEAD_WEBHOOK_URL;
  if (!url) {
    console.warn("[lead] N8N_LEAD_WEBHOOK_URL not set; lead not forwarded");
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Webhook-Secret": process.env.N8N_WEBHOOK_SECRET ?? "" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(`[lead] n8n responded ${res.status}`);
  } catch (e) {
    console.error("[lead] n8n unreachable:", e instanceof Error ? e.message : e);
  }
}
