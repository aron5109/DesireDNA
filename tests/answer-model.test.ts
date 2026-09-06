import { describe, expect, it } from "vitest";

import {
  ContradictoryAnswerError,
  assertCoherent,
  isAffirmative,
  isFantasyOnly,
  isHardLimit,
  isUnscored,
  responseSchema,
} from "@/lib/quiz/answer";

describe("answer model", () => {
  it("records interest without inventing experience", () => {
    const swipe = { kind: "interest", interest: "yes" } as const;
    expect(isAffirmative(swipe)).toBe(true);
    // Nothing about having tried it is implied.
    expect("details" in swipe).toBe(false);
  });

  it("keeps 'Into it' distinct from proven experience", () => {
    const keen = { kind: "interest", interest: "yes" } as const;
    const tried = { kind: "interest", interest: "yes", details: { experience: "tried" } } as const;
    expect(isAffirmative(keen)).toBe(true);
    expect(keen).not.toEqual(tried);
  });

  it("treats skipped and not-applicable as different from no", () => {
    const no = { kind: "interest", interest: "no" } as const;
    const skipped = { kind: "skipped" } as const;
    const na = { kind: "not_applicable" } as const;

    expect(isUnscored(no)).toBe(false);
    expect(isUnscored(skipped)).toBe(true);
    expect(isUnscored(na)).toBe(true);
    expect(isHardLimit(no)).toBe(false);
  });

  it("only marks a hard limit when it was set deliberately", () => {
    expect(isHardLimit({ kind: "interest", interest: "no" })).toBe(false);
    expect(isHardLimit({ kind: "interest", interest: "no", details: { hardLimit: true } })).toBe(true);
  });

  it("keeps fantasy separate from willingness", () => {
    const fantasy = { kind: "interest", interest: "yes", details: { intent: "fantasy_only" } } as const;
    expect(isFantasyOnly(fantasy)).toBe(true);
    expect(isFantasyOnly({ kind: "interest", interest: "yes" })).toBe(false);
  });

  it("rejects contradictory combinations", () => {
    expect(() => assertCoherent({ kind: "interest", interest: "yes", details: { hardLimit: true } })).toThrow(
      ContradictoryAnswerError,
    );
    expect(() =>
      assertCoherent({ kind: "interest", interest: "no", details: { hardLimit: true, intent: "real" } }),
    ).toThrow(ContradictoryAnswerError);
    expect(() =>
      assertCoherent({ kind: "interest", interest: "yes", details: { experience: "not_tried", outcome: "positive" } }),
    ).toThrow(ContradictoryAnswerError);
  });

  it("accepts a coherent detailed answer", () => {
    expect(() =>
      assertCoherent({
        kind: "interest",
        interest: "curious",
        details: { experience: "not_tried", intent: "conditions" },
      }),
    ).not.toThrow();
  });

  it("refuses unknown response shapes at the schema boundary", () => {
    expect(responseSchema.safeParse({ kind: "interest", interest: "maybe" }).success).toBe(false);
    expect(responseSchema.safeParse({ kind: "made_up" }).success).toBe(false);
    expect(responseSchema.safeParse({ kind: "multi", values: [] }).success).toBe(false);
    expect(responseSchema.safeParse({ kind: "interest", interest: "yes", extra: 1 }).success).toBe(false);
    expect(responseSchema.safeParse({ kind: "multi_none" }).success).toBe(true);
  });
});
