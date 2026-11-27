import { z } from "zod";
import { BANDS, CATEGORIES } from "@/config/scoring";
import type { Answers, Lead } from "@/lib/schema";
import type { FullReport } from "@/lib/report";

const bandIds = BANDS.map((b) => b.id) as [string, ...string[]];
const categoryIds = CATEGORIES.map((c) => c.id) as [string, ...string[]];

/** The n8n scoring workflow must return the same shape as the built-in FullReport. */
export const N8nReportSchema = z.object({
  total: z.number().min(0).max(100),
  band: z.enum(bandIds),
  bandLabel: z.string().min(1),
  message: z.string(),
  crmPriority: z.enum(["HOT", "WARM", "COLD"]),
  categories: z
    .array(
      z.object({
        id: z.enum(categoryIds),
        label: z.string(),
        earned: z.number().min(0),
        max: z.number().positive(),
        reasons: z.array(z.string()).default([]),
      })
    )
    .min(1),
  gaps: z.array(
    z.object({
      category: z.enum(categoryIds),
      label: z.string(),
      shortfall: z.number(),
      hard: z.boolean().default(false),
      fix: z.string(),
    })
  ),
  programmes: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        acronym: z.string(),
        tag: z.enum(["Reach", "Match", "Safer"]),
        why: z.string(),
        url: z.string(),
      })
    )
    .optional()
    .default([]),
  targetFieldLabel: z.string(),
  englishHardGap: z.boolean().optional(),
  englishFix: z.string().nullable().optional(),
});

export type N8nInput = { text: string; pageCount: number; answers: Answers; lead: Lead };

export type N8nResult =
  | { report: FullReport; reason?: undefined; unreadable?: undefined }
  | { report: null; reason: string; unreadable?: boolean };

/** n8n may answer { error: { code: "UNREADABLE_FILE" } } (any status) when it can't read the text. */
const isUnreadable = (data: unknown) =>
  (data as { error?: { code?: unknown } } | null)?.error?.code === "UNREADABLE_FILE";

const STATUS_HINT: Record<number, string> = {
  401: "wrong webhook secret",
  403: "wrong webhook secret",
  404: "workflow not found or not active",
  500: "the n8n workflow hit an error",
};

/**
 * Sends the resume text + answers + lead to the n8n scoring workflow.
 * Never throws. On ANY problem (not configured, network, timeout, non-200, bad shape) it returns
 * `{ report: null, reason }` with a short, student-safe reason so the caller can fall back or explain.
 */
export async function scoreViaN8n(input: N8nInput, timeoutMs = 25000): Promise<N8nResult> {
  const url = process.env.N8N_SCORE_WEBHOOK_URL;
  if (!url) {
    console.warn("[n8n-score] N8N_SCORE_WEBHOOK_URL not set; using built-in scoring");
    return { report: null, reason: "n8n scoring is not set up" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Webhook-Secret": process.env.N8N_WEBHOOK_SECRET ?? "" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      let parsedBody: unknown = null;
      try {
        parsedBody = JSON.parse(body);
      } catch {}
      if (isUnreadable(parsedBody)) return { report: null, reason: "unreadable file", unreadable: true };
      // Log only the status and n8n's error code/message, never the raw body (it could echo resume text).
      const e = (parsedBody as { code?: unknown; message?: unknown; error?: { code?: unknown } } | null) ?? {};
      const code = String(e.error?.code ?? e.code ?? "");
      const msg = typeof e.message === "string" ? e.message.slice(0, 120) : "";
      console.error(`[n8n-score] n8n responded ${res.status}${code ? ` code=${code}` : ""}${msg ? `: ${msg}` : ""}`);
      return { report: null, reason: `HTTP ${res.status}${STATUS_HINT[res.status] ? ` ${STATUS_HINT[res.status]}` : ""}` };
    }
    const data = (await res.json().catch(() => null)) as { report?: unknown } | null;
    if (isUnreadable(data)) return { report: null, reason: "unreadable file", unreadable: true };
    const parsed = N8nReportSchema.safeParse(data?.report);
    if (!parsed.success) {
      console.error("[n8n-score] invalid report shape:", parsed.error.issues[0]?.path.join("."), parsed.error.issues[0]?.message);
      return { report: null, reason: "invalid response from n8n" };
    }
    return { report: parsed.data as FullReport };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    console.error("[n8n-score] n8n unreachable:", e instanceof Error ? `${e.name}: ${e.message}` : e);
    return { report: null, reason: timedOut ? "timeout" : "network error" };
  }
}
