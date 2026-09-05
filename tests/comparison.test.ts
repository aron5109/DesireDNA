import { describe, expect, it } from "vitest";

import { compareProfiles } from "@/lib/quiz/comparison";
import { QUIZ_VERSION, questions } from "@/data/questions";
import type { ProfilePayload, QuizAnswer, ShareMode } from "@/lib/quiz/types";

const question = questions[0];

function profile(answers: QuizAnswer[], shareMode: ShareMode = "mutual_only", alias = "Velvet Orchid 4821"): ProfilePayload {
  return {
    answers,
    result: {
      adventureIndex: 0,
      communicationScore: 0,
      categoryScores: {},
      categoryLabels: {},
      answered: 0,
      skipped: 0,
      hardLimits: 0,
      personality: { name: "", emoji: "", description: "" },
    },
    desireCode: "",
    alias,
    tone: "playful",
    consentTimestamp: "",
    quizVersion: QUIZ_VERSION,
    retentionDays: 7,
    shareMode,
  };
}

describe("comparison privacy", () => {
  it("finds strong matches and curiosities", () => {
    expect(
      compareProfiles(
        profile([{ questionId: question.id, value: "like_it" }]),
        profile([{ questionId: question.id, value: "want_to_try" }]),
      ).strongMatches,
    ).toContain(question.shortLabel);

    expect(
      compareProfiles(
        profile([{ questionId: question.id, value: "maybe_conditions" }]),
        profile([{ questionId: question.id, value: "want_to_try" }]),
      ).sharedCuriosities,
    ).toContain(question.shortLabel);
  });

  it("never lists the same topic as both a match and a curiosity", () => {
    const comparison = compareProfiles(
      profile([{ questionId: question.id, value: "like_it" }]),
      profile([{ questionId: question.id, value: "want_to_try" }]),
    );
    expect(comparison.sharedCuriosities).not.toContain(question.shortLabel);
  });

  it("hides mismatch unless both opt in", () => {
    const interested: QuizAnswer[] = [{ questionId: question.id, value: "like_it" }];
    const limit: QuizAnswer[] = [{ questionId: question.id, value: "hard_limit" }];

    const oneSided = compareProfiles(profile(interested), profile(limit, "full_comparison"));
    expect(oneSided.mode).toBe("mutual_only");
    expect(oneSided.boundaryMismatches).toBeUndefined();
    expect(oneSided.talkItThrough).toBeUndefined();
    // The aggregate count is still permitted; the specific topic is not.
    expect(oneSided.sharedBoundaries).toBe(1);

    const full = compareProfiles(profile(interested, "full_comparison"), profile(limit, "full_comparison"));
    expect(full.boundaryMismatches).toContain(question.shortLabel);
  });

  it("excludes skipped answers from every section", () => {
    const comparison = compareProfiles(
      profile([{ questionId: question.id, value: "prefer_not_to_answer" }]),
      profile([{ questionId: question.id, value: "like_it" }]),
    );
    expect(comparison.mutuallyAnswered).toBe(0);
    expect(comparison.strongMatches).toHaveLength(0);
    expect(comparison.sharedCuriosities).toHaveLength(0);
    expect(comparison.sharedBoundaries).toBe(0);
  });

  it("returns adult media overlap only", () => {
    const comparison = compareProfiles(
      profile([{ questionId: "porn_categories", value: ["Romantic", "Couples"] }]),
      profile([{ questionId: "porn_categories", value: ["Romantic", "BDSM"] }]),
    );
    expect(comparison.mutualPornCategories).toEqual(["Romantic"]);
  });

  it("carries both display aliases", () => {
    const comparison = compareProfiles(
      profile([], "mutual_only", "Velvet Orchid 4821"),
      profile([], "mutual_only", "Silver Heron 0090"),
    );
    expect(comparison.selfAlias).toBe("Velvet Orchid 4821");
    expect(comparison.partnerAlias).toBe("Silver Heron 0090");
  });
});
