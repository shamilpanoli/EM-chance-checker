/**
 * Lead validation rules shared by the browser (About you step) and the server (LeadSchema),
 * so both always agree. Pure functions, safe to import anywhere.
 */

export const DEFAULT_COUNTRY_CODE = "+91";

export const PHONE_MSG_IN = "Enter a 10-digit mobile number starting with 6, 7, 8 or 9";
export const PHONE_MSG_INTL = "Enter a valid phone number (6–14 digits after the country code)";
export const PHONE_MSG_CC = "Enter a country code like +91";
export const EMAIL_MSG = "Enter a valid email like name@gmail.com";
export const NAME_MSG = "Enter your name";

/** Strips spaces, dashes, dots and brackets people type between digits. */
export const digitsOnly = (s: string) => s.replace(/[\s().-]/g, "");

/**
 * Validates a country code + national number.
 * +91: exactly 10 digits, first digit 6–9, not all 10 digits identical.
 * Other codes: 6–14 digits, and country code + number ≤ 15 digits (E.164).
 * Returns the normalised "+CC NNNNNNNNNN" or an error message.
 */
export function checkPhone(countryCode: string, number: string): { ok: true; value: string } | { ok: false; error: string } {
  const cc = digitsOnly(countryCode).replace(/^\+/, "");
  if (!/^[1-9]\d{0,2}$/.test(cc)) return { ok: false, error: PHONE_MSG_CC };
  const n = digitsOnly(number);
  if (cc === "91") {
    if (!/^[6-9]\d{9}$/.test(n) || /^(\d)\1{9}$/.test(n)) return { ok: false, error: PHONE_MSG_IN };
  } else if (!/^\d{6,14}$/.test(n) || cc.length + n.length > 15 || /^(\d)\1+$/.test(n)) {
    return { ok: false, error: PHONE_MSG_INTL };
  }
  return { ok: true, value: `+${cc} ${n}` };
}

/** Parses a full phone string like "+91 98765 43210" (country code required, "+" optional). */
export function checkFullPhone(full: string) {
  const m = full.trim().match(/^\+?(\d{1,3})[\s-]+(.+)$/) ?? full.trim().match(/^\+(91)(\d{10})$/);
  if (!m) return { ok: false as const, error: PHONE_MSG_IN };
  return checkPhone(m[1], m[2]);
}

/**
 * Email: local@domain.tld, TLD ≥ 2 letters, no spaces, no consecutive dots,
 * no dot at the start/end of the local part. Trimmed and lowercased.
 */
export function checkEmail(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const e = raw.trim().toLowerCase();
  const re = /^[a-z0-9_%+-]+(\.[a-z0-9_%+-]+)*@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;
  if (e.length > 200 || !re.test(e)) return { ok: false, error: EMAIL_MSG };
  return { ok: true, value: e };
}

const DOMAIN_FIXES: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmail.co": "gmail.com",
  "yaho.com": "yahoo.com",
  "hotmial.com": "hotmail.com",
  "outlok.com": "outlook.com",
};

/** "Did you mean …?" for common domain typos. Returns null when nothing looks wrong. */
export function suggestEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return null;
  const local = e.slice(0, at);
  let domain = e.slice(at + 1);
  domain = domain.replace(/\.(con|cmo|cm|vom)$/, ".com");
  domain = DOMAIN_FIXES[domain] ?? domain;
  const fixed = `${local}@${domain}`;
  return fixed !== e && checkEmail(fixed).ok ? fixed : null;
}
