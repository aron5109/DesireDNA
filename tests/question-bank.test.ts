import { describe, expect, it } from "vitest";

import { STANDARD_OPTIONS, getQuestions, questions, raceSensitiveQuestion } from "@/data/questions";

/**
 * Terms that must never appear in the bank. Matched on word boundaries so an
 * innocent substring cannot trip the check.
 */
const FORBIDDEN = [
  "teen",
  "teens",
  "minor",
  "minors",
  "underage",
  "barely legal",
  "schoolgirl",
  "schoolboy",
  "incest",
  "bestiality",
  "scat",
  "trafficking",
  "unconscious",
  "drunk",
  "passed out",
  "hidden camera",
  "hidden-camera",
  "upskirt",
  "revenge porn",
  "choking",
  "breath play",
  "asphyxiation",
  "non-consensual",
  "nonconsensual",
];

describe("question bank", () => {
  it("has unique stable IDs and complete metadata", () => {
    expect(new Set(questions.map((question) => question.id)).size).toBe(questions.length);

    for (const question of questions) {
      expect(question.id).toMatch(/^[a-z]+_[a-z0-9_]+$/);
      expect(question.categoryId).toBeTruthy();
      expect(question.categoryLabel).toBeTruthy();
      expect(question.shortLabel).toBeTruthy();
      expect(question.prompt.length).toBeGreaterThan(10);
      expect(question.version).toBeTruthy();
      expect(question.intensity).toBeGreaterThanOrEqual(1);
      expect(question.intensity).toBeLessThanOrEqual(5);
      expect(question.answerOptions.some((option) => option.value === "prefer_not_to_answer")).toBe(false);
      if (question.scoringEnabled) {
        expect(question.answerOptions.filter((option) => !option.excluded).every((option) => option.score !== undefined)).toBe(true);
      }
    }
  });

  it("covers every required category", () => {
    const categories = new Set(questions.map((question) => question.categoryId));
    for (const required of [
      "everyday",
      "physical",
      "oral",
      "anal",
      "power",
      "toys",
      "watching",
      "groups",
      "fluids",
      "communication",
    ]) {
      expect(categories.has(required)).toBe(true);
    }
    expect(questions.length).toBeGreaterThanOrEqual(100);
  });

  it("distinguishes giving, receiving, and watching roles", () => {
    const roles = new Set(questions.map((question) => question.role));
    for (const role of ["giving", "receiving", "watching", "being_watched"]) {
      expect(roles.has(role as never)).toBe(true);
    }
  });

  it("keeps sort order unique and stable", () => {
    const orders = questions.map((question) => question.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("uses the requested experience labels", () => {
    expect(STANDARD_OPTIONS.some((option) => String(option.value) === "love_it")).toBe(false);
    expect(STANDARD_OPTIONS.find((option) => option.value === "like_it")?.label).toBe("I have done it and love it");
    expect(STANDARD_OPTIONS.find((option) => option.value === "hard_limit")?.boundary).toBe(true);
    expect(STANDARD_OPTIONS.find((option) => option.value === "hard_limit")?.score).toBe(0);
  });

  it("contains only valid standard values for standard questions", () => {
    const valid = new Set<string>(STANDARD_OPTIONS.map((option) => option.value));
    for (const question of questions.filter((entry) => entry.responseType === "single_choice")) {
      for (const option of question.answerOptions) expect(valid.has(option.value)).toBe(true);
    }
  });

  it("omits forbidden framing everywhere, including the media taxonomy", () => {
    const text = JSON.stringify([...getQuestions(), raceSensitiveQuestion]).toLowerCase();
    for (const term of FORBIDDEN) {
      expect(text).not.toMatch(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
    }
  });

  it("disables race-sensitive scoring and comparison", () => {
    expect(raceSensitiveQuestion.scoringEnabled).toBe(false);
    expect(raceSensitiveQuestion.comparisonEnabled).toBe(false);
    expect(raceSensitiveQuestion.sensitiveTags).toContain("racial_ethnic_data");
  });

  it("leaves race-sensitive items out of the bank unless the flag is enabled", () => {
    expect(getQuestions().some((question) => question.id === raceSensitiveQuestion.id)).toBe(false);
  });
});
