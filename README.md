# Erasmus Mundus Profile Scorer

A free, mobile-first tool for Indian students applying to Erasmus Mundus Joint Masters. Students leave their name, phone/WhatsApp and email, upload a resume (PDF/DOCX) and answer 4 quick questions. They get a readiness score out of 100 with a band, a category breakdown, their top 3 gaps with concrete fixes, and 3 matching EM programmes. Leads go to Google Sheets via an n8n webhook.

## Setup

```bash
npm install
cp .env.example .env.local   # add the values below
npm run dev                  # http://localhost:3000
npm test                     # unit tests (rubric, acceptance cases, matching, validation)
npm run build                # production build
```

Deploy: push to GitHub, import the repo in Vercel, add the env vars below under **Project → Settings → Environment Variables**, deploy.

## Environment variables (all secrets are server-only; only `NEXT_PUBLIC_SHOW_ENGINE_TOGGLE` reaches the browser)

| Name | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | **yes** | Claude API key for resume extraction (Built-in engine, and fallback for n8n mode) |
| `N8N_LEAD_WEBHOOK_URL` | optional | n8n webhook that appends leads to Google Sheets. Unset = leads are not forwarded (logged) |
| `N8N_WEBHOOK_SECRET` | optional | Sent as `X-Webhook-Secret` to both n8n webhooks |
| `N8N_SCORE_WEBHOOK_URL` | optional | n8n scoring workflow for the "n8n" engine. Receives `{ text, pageCount, answers, lead }`, returns `{ report }` in the built-in report shape. Unset = always Built-in |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | recommended | Shared rate limit + extraction cache across Vercel instances (Vercel → Storage → Upstash) |
| `NEXT_PUBLIC_SHOW_ENGINE_TOGGLE` | optional | Set to `false` to hide the reviewer Built-in / n8n switch and its info button (then always Built-in). Shown by default. Public by design (not a secret) |
| `RATE_LIMIT_PER_HOUR` | optional | New scorings per IP per hour. Default `5`; `0` = no limit |

n8n mode is optional; the default Built-in mode calls Claude directly, and the Anthropic key lives only in Vercel environment variables.

## Architecture

1. **Lead-first flow** (`components/Scorer.tsx`): About you → upload → 4 questions (CGPA, English, 1–3 target fields, intake) → scoring → full report. Lead, file and answers stay in memory, so every error can be retried without re-uploading.
2. `POST /api/score` validates the lead first (403 without it, so the report can't be reached around the form), then checks type/size and extracts text in memory (`unpdf` / `mammoth`). Image-only PDFs get "We couldn't read text from this file. Upload a text PDF or DOCX."
3. **Built-in engine** (default): one Claude call (`lib/extract.ts`) returns facts as JSON validated by Zod (`lib/schema.ts`); results are cached by `sha256(fields + text)`.
4. `lib/scoring.ts` scores the facts with the rubric in **`config/scoring.ts`** (weights, bands, fix templates). Typed CGPA/English override the resume. Pure and deterministic.
5. `lib/match.ts` picks 3 programmes (at least one per chosen field) from `data/programmes.json`.
6. The lead + score summary go to n8n → Google Sheets (`lib/lead.ts`, never blocks the student), then the report is returned.
7. **Engine toggle** (top of the page, default Built-in): "n8n" sends text + answers + lead to `N8N_SCORE_WEBHOOK_URL` (`lib/n8nScore.ts`, 25 s timeout, Zod-validated reply). On any n8n failure the site falls back to Built-in; the result page says which engine scored it.

## How matching works

`lib/match.ts` picks 3 programmes from `data/programmes.json` (58 Erasmus Mundus programmes, each tagged with up to a few fields and **our own** competitiveness estimate: 1 = less competitive, 2 = moderate, 3 = highly competitive). For each chosen target field, every programme gets points:

- **+10** if the chosen field is the programme's main field, **+7** if it is one of its other fields, **+2** if the programme only covers a related field (see `RELATED_FIELDS` in `config/scoring.ts`).
- **+3** if the programme also covers the student's bachelor's field.
- **−1.5 × distance** between the programme's competitiveness and the **target level set by the score band**: Strong → 3, Competitive → 2.5, Needs work → 1.5, Not ready → 1.
- Programmes scoring 0 or less are dropped. Ties break by programme id, so results are deterministic.
- With 2–3 fields, each field first gets its best programme (in the order the student picked them); remaining slots go to the best scores across all fields.
- Tag: **Reach** if competitiveness is more than 0.4 above the target level, **Safer** if more than 0.4 below, otherwise **Match**.

**How research and work feed in.** Research (10 points), work and internships (15), projects (10) and leadership (5) are scored categories alongside academics (30), degree fit (15), English (10) and resume quality (5). They set the total score and band, and the band sets which competitiveness tier is targeted. They do not change matching directly.

**Context from the recruiter.** Erasmus Mundus selection primarily values research papers, experience at large or reputable institutions, and genuine motivation for the specific programme. Overall admission rates are roughly 2–3%, so even a Strong score is not a guarantee.

**Next steps (honest limits).**
- Weight research output and big-institution experience directly in matching, not only through the band.
- Add a short motivation / "why this programme" question.
- Reflect the ~2–3% base rate in the band messages.
- Replace our competitiveness estimates with official programme data (intake sizes, admission statistics).
## Model choice

`claude-haiku-5-5`, structured JSON output, thinking off, effort `low`. Extraction is a simple, well-specified task, so the smallest current model is fast (scoring well under 30 s) and very cheap. The model only reports **facts** (dates, subjects, projects, publications) and never assigns points; scoring is deterministic code, so the same resume always gets the same score.

## Cost per resume

About 3–5k input tokens and 1–1.5k output tokens per new resume. At $0.10 / 1M input and $0.50 / 1M output that is **≈ $0.001 per resume** (≈ ₹0.1). Repeat resumes come from the cache for free. Vercel Hobby + Upstash free tier cover hosting at low volume.

## Privacy

The file and its full text are never written to disk, cache, logs or the lead sheet. Only extracted fields (cache) and a score summary (lead) are stored. In **n8n mode** the resume text is sent to n8n: turn off execution-data saving for that workflow (Settings → *Save successful/failed production executions* = Do not save).

## Known limitations

- Upload limit is **4.5 MB**, not 5 MB: Vercel functions cap request bodies at 4.5 MB.
- Flow is **lead-first** (details before upload), which differs from the brief's upload-first order; the report is never shown without a lead.
- Without Upstash, the rate limit and cache are in-memory per server instance. The rate limit counts only new (uncached) resumes.
- Work relevance, project "substantial", and the bachelor's field are LLM judgements; borderline resumes can land in a different tier than a human would choose.
- DOCX has no page count; it is estimated at ~550 words per page. Very long resumes are cut at 60,000 characters.
- Gaps are the 3 largest shortfalls. A missing English test (English = 0) is shown separately as an "English test required" banner (`englishHardGap` / `englishFix` in the API), not forced into the 3 gaps.
- n8n mode sends the resume text to n8n (see Privacy). The programme list is a curated set of 58 EM programmes; check availability per intake.
