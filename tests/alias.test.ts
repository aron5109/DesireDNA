import { describe, expect, it } from "vitest";

import { ALIAS_ADJECTIVES, ALIAS_NOUNS, generateAlias, isValidAlias, sanitizeAlias } from "@/lib/quiz/alias";

describe("display aliases", () => {
  it("builds aliases from the curated word lists", () => {
    for (let i = 0; i < 200; i++) {
      const alias = generateAlias();
      const [adjective, noun, digits] = alias.split(" ");
      expect(ALIAS_ADJECTIVES).toContain(adjective);
      expect(ALIAS_NOUNS).toContain(noun);
      expect(digits).toMatch(/^\d{4}$/);
      expect(isValidAlias(alias)).toBe(true);
    }
  });

  it("varies between people", () => {
    const generated = new Set(Array.from({ length: 200 }, generateAlias));
    expect(generated.size).toBeGreaterThan(150);
  });

  it("rejects anything that is not a curated alias", () => {
    const rejected = [
      "",
      "Velvet Orchid",
      "Velvet Orchid 42",
      "Velvet Orchid 12345",
      "Notaword Orchid 4821",
      "Velvet Notaword 4821",
      "<script>alert(1)</script>",
      "Velvet Orchid 4821 extra",
      42,
      null,
      undefined,
    ];
    for (const value of rejected) expect(isValidAlias(value)).toBe(false);
  });

  it("replaces an untrusted alias with a fresh one rather than passing it through", () => {
    const sanitised = sanitizeAlias("<img src=x onerror=alert(1)>");
    expect(isValidAlias(sanitised)).toBe(true);
    expect(sanitised).not.toContain("<");
  });

  it("keeps a valid alias unchanged", () => {
    const alias = generateAlias();
    expect(sanitizeAlias(alias)).toBe(alias);
  });
});
