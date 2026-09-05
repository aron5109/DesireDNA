import { afterEach, describe, expect, it, vi } from "vitest";

import { questions, raceSensitiveQuestion } from "@/data/questions";
import { scoreQuiz } from "@/lib/quiz/scoring";

const everyday = questions.find((question) => question.categoryId === "everyday")!;
const anal = questions.find((question) => question.categoryId === "anal")!;
const communication = questions.find((question) => question.categoryId === "communication")!;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("scoring", () => {
  it("excludes skips and non-scored questions", () => {
    const result = scoreQuiz([
      { questionId: everyday.id, value: "like_it" },
      { questionId: "porn_categories", value: ["Romantic"] },
    ]);

    expect(result.categoryScores[everyday.categoryId]).toBe(100);
    expect(result.categoryScores.porn).toBeUndefined();
    expect(result.answered).toBe(2);
  });

  it("treats an explicit skip as unanswered rather than as a rejection", () => {
    const result = scoreQuiz([
      { questionId: everyday.id, value: "prefer_not_to_answer" },
      { questionId: anal.id, value: "like_it" },
    ]);

    expect(result.categoryScores[everyday.categoryId]).toBeUndefined();
    expect(result.answered).toBe(1);
    expect(result.skipped).toBe(questions.length - 1);
    expect(result.adventureIndex).toBe(100);
  });

  it("normalizes categories equally", () => {
    const result = scoreQuiz([
      { questionId: everyday.id, value: "like_it" },
      { questionId: anal.id, value: "not_interested" },
    ]);
    expect(result.adventureIndex).toBe(50);
  });

  it("separates hard limits and communication", () => {
    const result = scoreQuiz([
      { questionId: everyday.id, value: "hard_limit" },
      { questionId: communication.id, value: "like_it" },
    ]);

    expect(result.hardLimits).toBe(1);
    expect(result.communicationScore).toBe(100);
    expect(result.adventureIndex).toBe(0);
  });

  it("keeps race-sensitive answers out of the score when the flag is on", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_RACE_SENSITIVE_ITEMS", "true");

    const withoutSensitive = scoreQuiz([{ questionId: everyday.id, value: "like_it" }]);
    const withSensitive = scoreQuiz([
      { questionId: everyday.id, value: "like_it" },
      { questionId: raceSensitiveQuestion.id, value: "like_it" },
    ]);

    expect(withSensitive.adventureIndex).toBe(withoutSensitive.adventureIndex);
    expect(withSensitive.categoryScores[raceSensitiveQuestion.categoryId]).toBeUndefined();
  });

  it("selects the documented personality band for each score", () => {
    const bandFor = (score: number) => {
      // Build answers that average to the requested category score.
      const option = everyday.answerOptions.find((entry) => entry.score === score);
      return option ? scoreQuiz([{ questionId: everyday.id, value: option.value }]).personality.name : null;
    };

    expect(bandFor(0)).toBe("Soft & Selective");
    expect(bandFor(45)).toBe("Curious Explorer");
    expect(bandFor(50)).toBe("Curious Explorer");
    expect(bandFor(75)).toBe("Adventurous DNA");
    expect(bandFor(100)).toBe("Unfiltered Fire");
  });

  it("uses the unfiltered names only when that tone was chosen", () => {
    const answers = [{ questionId: everyday.id, value: "like_it" }];
    expect(scoreQuiz(answers, "playful").personality.name).toBe("Unfiltered Fire");
    expect(scoreQuiz(answers, "unfiltered").personality.name).toBe("Certified Freak");
  });

  it("reports a zero index rather than failing when everything is skipped", () => {
    const result = scoreQuiz([]);
    expect(result.adventureIndex).toBe(0);
    expect(result.answered).toBe(0);
    expect(result.personality.name).toBe("Soft & Selective");
  });
});
