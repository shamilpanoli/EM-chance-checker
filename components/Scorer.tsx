"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FIELDS } from "@/config/scoring";
import { ACCEPTED_EXT, ACCEPTED_MIME, MAX_FILE_BYTES, MAX_FILE_LABEL } from "@/lib/limits";
import type { FullReport } from "@/lib/report";
import { Mascot, type Mood } from "@/components/Mascot";
import { DEFAULT_COUNTRY_CODE, NAME_MSG, checkEmail, checkPhone, digitsOnly, suggestEmail } from "@/lib/leadRules";

type Engine = "builtin" | "n8n";
type UsedEngine = "builtin" | "n8n" | "builtin-fallback";
const ENGINE_KEY = "em-scorer-engine";
const EngineCtx = createContext<{ engine: Engine; setEngine: (e: Engine) => void }>({ engine: "builtin", setEngine: () => {} });

type Step = "about" | "upload" | "questions" | "scoring" | "report";
type ApiError = { code: string; message: string; retryable: boolean };
type Lead = { name: string; cc: string; phoneNum: string; email: string; consent: boolean };
type LeadField = "name" | "phone" | "email" | "consent";
type LeadErrors = Partial<Record<LeadField, string>>;
type Answers = {
  cgpa: string;
  cgpaScale: "10" | "4" | "100";
  englishType: "IELTS" | "TOEFL" | "NONE";
  englishScore: string;
  targetFields: string[];
  intakeYear: number;
};

const thisYear = new Date().getFullYear();
const INTAKES = [thisYear + 1, thisYear + 2, thisYear + 3];

const BAND_STYLE: Record<string, { ring: string; pill: string }> = {
  STRONG: { ring: "#3db36b", pill: "bg-green-100/80 text-green-800 border-green-200/80" },
  COMPETITIVE: { ring: "#5b4fd1", pill: "bg-primary-soft/80 text-primary-dark border-white" },
  NEEDS_WORK: { ring: "#f28b3c", pill: "bg-orange-100/80 text-orange-800 border-orange-200/80" },
  NOT_READY: { ring: "#e8636b", pill: "bg-red-100/80 text-red-800 border-red-200/80" },
};

const CATEGORY_ICON: Record<string, string> = {
  academics: "🎓",
  degreeFit: "🧩",
  work: "💼",
  research: "🔬",
  projects: "🛠️",
  english: "🗣️",
  leadership: "🌟",
  resumeQuality: "📄",
};

export function validateFile(f: File): string | null {
  const name = f.name.toLowerCase();
  const okExt = ACCEPTED_EXT.some((e) => name.endsWith(e));
  const okMime = !f.type || ACCEPTED_MIME.includes(f.type);
  if (!okExt || !okMime) return "Please upload a PDF or DOCX file. Images and other formats can't be read.";
  if (f.size > MAX_FILE_BYTES) return `That file is ${(f.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_FILE_LABEL}.`;
  if (f.size === 0) return "That file is empty. Please choose another one.";
  return null;
}

/** Same rules as LeadSchema on the server (lib/leadRules.ts), so students see problems before uploading anything. */
export function leadErrors(l: Lead): LeadErrors {
  const e: LeadErrors = {};
  if (l.name.trim().length < 2) e.name = NAME_MSG;
  const p = checkPhone(l.cc, l.phoneNum);
  if (!p.ok) e.phone = p.error;
  const m = checkEmail(l.email);
  if (!m.ok) e.email = m.error;
  if (!l.consent) e.consent = "Please tick the box so we can save your score.";
  return e;
}
const leadOk = (l: Lead) => Object.keys(leadErrors(l)).length === 0;
/** Normalised lead for the API: "+91 9876543210", lowercased email. */
function leadPayload(l: Lead) {
  const p = checkPhone(l.cc, l.phoneNum);
  const m = checkEmail(l.email);
  return { name: l.name.trim(), phone: p.ok ? p.value : "", email: m.ok ? m.value : l.email.trim(), consent: l.consent };
}

export default function Scorer() {
  const [step, setStep] = useState<Step>("about");
  const [lead, setLead] = useState<Lead>({ name: "", cc: DEFAULT_COUNTRY_CODE, phoneNum: "", email: "", consent: false });
  const [scoreStart, setScoreStart] = useState(0);
  const [scoreDone, setScoreDone] = useState(false);
  const [resultMs, setResultMs] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({
    cgpa: "",
    cgpaScale: "10",
    englishType: "IELTS",
    englishScore: "",
    targetFields: [],
    intakeYear: INTAKES[0],
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [report, setReport] = useState<FullReport | null>(null);
  const [engine, setEngineState] = useState<Engine>("builtin");
  const [usedEngine, setUsedEngine] = useState<UsedEngine>("builtin");

  useEffect(() => {
    try {
      if (localStorage.getItem(ENGINE_KEY) === "n8n") setEngineState("n8n");
    } catch {}
  }, []);
  function setEngine(e: Engine) {
    setEngineState(e);
    try {
      localStorage.setItem(ENGINE_KEY, e);
    } catch {}
  }
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  function pickFile(f: File | undefined) {
    if (!f) return;
    const err = validateFile(f);
    setFileError(err);
    setFile(err ? null : f);
  }

  function answersError(): string | null {
    const c = Number(answers.cgpa);
    const max = { "10": 10, "4": 4, "100": 100 }[answers.cgpaScale];
    if (!answers.cgpa || !(c > 0) || c > max) return `Enter your CGPA (0–${max}).`;
    if (answers.englishType !== "NONE") {
      const s = Number(answers.englishScore);
      const smax = answers.englishType === "IELTS" ? 9 : 120;
      if (!answers.englishScore || !(s >= 0) || s > smax) return `Enter your ${answers.englishType} score (0–${smax}).`;
    }
    if (answers.targetFields.length < 1) return "Choose at least 1 field";
    return null;
  }

  async function runScoring() {
    if (!leadOk(lead)) return setStep("about");
    if (!file) return setStep("upload");
    setError(null);
    setScoreDone(false);
    setScoreStart(performance.now());
    setStep("scoring");
    const t0 = performance.now();
    const fd = new FormData();
    fd.append("lead", JSON.stringify(leadPayload(lead)));
    fd.append("file", file);
    fd.append("engine", engine);
    fd.append(
      "answers",
      JSON.stringify({
        ...answers,
        cgpa: Number(answers.cgpa),
        englishScore: answers.englishType === "NONE" ? null : Number(answers.englishScore),
      })
    );
    try {
      const res = await fetch("/api/score", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.report) {
        setError(data?.error ?? { code: "SERVER", message: "Something went wrong. Please try again.", retryable: true });
        return;
      }
      // Show 100% briefly before the result appears.
      setResultMs(performance.now() - t0);
      setScoreDone(true);
      await new Promise((r) => setTimeout(r, 400));
      setReport(data.report);
      setUsedEngine(data.engine === "n8n" || data.engine === "builtin-fallback" ? data.engine : "builtin");
      setStep("report");
    } catch {
      setError({ code: "NETWORK", message: "You seem to be offline. Check your connection and try again.", retryable: true });
    }
  }

  function startOver() {
    setStep("upload");
    setFile(null);
    setReport(null);
    setError(null);
  }

  return (
    <EngineCtx.Provider value={{ engine, setEngine }}>
    <div ref={topRef} className="mx-auto w-full max-w-md min-h-full pb-32">
      {step === "about" && (
        <AboutStep lead={lead} setLead={setLead} onNext={() => leadOk(lead) && setStep("upload")} />
      )}
      {step === "upload" && (
        <UploadStep
          file={file}
          fileError={fileError}
          onPick={pickFile}
          onBack={() => setStep("about")}
          onNext={() => setStep("questions")}
        />
      )}
      {step === "questions" && (
        <QuestionsStep
          answers={answers}
          setAnswers={setAnswers}
          formError={formError}
          onBack={() => setStep("upload")}
          onSubmit={() => {
            const err = answersError();
            setFormError(err);
            if (!err) runScoring();
          }}
        />
      )}
      {step === "scoring" &&
        (error ? (
          <ErrorCard
            error={error}
            onRetry={runScoring}
            onEditDetails={() => {
              setError(null);
              setStep("about");
            }}
            onChangeFile={() => {
              setError(null);
              setFile(null);
              setStep("upload");
            }}
          />
        ) : (
          <ScoringStep start={scoreStart} done={scoreDone} />
        ))}
      {step === "report" && report && <ReportStep report={report} name={lead.name.trim().split(/\s+/)[0]} usedEngine={usedEngine} resultMs={resultMs} onStartOver={startOver} />}
    </div>
    </EngineCtx.Provider>
  );
}

/* ---------- Shared bits ---------- */

function EngineToggle() {
  const { engine, setEngine } = useContext(EngineCtx);
  const opts: { v: Engine; label: string }[] = [
    { v: "builtin", label: "Built-in" },
    { v: "n8n", label: "n8n" },
  ];
  return (
    <div className="relative mb-2 flex justify-center">
      <div role="radiogroup" aria-label="Scoring engine" className="flex rounded-full border border-white/50 bg-white/25 p-1 backdrop-blur-md">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={engine === o.v}
            onClick={() => setEngine(o.v)}
            className={`min-h-[44px] min-w-[5.5rem] rounded-full px-4 text-[0.875rem] font-extrabold transition ${
              engine === o.v ? "bg-white text-primary-dark shadow-[0_4px_12px_rgba(30,27,58,0.18)]" : "text-white"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Sparkles() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <span className="twinkle absolute left-[14%] top-[34%] text-[0.875rem] text-amber-300">✦</span>
      <span className="twinkle absolute right-[16%] top-[22%] text-[1.125rem] text-orange-300" style={{ animationDelay: ".7s" }}>
        ✦
      </span>
      <span className="twinkle absolute right-[24%] top-[52%] text-[0.8125rem] text-amber-200" style={{ animationDelay: "1.3s" }}>
        ✦
      </span>
      {/* puffy cloud */}
      <svg className="absolute -left-3 top-[16%] opacity-90" width="78" height="40" viewBox="0 0 78 40">
        <defs>
          <radialGradient id="cloud" cx="40%" cy="30%" r="80%">
            <stop offset="0" stopColor="#fff" />
            <stop offset="1" stopColor="#e6e1ff" />
          </radialGradient>
        </defs>
        <path d="M14 38 a12 12 0 0 1 2-23 a15 15 0 0 1 27-6 a12 12 0 0 1 21 7 a11 11 0 0 1 0 22z" fill="url(#cloud)" />
      </svg>
    </div>
  );
}

function Hero({
  title,
  sub,
  mood = "hello",
  bubble,
  compact = false,
}: {
  title: string;
  sub?: string;
  mood?: Mood;
  bubble?: string;
  compact?: boolean;
}) {
  return (
    <div className={`hero-grad px-5 ${compact ? "pt-6 pb-12" : "pt-7 pb-16"} rounded-b-[36px] text-center`}>
      <Sparkles />
      <EngineToggle />
      <div className="relative flex items-center justify-center gap-2 text-white/95 text-[0.8125rem] font-extrabold tracking-wide uppercase">
        <span className="inline-block h-2 w-2 rounded-full bg-accent" /> EM Chance Checker
      </div>
      <div className="relative mx-auto mt-2 w-fit">
        {bubble && (
          <span className="bubble absolute -right-12 -top-1 z-10 whitespace-nowrap px-3 py-1.5 text-[0.8125rem] font-extrabold">
            {bubble}
          </span>
        )}
        <span aria-hidden className="absolute inset-4 rounded-full bg-white/40 blur-2xl" />
        <Mascot mood={mood} size={compact ? 100 : 132} className="relative bob" />
      </div>
      <h1 className="relative mt-2 text-[1.6rem] leading-tight font-extrabold text-white drop-shadow-sm">{title}</h1>
      {sub && <p className="relative mt-2 text-white text-[0.9375rem] leading-snug">{sub}</p>}
    </div>
  );
}

/** Page progress. `current` (0–1) fills the current step's segment partly, e.g. while the analysis runs. */
function Progress({ step, current = 1 }: { step: 1 | 2 | 3 | 4; current?: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${step} of 4`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className="h-2 flex-1 overflow-hidden rounded-full bg-primary/15">
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: i < step ? "100%" : i === step ? `${Math.round(Math.min(1, Math.max(0, current)) * 100)}%` : "0%" }}
          />
        </span>
      ))}
      <span className="ml-2 text-[0.8125rem] font-extrabold text-muted whitespace-nowrap">{step}/4</span>
    </div>
  );
}

function StickyCta({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 px-3 pb-[max(12px,env(safe-area-inset-bottom))]">
      <div className="glass mx-auto flex max-w-md gap-3 rounded-[28px] p-2.5">{children}</div>
    </div>
  );
}

const btnPrimary =
  "btn-glow flex-1 min-h-[52px] rounded-full px-6 text-white font-extrabold text-[1rem] active:scale-[.98] transition disabled:active:scale-100";
const btnGhost =
  "min-h-[52px] rounded-full bg-white/80 border border-white px-5 text-primary font-extrabold active:scale-[.98] transition";
const inputCls =
  "glass-input w-full min-w-0 min-h-[52px] rounded-2xl px-4 text-[1rem] font-bold text-ink placeholder:text-muted placeholder:font-semibold outline-none focus:ring-2 focus:ring-lilac";

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-2xl border border-red-200/80 bg-red-50/80 px-4 py-3 text-sm font-semibold text-red-700">
      {children}
    </p>
  );
}

/* ---------- Steps ---------- */

function FieldHint({ error, valid, id }: { error?: string; valid: boolean; id: string }) {
  if (error)
    return (
      <p id={id} className="mt-1.5 text-[0.875rem] font-semibold text-red-700">
        {error}
      </p>
    );
  if (valid)
    return (
      <p id={id} className="mt-1.5 text-[0.875rem] font-bold text-green-700">
        ✓ Looks good
      </p>
    );
  return null;
}

function AboutStep({
  lead,
  setLead,
  onNext,
}: {
  lead: Lead;
  setLead: React.Dispatch<React.SetStateAction<Lead>>;
  onNext: () => void;
}) {
  // Errors appear after a field is left (blur) or after Continue is pressed, never while typing the first time.
  const [touched, setTouched] = useState<Partial<Record<LeadField, boolean>>>({});
  const errs = leadErrors(lead);
  const show = (f: LeadField) => (touched[f] ? errs[f] : undefined);
  const ok = (f: LeadField) => !!touched[f] && !errs[f];
  const blur = (f: LeadField) => () => setTouched((t) => ({ ...t, [f]: true }));
  const isIndia = digitsOnly(lead.cc).replace(/^\+/, "") === "91";
  const suggestion = suggestEmail(lead.email);
  const allValid = Object.keys(errs).length === 0;
  const ring = (f: LeadField) => (show(f) ? " ring-2 ring-red-300" : ok(f) ? " ring-2 ring-green-300" : "");

  return (
    <>
      <Hero
        title="Check your Erasmus Mundus chances"
        sub="Tell Mundo a little about you. It takes under a minute."
        bubble="Let's start small!"
      />
      <form
        className="relative px-4 -mt-9 space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched({ name: true, phone: true, email: true, consent: true });
          onNext();
        }}
      >
        <div className="card p-5 space-y-4">
          <Progress step={1} />
          <h2 className="text-lg font-extrabold">About you</h2>
          <div>
            <label htmlFor="lead-name" className="mb-1.5 block text-sm font-bold text-muted">
              Your name
            </label>
            <input
              id="lead-name"
              className={inputCls + ring("name")}
              placeholder="e.g. Priya Sharma"
              autoComplete="name"
              value={lead.name}
              aria-invalid={!!show("name")}
              aria-describedby="lead-name-hint"
              onBlur={blur("name")}
              onChange={(e) => setLead({ ...lead, name: e.target.value })}
            />
            <FieldHint id="lead-name-hint" error={show("name")} valid={ok("name")} />
          </div>
          <div>
            <label htmlFor="lead-phone" className="mb-1.5 block text-sm font-bold text-muted">
              Phone / WhatsApp
            </label>
            <div className="flex gap-2">
              <input
                aria-label="Country code"
                className={inputCls.replace("w-full", "w-[4.75rem]").replace("px-4", "px-2") + " shrink-0 text-center" + ring("phone")}
                inputMode="tel"
                autoComplete="tel-country-code"
                maxLength={4}
                value={lead.cc}
                onBlur={blur("phone")}
                onChange={(e) => {
                  const d = e.target.value.replace(/[^\d]/g, "").slice(0, 3);
                  setLead({ ...lead, cc: `+${d}` });
                }}
              />
              <input
                id="lead-phone"
                className={inputCls + ring("phone")}
                placeholder={isIndia ? "98765 43210" : "Phone number"}
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={isIndia ? 10 : 14}
                value={lead.phoneNum}
                aria-invalid={!!show("phone")}
                aria-describedby="lead-phone-hint"
                onBlur={blur("phone")}
                onChange={(e) => setLead({ ...lead, phoneNum: e.target.value.replace(/\D/g, "").slice(0, isIndia ? 10 : 14) })}
              />
            </div>
            <FieldHint id="lead-phone-hint" error={show("phone")} valid={ok("phone")} />
          </div>
          <div>
            <label htmlFor="lead-email" className="mb-1.5 block text-sm font-bold text-muted">
              Email
            </label>
            <input
              id="lead-email"
              className={inputCls + ring("email")}
              placeholder="name@gmail.com"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={lead.email}
              aria-invalid={!!show("email")}
              aria-describedby="lead-email-hint"
              onBlur={() => {
                setLead((l) => ({ ...l, email: l.email.trim().toLowerCase() }));
                setTouched((t) => ({ ...t, email: true }));
              }}
              onChange={(e) => setLead({ ...lead, email: e.target.value.replace(/\s/g, "") })}
            />
            {suggestion && (
              <button
                type="button"
                className="mt-1.5 min-h-[44px] text-left text-[0.875rem] font-bold text-primary underline decoration-dotted underline-offset-4"
                onClick={() => {
                  setLead({ ...lead, email: suggestion });
                  setTouched((t) => ({ ...t, email: true }));
                }}
              >
                Did you mean {suggestion}?
              </button>
            )}
            <FieldHint id="lead-email-hint" error={suggestion ? undefined : show("email")} valid={ok("email") && !suggestion} />
          </div>
          <label className="flex min-h-[44px] items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
              checked={lead.consent}
              onChange={(e) => {
                setLead({ ...lead, consent: e.target.checked });
                setTouched((t) => ({ ...t, consent: true }));
              }}
            />
            <span>I agree to be contacted about my Erasmus Mundus application and to my score being saved.</span>
          </label>
        </div>        <div className="grid grid-cols-3 gap-3">
          {[
            ["🎯", "Score /100"],
            ["🧭", "Top 3 fixes"],
            ["🎓", "3 programmes"],
          ].map(([i, t]) => (
            <div key={t} className="card px-2 py-3 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-white/80 text-xl shadow-sm">{i}</div>
              <div className="mt-1.5 text-[0.8125rem] font-extrabold">{t}</div>
            </div>
          ))}
        </div>
        <StickyCta>
          <button type="submit" className={btnPrimary} disabled={!allValid}>
            Continue
          </button>
        </StickyCta>
      </form>
    </>
  );
}

function UploadStep({
  file,
  fileError,
  onPick,
  onBack,
  onNext,
}: {
  file: File | null;
  fileError: string | null;
  onPick: (f: File | undefined) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <>
      <Hero compact title="Upload your resume" sub="Mundo reads your education, experience and research from it." bubble="Nice to meet you!" />
      <div className="relative px-4 -mt-9 space-y-4">
        <div className="card p-5">
          <Progress step={2} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              onPick(e.dataTransfer.files?.[0]);
            }}
            className={`mt-4 w-full rounded-[22px] border-2 border-dashed px-4 py-8 text-center transition backdrop-blur-sm ${
              drag
                ? "border-primary bg-primary-soft/70"
                : file
                  ? "border-green-400/80 bg-green-50/70"
                  : "border-lilac bg-white/45"
            }`}
          >
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-[20px] bg-white/90 text-3xl shadow-[0_8px_20px_rgba(91,79,209,0.15)]">
              {file ? "✅" : "📄"}
            </div>
            {file ? (
              <>
                <p className="font-extrabold break-all">{file.name}</p>
                <p className="text-sm text-muted mt-1">{(file.size / 1024).toFixed(0)} KB · tap to change</p>
              </>
            ) : (
              <>
                <p className="font-extrabold text-[1.0625rem]">Tap to upload your resume</p>
                <p className="text-sm text-muted mt-1">PDF or DOCX · max {MAX_FILE_LABEL}</p>
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              onPick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {fileError && (
            <div className="mt-3">
              <Alert>{fileError}</Alert>
            </div>
          )}
          <p className="mt-4 flex items-start gap-2 text-[0.8125rem] text-muted">
            <span aria-hidden>🔒</span>
            <span>
              We don&apos;t keep your resume. It&apos;s read once to calculate your score, then discarded. We only save the extracted details and your score.
            </span>
          </p>
        </div>
      </div>
      <StickyCta>
        <button type="button" className={btnGhost} onClick={onBack}>
          Back
        </button>
        <button className={btnPrimary} disabled={!file} onClick={onNext}>
          Continue
        </button>
      </StickyCta>
    </>
  );
}

function Chips<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`chip min-h-[44px] px-4 text-sm font-extrabold transition border ${
            value === o.value
              ? "bg-primary text-white border-primary shadow-[0_6px_16px_rgba(91,79,209,0.4)]"
              : "bg-primary-soft/80 text-primary-dark border-lilac/40 backdrop-blur-sm"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Compact glass segmented control (fits next to an input at 360px). */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-2xl border border-white bg-white/55 p-1 backdrop-blur-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-[44px] min-w-[2.6rem] rounded-xl px-2 text-[0.9375rem] font-extrabold transition ${
            value === o.value ? "bg-primary text-white shadow-[0_4px_12px_rgba(91,79,209,0.35)]" : "text-primary-dark"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const FIELD_ICON: Record<string, string> = {
  cs_ai: "💻",
  data_science: "📊",
  electrical: "⚡",
  mechanical_robotics: "🤖",
  civil_env: "🏗️",
  energy: "🌱",
  physics: "🔭",
  chemistry_materials: "🧪",
  biotech_life: "🧬",
  public_health: "🩺",
  agri_food: "🌾",
  econ_business: "📈",
  social_policy: "🏛️",
  education: "🎓",
  humanities: "📚",
  media_comm: "🎙️",
};
const MAX_FIELDS = 3;
const labelOf = (id: string) => FIELDS.find((f) => f.id === id)?.label ?? id;

/** Glass field button with pills; opens a bottom sheet to pick 1–3 fields in order. */
function FieldPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const doneRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    doneRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : value.length < MAX_FIELDS ? [...value, id] : value);
  const full = value.length >= MAX_FIELDS;

  return (
    <>
      <div className="glass-input flex min-h-[52px] w-full items-center gap-2 rounded-2xl py-1.5 pl-2 pr-3">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="chip inline-flex max-w-full items-center gap-1 bg-primary/90 py-1 pl-2.5 pr-1 text-[0.8125rem] font-extrabold text-white">
              <span aria-hidden>{FIELD_ICON[id]}</span>
              <span className="truncate">{labelOf(id)}</span>
              <button
                type="button"
                aria-label={`Remove ${labelOf(id)}`}
                onClick={() => toggle(id)}
                className="relative ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/25 text-[0.875rem] leading-none hover:bg-white/40 before:absolute before:-inset-[8px] before:content-['']"
              >
                ×
              </button>
            </span>
          ))}
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={`min-h-[44px] rounded-xl px-2 text-left text-[1rem] font-bold ${value.length ? "text-primary" : "flex-1 font-semibold text-muted"}`}
          >
            {value.length ? (full ? "Change" : "+ Add") : "Choose up to 3 fields"}
          </button>
        </div>
        <span className="shrink-0 text-[0.8125rem] font-extrabold text-muted tabular-nums" aria-label={`${value.length} of 3 chosen`}>
          {value.length}/3
        </span>
      </div>

      {open &&
        // Portal: glass cards use backdrop-filter, which would trap a fixed overlay inside the card.
        createPortal(
        <div className="fixed inset-0 z-40 flex items-end bg-ink/35 backdrop-blur-[2px]" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose your target fields"
            onClick={(e) => e.stopPropagation()}
            className="glass pop mx-auto flex max-h-[85%] w-full max-w-md flex-col rounded-t-[28px] px-4 pt-3 pb-[max(14px,env(safe-area-inset-bottom))]"
            style={{ background: "rgba(255,255,255,0.82)" }}
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-primary/20" />
            <div className="flex items-baseline justify-between gap-2 px-1">
              <h2 className="text-lg font-extrabold">Choose your target fields</h2>
              <span className="text-[0.875rem] font-extrabold text-primary tabular-nums">{value.length}/3</span>
            </div>
            <p className={`mt-1 px-1 text-[0.875rem] font-semibold ${full ? "text-primary-dark" : "text-muted"}`}>
              {full ? "You can pick up to 3. Tap one to remove it." : "Pick 1 to 3, in order of preference."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 overflow-y-auto pb-2">
              {FIELDS.map((f) => {
                const order = value.indexOf(f.id);
                const on = order >= 0;
                const dim = !on && full;
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={on}
                    aria-disabled={dim}
                    onClick={() => !dim && toggle(f.id)}
                    className={`chip relative inline-flex min-h-[46px] items-center gap-1.5 border px-3 text-left text-[0.875rem] font-extrabold transition ${
                      on
                        ? "border-primary bg-primary text-white shadow-[0_6px_16px_rgba(91,79,209,0.35)]"
                        : dim
                          ? "border-white bg-white/50 text-muted opacity-50"
                          : "border-lilac/40 bg-white/75 text-primary-dark"
                    }`}
                  >
                    <span aria-hidden>{on ? "✓" : FIELD_ICON[f.id]}</span>
                    {f.label}
                    {on && (
                      <span className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[0.8125rem] text-primary" aria-label={`choice ${order + 1}`}>
                        {order + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <button ref={doneRef} type="button" onClick={close} className={btnPrimary + " mt-2 w-full flex-none"}>
              Done
            </button>
          </div>
        </div>,
        document.querySelector(".phone-frame") ?? document.body
        )}
    </>
  );
}

function QuestionsStep({
  answers,
  setAnswers,
  formError,
  onBack,
  onSubmit,
}: {
  answers: Answers;
  setAnswers: React.Dispatch<React.SetStateAction<Answers>>;
  formError: string | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => setAnswers((a) => ({ ...a, [k]: v }));
  return (
    <>
      <Hero compact title="4 quick questions" sub="Resumes often miss these. What you type here wins over your resume." mood="thinking" bubble="Almost there!" />
      <form
        className="relative px-4 -mt-9 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="card p-5 space-y-6">
          <Progress step={3} />
          <fieldset className="min-w-0 space-y-3">
            <legend className="mb-3 font-extrabold">1. Your CGPA</legend>
            <div className="flex items-center gap-2">
              <input
                inputMode="decimal"
                placeholder={answers.cgpaScale === "100" ? "e.g. 78" : answers.cgpaScale === "4" ? "e.g. 3.4" : "e.g. 8.2"}
                className={inputCls + " flex-1"}
                value={answers.cgpa}
                onChange={(e) => set("cgpa", e.target.value.replace(",", "."))}
                aria-label="CGPA"
              />
              <Segmented
                label="CGPA scale"
                value={answers.cgpaScale}
                onChange={(v) => set("cgpaScale", v)}
                options={[
                  { value: "10", label: "/10" },
                  { value: "4", label: "/4" },
                  { value: "100", label: "%" },
                ]}
              />
            </div>
          </fieldset>
          <fieldset className="min-w-0 space-y-3">
            <legend className="mb-3 font-extrabold">2. English test</legend>
            <Chips
              label="English test"
              value={answers.englishType}
              onChange={(v) => set("englishType", v)}
              options={[
                { value: "IELTS", label: "IELTS" },
                { value: "TOEFL", label: "TOEFL iBT" },
                { value: "NONE", label: "Not yet" },
              ]}
            />
            {answers.englishType !== "NONE" && (
              <input
                inputMode="decimal"
                placeholder={answers.englishType === "IELTS" ? "Overall band, e.g. 7.0" : "Total score, e.g. 95"}
                className={inputCls}
                value={answers.englishScore}
                onChange={(e) => set("englishScore", e.target.value.replace(",", "."))}
                aria-label={`${answers.englishType} score`}
              />
            )}
          </fieldset>
          <fieldset className="min-w-0 space-y-3">
            <legend className="mb-3 font-extrabold">3. Target field(s)</legend>
            <FieldPicker value={answers.targetFields} onChange={(v) => set("targetFields", v)} />
          </fieldset>
          <fieldset className="min-w-0 space-y-3">
            <legend className="mb-3 font-extrabold">4. Intake year</legend>
            <Chips
              label="Intake year"
              value={answers.intakeYear}
              onChange={(v) => set("intakeYear", v)}
              options={INTAKES.map((y) => ({ value: y, label: String(y) }))}
            />
          </fieldset>
          {formError && <Alert>{formError}</Alert>}
        </div>
        <StickyCta>
          <button type="button" className={btnGhost} onClick={onBack}>
            Back
          </button>
          <button type="submit" className={btnPrimary}>
            Get my score
          </button>
        </StickyCta>
      </form>
    </>
  );
}

const SCORING_STEPS = [
  "Reading your resume",
  "Understanding your education and experience",
  "Scoring 8 categories",
  "Finding Erasmus Mundus programmes for you",
];

/** Eases toward ~92% over ~20 s: fast at first, slower later. */
const easedPercent = (ms: number) => 92 * (1 - Math.exp(-ms / 6500));

/** A wavy SVG band (one wavelength = 40 units), drawn twice as wide so it can slide left forever. */
function waveBand(width: number, amp: number, mid: number, height: number) {
  let d = `M 0 ${mid}`;
  for (let x = 0; x < width; x += 20) d += ` q 10 ${x % 40 === 0 ? -amp : amp} 20 0`;
  return `${d} L ${width} ${height} L 0 ${height} Z`;
}

/**
 * Frosted glass "liquid tube": glass capsule, gradient liquid with a flowing wavy surface,
 * drifting bubbles, a glowing bead at the leading edge and a white sheen on top.
 */
function LiquidProgress({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="liquid-tube relative h-[34px] w-full overflow-hidden rounded-full" aria-hidden>
      {/* liquid */}
      <div
        className="absolute inset-y-0 left-0 overflow-hidden rounded-full transition-[width] duration-500 [transition-timing-function:cubic-bezier(.22,1,.36,1)]"
        style={{ width: `${w}%`, minWidth: w > 0 ? 34 : 0 }}
      >
        <div className="liquid-body absolute inset-x-0 bottom-0 top-[9px]" />
        {/* wavy top surface: two layers, different amplitude, speed and opacity */}
        <svg className="liquid-wave liquid-wave-slow absolute left-0 top-[2px] h-[10px] w-[200%]" viewBox="0 0 400 10" preserveAspectRatio="none">
          <path d={waveBand(400, 3, 5, 10)} fill="#b9a8f5" opacity="0.55" />
        </svg>
        <svg className="liquid-wave absolute left-0 top-[4px] h-[8px] w-[200%]" viewBox="0 0 400 8" preserveAspectRatio="none">
          <path d={waveBand(400, 2, 4, 8)} fill="#9d8ff0" opacity="0.9" />
        </svg>
        {/* bubbles */}
        {[12, 34, 55, 73, 88].map((left, i) => (
          <span
            key={left}
            className="liquid-bubble absolute bottom-[3px] rounded-full bg-white/70"
            style={{ left: `${left}%`, width: 3 + (i % 3), height: 3 + (i % 3), animationDelay: `${i * 0.55}s` }}
          />
        ))}
        {/* wavy leading edge */}
        <svg className="liquid-edge absolute -right-[3px] top-0 h-[200%] w-[8px]" viewBox="0 0 8 68" preserveAspectRatio="none">
          <path d="M 0 0 q 6 4.25 0 8.5 t 0 8.5 t 0 8.5 t 0 8.5 t 0 8.5 t 0 8.5 t 0 8.5 t 0 8.5 L 0 68 Z" fill="#f0a6c8" opacity="0.7" />
        </svg>
      </div>
      {/* glowing glass bead at the leading edge */}
      <span
        className="liquid-bead absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-500 [transition-timing-function:cubic-bezier(.22,1,.36,1)]"
        style={{ left: `max(17px, calc(${w}% - 9px))`, opacity: w > 0 ? 1 : 0 }}
      />
      {/* glass sheen above the liquid */}
      <div className="pointer-events-none absolute inset-x-3 top-[3px] h-[35%] rounded-full bg-gradient-to-b from-white/70 to-white/0" />
    </div>
  );
}
function ScoringStep({ start, done }: { start: number; done: boolean }) {
  const [now, setNow] = useState(() => performance.now());
  const [frozenAt, setFrozenAt] = useState<number | null>(null);
  useEffect(() => {
    if (done) {
      setFrozenAt((f) => f ?? performance.now());
      return;
    }
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t); // also stops the timer if an error replaces this screen
  }, [done]);
  const elapsed = Math.max(0, (frozenAt ?? now) - start);
  const pct = done ? 100 : easedPercent(elapsed);
  // The 4 steps follow the percentage: 0–22, 23–45, 46–68, 69+.
  const i = done ? SCORING_STEPS.length : Math.min(SCORING_STEPS.length - 1, Math.floor(pct / 23));
  return (
    <>
      <Hero compact title="Analysing your profile…" sub="This takes about 10–20 seconds." mood="thinking" bubble="Reading carefully…" />
      <div className="relative px-4 -mt-9 space-y-4">
        <div className="card p-5">
          <Progress step={4} current={pct / 100} />
          <ol className="mt-5 space-y-3">
            {SCORING_STEPS.map((s, idx) => (
              <li key={s} className="flex items-center gap-3 rounded-2xl bg-white/55 border border-white px-3 py-2.5">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                    idx < i ? "bg-success text-white" : idx === i ? "bg-primary text-white animate-pulse" : "bg-primary/10 text-primary/60"
                  }`}
                >
                  {idx < i ? "✓" : idx + 1}
                </span>
                <span className={`text-[0.9375rem] font-bold ${idx <= i ? "text-ink" : "text-muted"}`}>{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <div
          className="card p-5"
          role="progressbar"
          aria-label="Scoring progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
            <span className="grad-text text-[2.75rem] font-extrabold leading-none tabular-nums">{Math.round(pct)}%</span>
            <span className="mb-1 whitespace-nowrap rounded-full border border-white bg-white/60 px-3 py-1 text-[0.875rem] font-bold text-primary-dark tabular-nums shadow-sm backdrop-blur-sm">
              Time taken: {(elapsed / 1000).toFixed(1)} s
            </span>
          </div>
          <div className="mt-4">
            <LiquidProgress pct={pct} />
          </div>
        </div>
      </div>
    </>
  );
}
function ErrorCard({
  error,
  onRetry,
  onEditDetails,
  onChangeFile,
}: {
  error: ApiError;
  onRetry: () => void;
  onEditDetails: () => void;
  onChangeFile: () => void;
}) {
  const needsNewFile = ["UNREADABLE_FILE", "BAD_TYPE", "FILE_TOO_LARGE"].includes(error.code);
  const needsDetails = error.code === "LOCKED";
  // Rate limit: still offer "Try again" (after a wait) so the student never has to re-upload.
  const canRetry = !needsNewFile && !needsDetails && error.code !== "NO_API_KEY";
  return (
    <>
      <Hero compact title="Oops, that didn't work" mood="oops" bubble="Hmm…" />
      <div className="relative px-4 -mt-9">
        <div className="card p-5 text-center pop" role="alert">
          <p className="text-[1rem] font-bold">{error.message}</p>
          {canRetry && <p className="mt-2 text-sm text-muted">Your details, file and answers are still here, no need to enter them again.</p>}
        </div>
      </div>
      <StickyCta>
        {needsDetails ? (
          <button className={btnPrimary} onClick={onEditDetails}>
            Check my details
          </button>
        ) : (
          <>
            <button className={btnGhost} onClick={onChangeFile}>
              {needsNewFile ? "Choose another file" : "Change file"}
            </button>
            {canRetry && (
              <button className={btnPrimary} onClick={onRetry}>
                Try again
              </button>
            )}
          </>
        )}
      </StickyCta>
    </>
  );
}

function ScoreRing({ score, color, size = 168 }: { score: number; color: string; size?: number }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 180 180" width={size} height={size} className="-rotate-90">
        <circle cx="90" cy="90" r={r} stroke="rgba(91,79,209,0.12)" strokeWidth="16" fill="none" />
        <circle
          cx="90"
          cy="90"
          r={r}
          stroke={color}
          strokeWidth="16"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          style={{ transition: "stroke-dashoffset 1s ease-out", filter: `drop-shadow(0 4px 8px ${color}55)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-extrabold">{score}</span>
        <span className="text-sm font-bold text-muted">out of 100</span>
      </div>
    </div>
  );
}

/** Small rounded segments, like a habit tracker ("3/8"). */
function Segments({ earned, max, color }: { earned: number; max: number; color: string }) {
  const n = 8;
  const filled = max > 0 ? Math.round((earned / max) * n) : 0;
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`h-2 flex-1 rounded-full ${i < filled ? color : "bg-primary/10"}`} />
      ))}
    </div>
  );
}

const ENGINE_LABEL: Record<UsedEngine, string> = {
  builtin: "Built-in",
  n8n: "n8n",
  "builtin-fallback": "Built-in (n8n was unavailable)",
};

function ReportStep({
  report,
  name,
  usedEngine,
  resultMs,
  onStartOver,
}: {
  report: FullReport;
  name: string;
  usedEngine: UsedEngine;
  resultMs: number | null;
  onStartOver: () => void;
}) {
  const style = BAND_STYLE[report.band] ?? BAND_STYLE.COMPETITIVE;
  return (
    <>
      <Hero
        compact
        title={name ? `${name}, here's your result` : "Here's your result"}
        sub={`${(report.targetFields?.length ?? 1) > 1 ? "Target fields" : "Target field"}: ${report.targetFieldLabel}`}
        mood="happy"
        bubble="Yay!"
      />
      <div className="relative px-4 -mt-9 space-y-4">
        <div className="card p-6 text-center pop">
          <ScoreRing score={report.total} color={style.ring} />
          <span className={`chip mt-4 inline-block border px-4 py-1.5 text-sm font-extrabold backdrop-blur-sm ${style.pill}`}>
            {report.bandLabel}
          </span>
          <p className="mt-3 text-[1rem] font-bold">{report.message}</p>
          {resultMs !== null && (
            <p className="mt-2 text-[0.875rem] font-bold text-muted tabular-nums">Result ready in {(resultMs / 1000).toFixed(1)} s</p>
          )}
        </div>

        {(report.englishHardGap || report.categories.find((c) => c.id === "english")?.earned === 0) && (
          <div
            role="alert"
            className="pop rounded-[26px] border border-red-200/90 p-4 backdrop-blur-xl"
            style={{
              background: "linear-gradient(135deg, rgba(254,226,226,0.85) 0%, rgba(255,241,242,0.7) 100%)",
              boxShadow: "0 10px 30px rgba(232,99,107,0.18), inset 0 1px 0 rgba(255,255,255,0.9)",
            }}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/90 text-lg shadow-sm" aria-hidden>
                🗣️
              </span>
              <div className="min-w-0">
                <p className="font-extrabold text-red-800">English test required</p>
                <p className="text-[0.8125rem] font-bold text-red-700">Hard requirement for most EM programmes</p>
              </div>
            </div>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-red-900">
              {report.englishFix ??
                "Book IELTS (target 7.0+) or TOEFL iBT (target 100+); most EM programmes require a valid test score to apply."}
            </p>
          </div>
        )}
        <section className="card p-4">
          <h2 className="px-1 text-lg font-extrabold">Score breakdown</h2>
          <ul className="mt-3 space-y-2.5">
            {report.categories.map((c) => {
              const pct = (c.earned / c.max) * 100;
              const color = pct >= 75 ? "bg-success" : pct >= 45 ? "bg-primary" : pct > 0 ? "bg-accent" : "bg-danger";
              return (
                <li key={c.id} className="rounded-2xl border border-white bg-white/55 p-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/90 text-lg shadow-sm">
                      {CATEGORY_ICON[c.id] ?? "⭐"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-extrabold">{c.label}</span>
                        <span className="shrink-0 rounded-lg bg-white/80 px-2 py-0.5 text-sm font-extrabold">
                          {c.earned}
                          <span className="text-muted">/{c.max}</span>
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <Segments earned={c.earned} max={c.max} color={color} />
                      </div>
                    </div>
                  </div>
                  {c.reasons.length > 0 && <p className="mt-2 text-[0.8125rem] text-muted break-words">{c.reasons.join(" · ")}</p>}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="px-1 text-lg font-extrabold">Your 3 biggest gaps</h2>
          {report.gaps.map((g, i) => (
            <div key={g.category} className="card p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100/90 text-lg">
                  {["🥇", "🥈", "🥉"][i] ?? "•"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold">{g.label}</p>
                  <p className="text-[0.8125rem] font-bold text-muted">−{g.shortfall} points</p>
                </div>
                {g.hard && <span className="chip border border-red-200 bg-red-100/80 px-3 py-1 text-[0.8125rem] font-extrabold text-red-700">Hard gap</span>}
              </div>
              <p className="mt-3 text-[0.9375rem] leading-relaxed">{g.fix}</p>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="px-1 text-lg font-extrabold">3 programmes that fit you</h2>
          {report.programmes.map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="card block p-4 active:scale-[.99] transition">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft/90 text-lg">🏛️</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[0.8125rem] font-extrabold uppercase tracking-wide text-primary">{p.acronym}</p>
                    <span
                      className={`chip shrink-0 border px-3 py-1 text-[0.8125rem] font-extrabold ${
                        p.tag === "Reach"
                          ? "border-orange-200 bg-orange-100/80 text-orange-800"
                          : p.tag === "Safer"
                            ? "border-green-200 bg-green-100/80 text-green-800"
                            : "border-white bg-primary-soft/80 text-primary-dark"
                      }`}
                    >
                      {p.tag}
                    </span>
                  </div>
                  <p className="font-extrabold leading-snug">{p.name}</p>
                  <p className="mt-2 text-sm text-muted">{p.why}</p>
                  <p className="mt-2 text-sm font-bold text-primary">View in the EM catalogue →</p>
                </div>
              </div>
            </a>
          ))}
        </section>

        <p className="px-1 text-[0.8125rem] font-bold text-muted">Scored by: {ENGINE_LABEL[usedEngine]}</p>
        <p className="px-1 pb-4 text-[0.8125rem] text-muted">
          This score is our own heuristic to help you prepare, not an official Erasmus Mundus formula. Always check each programme&apos;s requirements.
        </p>
      </div>
      <StickyCta>
        <button className={btnPrimary} onClick={onStartOver}>
          Score another resume
        </button>
      </StickyCta>
    </>
  );
}
