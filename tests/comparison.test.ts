import { describe, expect, it } from "vitest";

import { CURRENT_QUIZ_VERSION, getCards } from "@/data/bank/registry";
import { QUIZ_VERSION_V2 } from "@/data/bank/v2-frozen";
import type { Interest, ResponseMap } from "@/lib/quiz/answer";
import { IncompatibleVersionsError, MIN_COMPARABLE_ANSWERS, compareProfiles } from "@/lib/quiz/comparison";
import type { ProfilePayload, ShareMode } from "@/lib/quiz/types";

const cards = getCards();
const interestCards = cards.filter((card) => card.responseType === "interest" && card.comparisonEnabled);

const byId = (id: string) => cards.find((card) => card.id === id)!;

function profile(
  responses: ResponseMap,
  shareMode: ShareMode = "mutual_only",
  alias = "Velvet Orchid 4821",
  quizVersion = CURRENT_QUIZ_VERSION,
): ProfilePayload {
  return {
    responses,
    result: {
      adventureIndex: null,
      communicationScore: null,
      categoryScores: {},
      categoryLabels: {},
      answered: 0,
      skipped: 0,
      notApplicable: 0,
      hardLimits: 0,
      scoredCount: 0,
      asked: 0,
      personality: { name: "", emoji: "", description: "" },
    },
    desireCode: "",
    alias,
    tone: "playful",
    consentTimestamp: "",
    quizVersion,
    retentionDays: 7,
    shareMode,
  };
}

/**
 * Fills enough distinct activities for a percentage to be reported. One card
 * per activity, since the comparison reports each activity once.
 */
function bulk(interest: Interest, count = MIN_COMPARABLE_ANSWERS + 2): ResponseMap {
  const responses: ResponseMap = {};
  const seen = new Set<string>();
  for (const card of interestCards) {
    if (seen.has(card.activityId)) continue;
    seen.add(card.activityId);
    responses[card.id] = { kind: "interest", interest };
    if (seen.size >= count) break;
  }
  return responses;
}

describe("role-aware matching", () => {
  const giving = byId("oral.giving");
  const receiving = byId("oral.receiving");

  it("matches one person giving with the other receiving", () => {
    const comparison = compareProfiles(
      profile({ [giving.id]: { kind: "interest", interest: "yes" } }),
      profile({ [receiving.id]: { kind: "interest", interest: "yes" } }),
    );

    const match = comparison.strongMatches.find((entry) => entry.activityId === "oral_sex");
    expect(match).toBeDefined();
    expect(match?.complementary).toBe(true);
  });

  it("does not call two people in the same role complementary", () => {
    const comparison = compareProfiles(
      profile({ [receiving.id]: { kind: "interest", interest: "yes" } }),
      profile({ [receiving.id]: { kind: "interest", interest: "yes" } }),
    );

    const match = comparison.strongMatches.find((entry) => entry.activityId === "oral_sex");
    expect(match).toBeDefined();
    expect(match?.complementary).toBe(false);
  });

  it("counts one activity once even when several cards touch it", () => {
    const comparison = compareProfiles(
      profile({
        [giving.id]: { kind: "interest", interest: "yes" },
        [receiving.id]: { kind: "interest", interest: "yes" },
      }),
      profile({
        [giving.id]: { kind: "interest", interest: "yes" },
        [receiving.id]: { kind: "interest", interest: "yes" },
      }),
    );

    const oral = comparison.strongMatches.filter((entry) => entry.activityId === "oral_sex");
    expect(oral).toHaveLength(1);
  });

  it("pairs watching with being watched", () => {
    const comparison = compareProfiles(
      profile({ "watching.partner_solo": { kind: "interest", interest: "yes" } }),
      profile({ "watching.being_watched_solo": { kind: "interest", interest: "yes" } }),
    );
    expect(comparison.strongMatches.some((entry) => entry.complementary)).toBe(true);
  });
});

describe("match categories", () => {
  const card = interestCards[0];

  it("separates curiosity from proven keenness", () => {
    const comparison = compareProfiles(
      profile({ [card.id]: { kind: "interest", interest: "curious" } }),
      profile({ [card.id]: { kind: "interest", interest: "yes" } }),
    );
    expect(comparison.sharedCuriosities.map((entry) => entry.activityId)).toContain(card.activityId);
    expect(comparison.strongMatches).toHaveLength(0);
  });

  it("labels fantasy-only overlap separately from a plan", () => {
    const comparison = compareProfiles(
      profile({ [card.id]: { kind: "interest", interest: "yes", details: { intent: "fantasy_only" } } }),
      profile({ [card.id]: { kind: "interest", interest: "yes" } }),
    );
    expect(comparison.fantasyOverlap.map((entry) => entry.activityId)).toContain(card.activityId);
    expect(comparison.strongMatches).toHaveLength(0);
  });

  it("excludes skipped answers from every section", () => {
    const comparison = compareProfiles(
      profile({ [card.id]: { kind: "skipped" } }),
      profile({ [card.id]: { kind: "interest", interest: "yes" } }),
    );
    expect(comparison.comparableAnswers).toBe(0);
    expect(comparison.strongMatches).toHaveLength(0);
  });
});

describe("privacy", () => {
  const card = interestCards[0];
  const keen: ResponseMap = { [card.id]: { kind: "interest", interest: "yes" } };
  const limit: ResponseMap = {
    [card.id]: { kind: "interest", interest: "no", details: { hardLimit: true } },
  };

  it("discloses nothing about differences in mutual-only mode, not even a count", () => {
    const comparison = compareProfiles(profile(keen), profile(limit));

    expect(comparison.mode).toBe("mutual_only");
    expect(comparison.boundaryMismatches).toBeUndefined();
    expect(comparison.talkItThrough).toBeUndefined();
    expect(comparison.categoryAlignment).toBeUndefined();

    // The old build leaked the mismatch count through a "shared boundaries"
    // field. Nothing in the response may carry it.
    const serialised = JSON.stringify(comparison);
    expect(serialised).not.toContain("sharedBoundaries");
    expect(serialised).not.toContain(card.topic);
  });

  it("requires both profiles to opt in before revealing differences", () => {
    const oneSided = compareProfiles(profile(keen), profile(limit, "full_comparison"));
    expect(oneSided.mode).toBe("mutual_only");
    expect(oneSided.boundaryMismatches).toBeUndefined();

    const both = compareProfiles(profile(keen, "full_comparison"), profile(limit, "full_comparison"));
    expect(both.mode).toBe("full_comparison");
    expect(both.boundaryMismatches?.map((entry) => entry.activityId)).toContain(card.activityId);
  });

  it("never returns raw answers", () => {
    const serialised = JSON.stringify(compareProfiles(profile(bulk("yes")), profile(bulk("yes"))));
    expect(serialised).not.toContain('"kind"');
    expect(serialised).not.toContain("hardLimit");
    expect(serialised).not.toContain("details");
  });

  it("suppresses tiny-denominator category aggregates", () => {
    const single: ResponseMap = { [card.id]: { kind: "interest", interest: "yes" } };
    const comparison = compareProfiles(
      profile(single, "full_comparison"),
      profile(single, "full_comparison"),
    );
    // One answer in a category would expose that answer.
    expect(comparison.categoryAlignment?.[card.categoryId]).toBeUndefined();
  });
});

describe("percentages", () => {
  it("does not present shared rejection as shared desire", () => {
    const comparison = compareProfiles(profile(bulk("no")), profile(bulk("no")));

    expect(comparison.sharedInterest).toBe(0);
    // They agree completely, and that is reported separately.
    expect(comparison.preferenceSimilarity).toBe(100);
  });

  it("reports null rather than 0% when there is too little to compare", () => {
    const card = interestCards[0];
    const comparison = compareProfiles(
      profile({ [card.id]: { kind: "interest", interest: "yes" } }),
      profile({ [card.id]: { kind: "interest", interest: "yes" } }),
    );

    expect(comparison.comparableAnswers).toBeLessThan(MIN_COMPARABLE_ANSWERS);
    expect(comparison.sharedInterest).toBeNull();
    expect(comparison.preferenceSimilarity).toBeNull();
  });

  it("counts only mutual keenness as shared interest", () => {
    const comparison = compareProfiles(profile(bulk("yes")), profile(bulk("yes")));
    expect(comparison.sharedInterest).toBe(100);
  });
});

describe("media and versions", () => {
  it("returns only the media categories both people picked", () => {
    const comparison = compareProfiles(
      profile({
        "media.watches": { kind: "choice", value: "yes" },
        "media.categories": { kind: "multi", values: ["romantic", "couples"] },
      }),
      profile({
        "media.watches": { kind: "choice", value: "yes" },
        "media.categories": { kind: "multi", values: ["romantic", "bdsm"] },
      }),
    );

    expect(comparison.mutualMediaCategories).toEqual(["Romantic"]);
    expect(JSON.stringify(comparison)).not.toContain("BDSM");
  });

  it("refuses to compare profiles from different quiz versions", () => {
    expect(() =>
      compareProfiles(profile({}), profile({}, "mutual_only", "Silver Heron 0090", QUIZ_VERSION_V2)),
    ).toThrow(IncompatibleVersionsError);
  });

  it("carries both display aliases", () => {
    const comparison = compareProfiles(
      profile({}, "mutual_only", "Velvet Orchid 4821"),
      profile({}, "mutual_only", "Silver Heron 0090"),
    );
    expect(comparison.selfAlias).toBe("Velvet Orchid 4821");
    expect(comparison.partnerAlias).toBe("Silver Heron 0090");
  });
});
