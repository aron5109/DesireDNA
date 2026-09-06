import { describe, expect, it } from "vitest";

import { BANK_V3, RACE_SENSITIVE_CARD } from "@/data/bank/v3";
import { CURRENT_QUIZ_VERSION, getCards, versionsAreComparable } from "@/data/bank/registry";
import { QUIZ_VERSION_V2 } from "@/data/bank/v2-frozen";
import { COMPLEMENT } from "@/lib/quiz/bank-types";

const FORBIDDEN = [
  "teen", "teens", "minor", "minors", "underage", "barely legal", "schoolgirl", "schoolboy",
  "incest", "bestiality", "scat", "trafficking", "unconscious", "drunk", "passed out",
  "hidden camera", "upskirt", "revenge porn", "choking", "breath play", "asphyxiation",
  "non-consensual", "nonconsensual",
];

const cards = BANK_V3.cards;

describe("question bank", () => {
  it("is a curated size rather than a long list", () => {
    const onDefaultPath = cards.filter((card) => !card.showWhen);
    expect(onDefaultPath.length).toBeGreaterThanOrEqual(55);
    expect(onDefaultPath.length).toBeLessThanOrEqual(80);
  });

  it("uses stable semantic ids, not positional ones", () => {
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
    for (const card of cards) {
      expect(card.id).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
      // A positional id like "everyday_07" must never come back.
      expect(card.id).not.toMatch(/_\d+$/);
    }
  });

  it("declares role metadata explicitly and consistently", () => {
    for (const card of cards) {
      expect(card.activityId).toBeTruthy();
      expect(card.role).toBeTruthy();
      // The declared complement must agree with the role table.
      expect(card.compatibleRole).toBe(COMPLEMENT[card.role]);
    }
  });

  it("has no duplicate activity and role combinations", () => {
    const seen = new Set<string>();
    for (const card of cards) {
      const key = `${card.activityId}:${card.role}`;
      expect(seen.has(key), `duplicate activity/role: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("covers every core topic group", () => {
    const categories = new Set(cards.map((card) => card.categoryId));
    for (const required of [
      "everyday", "physical", "oral", "anal", "power",
      "toys", "watching", "groups", "fluids", "media", "communication",
    ]) {
      expect(categories.has(required), `missing category ${required}`).toBe(true);
    }
  });

  it("uses fitting controls rather than forcing everything into a swipe", () => {
    const frequency = cards.find((card) => card.id === "everyday.frequency");
    expect(frequency?.responseType).toBe("single_select");
    expect(frequency?.options?.length).toBeGreaterThan(3);

    const media = cards.find((card) => card.id === "media.categories");
    expect(media?.responseType).toBe("multi_select");
    expect(media?.groups?.length).toBeGreaterThan(1);

    // A frequency question must not be phrased as an interest card.
    expect(frequency?.prompt.toLowerCase()).not.toContain("how do you feel about");
  });

  it("gates conditional cards on an explicit earlier answer", () => {
    for (const card of cards.filter((entry) => entry.showWhen)) {
      const gate = cards.find((entry) => entry.id === card.showWhen?.questionId);
      expect(gate, `${card.id} has an unknown gate`).toBeDefined();
    }
  });

  it("keeps the race-sensitive item out of the bank, scoring, and comparison", () => {
    expect(getCards().some((card) => card.id === RACE_SENSITIVE_CARD.id)).toBe(false);
    expect(RACE_SENSITIVE_CARD.scoringEnabled).toBe(false);
    expect(RACE_SENSITIVE_CARD.comparisonEnabled).toBe(false);
    expect(RACE_SENSITIVE_CARD.sensitiveTags).toContain("racial_ethnic_data");
  });

  it("omits forbidden framing", () => {
    const text = JSON.stringify([...cards, RACE_SENSITIVE_CARD]).toLowerCase();
    for (const term of FORBIDDEN) {
      expect(text).not.toMatch(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
    }
  });

  it("offers no way to skip a whole category", () => {
    const text = JSON.stringify(cards).toLowerCase();
    expect(text).not.toContain("skip category");
    expect(text).not.toContain("skip this category");
  });

  it("only compares versions that share an answer model", () => {
    expect(versionsAreComparable(CURRENT_QUIZ_VERSION, CURRENT_QUIZ_VERSION)).toBe(true);
    expect(versionsAreComparable(CURRENT_QUIZ_VERSION, QUIZ_VERSION_V2)).toBe(false);
    expect(versionsAreComparable(CURRENT_QUIZ_VERSION, "made-up")).toBe(false);
  });
});
