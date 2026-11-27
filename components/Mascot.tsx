import { useId } from "react";

/** "Mundo", our original mascot: a round little owl with a graduation cap. */
export type Mood = "hello" | "thinking" | "happy" | "oops";

export function Mascot({ mood = "hello", size = 140, className = "" }: { mood?: Mood; size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const mouth =
    mood === "oops" ? "M88 112 q12 -8 24 0" : mood === "thinking" ? "M90 110 h20" : "M86 106 q14 14 28 0";
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={`body${id}`} cx="35%" cy="28%" r="80%">
          <stop offset="0" stopColor="#b3a9ff" />
          <stop offset=".55" stopColor="#8b7ff0" />
          <stop offset="1" stopColor="#6c5fdc" />
        </radialGradient>
        <radialGradient id={`belly${id}`} cx="40%" cy="30%" r="80%">
          <stop offset="0" stopColor="#fff3ea" />
          <stop offset="1" stopColor="#efcdb6" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="186" rx="54" ry="9" fill="#5b4fd1" opacity=".18" />
      {/* body */}
      <path d="M40 120 C40 70 70 52 100 52 C130 52 160 70 160 120 C160 160 132 180 100 180 C68 180 40 160 40 120Z" fill={`url(#body${id})`} />
      <ellipse cx="76" cy="70" rx="16" ry="9" fill="#fff" opacity=".35" transform="rotate(-25 76 70)" />
      <path d="M62 132 C62 110 80 100 100 100 C120 100 138 110 138 132 C138 158 120 170 100 170 C80 170 62 158 62 132Z" fill={`url(#belly${id})`} />
      {/* chest feathers */}
      <path d="M86 130 q7 6 14 0 q7 6 14 0" stroke="#e7bfa3" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M90 146 q5 5 10 0 q5 5 10 0" stroke="#e7bfa3" strokeWidth="4" fill="none" strokeLinecap="round" />
      {/* wings */}
      <path d="M42 118 q-14 18 2 40 q10 -6 14 -22z" fill="#7064dc" className={mood === "happy" ? "origin-center" : ""} />
      <path d="M158 118 q14 18 -2 40 q-10 -6 -14 -22z" fill="#7064dc" />
      {/* eyes */}
      <circle cx="78" cy="88" r="20" fill="#fff" />
      <circle cx="122" cy="88" r="20" fill="#fff" />
      {mood === "happy" ? (
        <>
          <path d="M68 90 q10 -12 20 0" stroke="#1e1b3a" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M112 90 q10 -12 20 0" stroke="#1e1b3a" strokeWidth="5" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx={mood === "thinking" ? 84 : 80} cy={mood === "thinking" ? 84 : 90} r="8" fill="#1e1b3a" />
          <circle cx={mood === "thinking" ? 128 : 124} cy={mood === "thinking" ? 84 : 90} r="8" fill="#1e1b3a" />
          <circle cx={mood === "thinking" ? 87 : 83} cy={mood === "thinking" ? 81 : 87} r="2.5" fill="#fff" />
          <circle cx={mood === "thinking" ? 131 : 127} cy={mood === "thinking" ? 81 : 87} r="2.5" fill="#fff" />
        </>
      )}
      {/* beak + mouth */}
      <path d="M94 100 l6 8 l6 -8z" fill="#f28b3c" />
      <path d={mouth} stroke="#1e1b3a" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".0" />
      {/* cheeks */}
      <circle cx="62" cy="106" r="6" fill="#ff9fb0" opacity=".6" />
      <circle cx="138" cy="106" r="6" fill="#ff9fb0" opacity=".6" />
      {/* graduation cap */}
      <path d="M100 22 L152 40 L100 58 L48 40Z" fill="#1e1b3a" />
      <rect x="78" y="44" width="44" height="14" rx="4" fill="#1e1b3a" />
      <path d="M152 40 v22" stroke="#f28b3c" strokeWidth="3" />
      <circle cx="152" cy="64" r="5" fill="#f28b3c" />
      {mood === "oops" && <path d="M150 90 q6 10 0 14 q-6 -4 0 -14z" fill="#7cc6ff" />}
      {mood === "thinking" && (
        <>
          <circle cx="170" cy="70" r="5" fill="#fff" opacity=".9" />
          <circle cx="182" cy="56" r="8" fill="#fff" opacity=".9" />
        </>
      )}
    </svg>
  );
}
