import { describe, expect, it } from "vitest";
import { checkEmail, checkFullPhone, checkPhone, suggestEmail, PHONE_MSG_IN } from "@/lib/leadRules";
import { LeadSchema } from "@/lib/schema";

describe("phone (+91)", () => {
  it.each(["9876543210", "6000000000", "7012345678", "8123456789", "98765 43210", "98765-43210"])("accepts %s", (n) => {
    expect(checkPhone("+91", n)).toEqual({ ok: true, value: `+91 ${n.replace(/[\s-]/g, "")}` });
  });
  it.each([
    ["5123456789", "starts with 5"],
    ["98765", "too short"],
    ["98765432101", "too long"],
    ["9999999999", "all digits the same"],
    ["0000000000", "all zeros"],
    ["98765abcde", "letters"],
    ["", "empty"],
  ])("rejects %s (%s)", (n) => {
    expect(checkPhone("+91", n)).toEqual({ ok: false, error: PHONE_MSG_IN });
  });
});

describe("phone (other country codes)", () => {
  it("accepts 6–14 digits", () => {
    expect(checkPhone("+44", "7911123456").ok).toBe(true);
    expect(checkPhone("+1", "4155552671").ok).toBe(true);
    expect(checkPhone("+65", "812345").ok).toBe(true);
  });
  it("rejects too short, too long (>15 total) and bad codes", () => {
    expect(checkPhone("+44", "12345").ok).toBe(false);
    expect(checkPhone("+444", "123456789012345").ok).toBe(false);
    expect(checkPhone("+0", "7911123456").ok).toBe(false);
    expect(checkPhone("", "7911123456").ok).toBe(false);
  });
});

describe("full phone string (server side)", () => {
  it.each(["+91 9876543210", "+91 98765 43210", "+919876543210", "91 9876543210"])("accepts %s", (p) => {
    expect(checkFullPhone(p)).toEqual({ ok: true, value: "+91 9876543210" });
  });
  it.each(["9876543210", "+91 5123456789", "+91 9999999999", "+91 98765"])("rejects %s", (p) => {
    expect(checkFullPhone(p).ok).toBe(false);
  });
});

describe("email", () => {
  it.each([
    ["Name@Gmail.com ", "name@gmail.com"],
    ["first.last+em@college.ac.in", "first.last+em@college.ac.in"],
    ["a_b@my-domain.io", "a_b@my-domain.io"],
  ])("accepts %s", (raw, out) => {
    expect(checkEmail(raw)).toEqual({ ok: true, value: out });
  });
  it.each(["name@gmail", "name@gmail.c", "na me@gmail.com", "name..x@gmail.com", ".name@gmail.com", "name.@gmail.com", "name@gmail..com", "@gmail.com", "name@", "name@-x.com"])(
    "rejects %s",
    (raw) => {
      expect(checkEmail(raw).ok).toBe(false);
    }
  );
  it.each([
    ["priya@gmial.com", "priya@gmail.com"],
    ["priya@gmal.com", "priya@gmail.com"],
    ["priya@gmai.com", "priya@gmail.com"],
    ["priya@gamil.com", "priya@gmail.com"],
    ["priya@gmail.con", "priya@gmail.com"],
    ["priya@gmail.cmo", "priya@gmail.com"],
    ["priya@yaho.com", "priya@yahoo.com"],
    ["priya@hotmial.com", "priya@hotmail.com"],
    ["priya@outlok.com", "priya@outlook.com"],
  ])("suggests a fix for %s", (raw, fix) => {
    expect(suggestEmail(raw)).toBe(fix);
  });
  it("suggests nothing for a correct address", () => {
    expect(suggestEmail("priya@gmail.com")).toBeNull();
  });
});

describe("LeadSchema", () => {
  const base = { name: "Priya Sharma", email: "Priya@Gmail.com", phone: "+91 98765 43210", consent: true };
  it("normalises a valid lead", () => {
    expect(LeadSchema.parse(base)).toEqual({ ...base, email: "priya@gmail.com", phone: "+91 9876543210" });
  });
  it("rejects with the same messages as the form", () => {
    const r = LeadSchema.safeParse({ ...base, phone: "+91 9999999999" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(PHONE_MSG_IN);
    expect(LeadSchema.safeParse({ ...base, email: "priya@gmail" }).success).toBe(false);
  });
});
