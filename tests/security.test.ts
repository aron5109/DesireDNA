import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { generateDesireCode, generateOwnerToken, normalizeDesireCode } from "@/lib/server/codes";
import { decrypt, encrypt, hmac } from "@/lib/server/crypto";
import { validateResponses } from "@/lib/quiz/validation";
import { CURRENT_QUIZ_VERSION, getCards } from "@/data/bank/registry";

const key = randomBytes(32).toString("base64");

describe("DesireCode generation", () => {
  it("formats and normalizes securely generated codes", () => {
    const codes = new Set(Array.from({ length: 200 }, generateDesireCode));
    expect(codes.size).toBe(200);

    for (const code of codes) {
      expect(code).toMatch(/^DDNA-(?:[A-HJ-NP-Z2-9]{4}-){3}[A-HJ-NP-Z2-9]{4}$/);
      // Ambiguous characters are excluded from the alphabet entirely.
      expect(code.slice(5)).not.toMatch(/[OI01]/);
      expect(normalizeDesireCode(code.replaceAll("-", "").toLowerCase())).toBe(code);
      expect(normalizeDesireCode(` ${code} `)).toBe(code);
      expect(normalizeDesireCode(code.replaceAll("-", " "))).toBe(code);
    }
  });

  it("normalizes a code whose body happens to start with the prefix", () => {
    // Without the prefix, a body beginning "DDNA" must not lose those letters.
    const body = "DDNAKMPQRSTVWXYZ";
    expect(normalizeDesireCode(body)).toBe("DDNA-DDNA-KMPQ-RSTV-WXYZ");
    expect(normalizeDesireCode(`DDNA-${body}`)).toBe("DDNA-DDNA-KMPQ-RSTV-WXYZ");
  });

  it("rejects malformed codes instead of silently repairing them", () => {
    for (const value of ["", "DDNA", "DDNA-ABCD", "DDNA-ABCD-EFGH-JKLM-NPQ", "DDNA-ABCD-EFGH-JKLM-NPQ0", "!!!!"]) {
      expect(normalizeDesireCode(value)).toBeNull();
    }
  });

  it("issues owner tokens with at least 256 bits of entropy", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateOwnerToken));
    expect(tokens.size).toBe(200);
    // 32 random bytes in base64url.
    for (const token of tokens) expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });
});

describe("payload encryption", () => {
  it("round trips AES-GCM", () => {
    const sealed = encrypt({ private: "answer" }, key);
    expect(sealed.ciphertext).not.toContain("answer");
    expect(decrypt(sealed, key)).toEqual({ private: "answer" });
  });

  it("uses a fresh IV for every payload", () => {
    const ivs = new Set(Array.from({ length: 50 }, () => encrypt({ private: "answer" }, key).iv));
    expect(ivs.size).toBe(50);
  });

  it("rejects tampering with the ciphertext, IV, or auth tag", () => {
    const sealed = encrypt({ private: "answer" }, key);
    const flip = (value: string) => (value[0] === "A" ? `B${value.slice(1)}` : `A${value.slice(1)}`);

    expect(() => decrypt({ ...sealed, ciphertext: flip(sealed.ciphertext) }, key)).toThrow();
    expect(() => decrypt({ ...sealed, iv: flip(sealed.iv) }, key)).toThrow();
    expect(() => decrypt({ ...sealed, authTag: flip(sealed.authTag) }, key)).toThrow();
  });

  it("cannot be read with a different key", () => {
    const sealed = encrypt({ private: "answer" }, key);
    expect(() => decrypt(sealed, randomBytes(32).toString("base64"))).toThrow();
  });
});

describe("lookup hashing", () => {
  it("is deterministic per key and separated between purposes", () => {
    const shareKey = randomBytes(32).toString("base64");
    const ownerKey = randomBytes(32).toString("base64");

    expect(hmac("DDNA-ABCD-EFGH-JKLM-NPQR", shareKey)).toBe(hmac("DDNA-ABCD-EFGH-JKLM-NPQR", shareKey));
    expect(hmac("DDNA-ABCD-EFGH-JKLM-NPQR", shareKey)).not.toBe(hmac("DDNA-ABCD-EFGH-JKLM-NPQR", ownerKey));
    expect(hmac("DDNA-ABCD-EFGH-JKLM-NPQR", shareKey)).not.toContain("DDNA");
  });
});

describe("answer validation", () => {
  const cards = getCards();
  const interest = cards.find((card) => card.responseType === "interest")!;
  const version = CURRENT_QUIZ_VERSION;

  it("accepts well-formed responses", () => {
    expect(() => validateResponses({ [interest.id]: { kind: "interest", interest: "yes" } }, version)).not.toThrow();
    expect(() => validateResponses({ [interest.id]: { kind: "skipped" } }, version)).not.toThrow();
    expect(() => validateResponses({ [interest.id]: { kind: "not_applicable" } }, version)).not.toThrow();
  });

  it("rejects unknown ids and mismatched shapes", () => {
    expect(() => validateResponses({ nope: { kind: "interest", interest: "yes" } }, version)).toThrow();
    expect(() => validateResponses({ [interest.id]: { kind: "choice", value: "x" } }, version)).toThrow();
    expect(() => validateResponses({ [interest.id]: { kind: "multi", values: ["x"] } }, version)).toThrow();
  });

  it("rejects values a card does not offer", () => {
    const select = cards.find((card) => card.responseType === "single_select")!;
    expect(() => validateResponses({ [select.id]: { kind: "choice", value: "not-an-option" } }, version)).toThrow();

    const multi = cards.find((card) => card.responseType === "multi_select" && !card.showWhen)!;
    expect(() => validateResponses({ [multi.id]: { kind: "multi", values: ["not-an-option"] } }, version)).toThrow();
  });

  it("rejects a submission built for a different quiz version", () => {
    expect(() => validateResponses({}, "2026.2")).toThrow();
  });
});
