import { describe, expect, it } from "vitest";

import { getCards } from "@/data/bank/registry";
import type { ResponseMap } from "@/lib/quiz/answer";
import { MIN_SCORED_ANSWERS, isCardVisible, scoreResponses } from "@/lib/quiz/scoring";

const cards = getCards();
const interestCards = cards.filter((card) => card.responseType === "interest");
const inCategory = (categoryId: string) =>
  interestCards.filter((card) => card.categoryId === categoryId);

/** Enough answers to clear the minimum, all with the same interest. */
function fill(interest: "yes" | "no" | "curious", count = MIN_SCORED_ANSWERS + 2): ResponseMap {
  const responses: ResponseMap = {};
  for (const card of interestCards.slice(0, count)) responses[card.id] = { kind: "interest", interest };
  return responses;
}

describe("scoring", () => {
  it("does not fabricate a personality from no data", () => {
    const result = scoreResponses({});
    expect(result.adventureIndex).toBeNull();
    expect(result.personality.name).toBe("Not enough answers yet");
    expect(result.scoredCount).toBe(0);
  });

  it("reports insufficient information below the minimum", () => {
    const responses: ResponseMap = {};
    for (const card of interestCards.slice(0, MIN_SCORED_ANSWERS - 1)) {
      responses[card.id] = { kind: "interest", interest: "yes" };
    }
    expect(scoreResponses(responses).adventureIndex).toBeNull();
  });

  it("maps the three actions to a simple explainable scale", () => {
    expect(scoreResponses(fill("no")).adventureIndex).toBe(0);
    expect(scoreResponses(fill("curious")).adventureIndex).toBe(50);
    expect(scoreResponses(fill("yes")).adventureIndex).toBe(100);
  });

  it("excludes skipped and not-applicable rather than counting them as no", () => {
    const base = fill("yes");
    const withSkips: ResponseMap = { ...base };
    for (const card of interestCards.slice(MIN_SCORED_ANSWERS + 2, MIN_SCORED_ANSWERS + 8)) {
      withSkips[card.id] = card.id.endsWith("g") ? { kind: "skipped" } : { kind: "not_applicable" };
    }

    expect(scoreResponses(withSkips).adventureIndex).toBe(scoreResponses(base).adventureIndex);
    expect(scoreResponses(withSkips).scoredCount).toBe(scoreResponses(base).scoredCount);
  });

  it("does not let optional experience raise adventurousness", () => {
    const plain = fill("curious");
    const detailed: ResponseMap = Object.fromEntries(
      Object.entries(plain).map(([id]) => [
        id,
        { kind: "interest" as const, interest: "curious" as const, details: { experience: "tried" as const, outcome: "positive" as const } },
      ]),
    );
    expect(scoreResponses(detailed).adventureIndex).toBe(scoreResponses(plain).adventureIndex);
  });

  it("keeps communication out of the adventure index", () => {
    const responses = fill("no");
    for (const card of cards.filter((entry) => entry.categoryId === "communication")) {
      responses[card.id] = { kind: "choice", value: "very" };
    }

    const result = scoreResponses(responses);
    expect(result.communicationScore).toBe(100);
    expect(result.adventureIndex).toBe(0);
  });

  it("normalizes categories so a big one cannot dominate", () => {
    const responses: ResponseMap = {};
    for (const card of inCategory("everyday").slice(0, 6)) responses[card.id] = { kind: "interest", interest: "yes" };
    for (const card of inCategory("anal").slice(0, 1)) responses[card.id] = { kind: "interest", interest: "no" };

    // Two categories at 100 and 0 average to 50 regardless of their sizes.
    expect(scoreResponses(responses).adventureIndex).toBe(50);
  });

  it("counts hard limits separately from the score", () => {
    const responses = fill("no");
    const first = Object.keys(responses)[0];
    responses[first] = { kind: "interest", interest: "no", details: { hardLimit: true } };

    const result = scoreResponses(responses);
    expect(result.hardLimits).toBe(1);
    expect(result.adventureIndex).toBe(0);
  });

  it("uses the unfiltered names only when that tone was chosen", () => {
    expect(scoreResponses(fill("yes"), "playful").personality.name).toBe("Unfiltered Fire");
    expect(scoreResponses(fill("yes"), "unfiltered").personality.name).toBe("Certified Freak");
  });
});

describe("conditional cards", () => {
  const media = cards.find((card) => card.id === "media.categories")!;

  it("is hidden until its gate is answered the right way", () => {
    expect(isCardVisible(media, {})).toBe(false);
    expect(isCardVisible(media, { "media.watches": { kind: "choice", value: "no" } })).toBe(false);
    expect(isCardVisible(media, { "media.watches": { kind: "choice", value: "yes" } })).toBe(true);
  });

  it("is counted as unasked rather than answered no", () => {
    const result = scoreResponses({ "media.watches": { kind: "choice", value: "no" } });
    const asked = result.asked;
    const withGateOpen = scoreResponses({ "media.watches": { kind: "choice", value: "yes" } }).asked;
    expect(withGateOpen).toBeGreaterThan(asked);
  });
});
