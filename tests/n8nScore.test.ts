import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scoreViaN8n } from "@/lib/n8nScore";

const input = {
  text: "resume text",
  pageCount: 1,
  answers: { cgpa: 8.4, cgpaScale: "10", englishType: "IELTS", englishScore: 7, targetField: "cs", intakeYear: 2027 },
  lead: { name: "Test", email: "t@example.com", phone: "+91 9876543210", consent: true },
} as unknown as Parameters<typeof scoreViaN8n>[0];

const goodReport = {
  total: 62,
  band: "COMPETITIVE",
  bandLabel: "Competitive",
  message: "Good base.",
  crmPriority: "HOT",
  categories: [{ id: "academics", label: "Academics", earned: 20, max: 25, reasons: ["CGPA 8.4"] }],
  gaps: [{ category: "research", label: "Research", shortfall: 8, hard: false, fix: "Publish." }],
  targetFieldLabel: "Computer Science",
};

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("scoreViaN8n", () => {
  beforeEach(() => {
    process.env.N8N_SCORE_WEBHOOK_URL = "https://n8n.test/webhook/em-score";
    process.env.N8N_WEBHOOK_SECRET = "s3cret";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.N8N_SCORE_WEBHOOK_URL;
  });

  it("returns null when the webhook URL is not set", async () => {
    delete process.env.N8N_SCORE_WEBHOOK_URL;
    const f = vi.spyOn(globalThis, "fetch");
    expect((await scoreViaN8n(input)).report).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns a valid report and sends the secret header", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ report: goodReport }));
    const r = (await scoreViaN8n(input)).report;
    expect(r?.total).toBe(62);
    expect(r?.programmes).toEqual([]); // filled in by the route
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Webhook-Secret"]).toBe("s3cret");
    expect(JSON.parse(String(init.body))).toMatchObject({ text: "resume text", pageCount: 1 });
  });

  it("returns null on a non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 403 }));
    expect(await scoreViaN8n(input)).toEqual({ report: null, reason: "HTTP 403 wrong webhook secret" });
  });

  it("returns null on an invalid report shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ report: { ...goodReport, band: "AMAZING" } }));
    expect((await scoreViaN8n(input)).report).toBeNull();
  });

  it("flags an UNREADABLE_FILE reply from n8n (any status)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "UNREADABLE_FILE" } }), { status: 422 })
    );
    expect(await scoreViaN8n(input)).toMatchObject({ report: null, unreadable: true });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ error: { code: "UNREADABLE_FILE" } }));
    expect(await scoreViaN8n(input)).toMatchObject({ report: null, unreadable: true });
  });

  it("returns null on a network error or timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    expect(await scoreViaN8n(input)).toEqual({ report: null, reason: "timeout" });
  });
});
