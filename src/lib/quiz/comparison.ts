import { getQuestions } from "@/data/questions";
import type { ProfilePayload, ShareMode } from "./types";

export interface Comparison {
  alignment: number;
  mutuallyAnswered: number;
  strongMatches: string[];
  sharedCuriosities: string[];
  /** Aggregate count only — never the specific boundaries. */
  sharedBoundaries: number;
  categoryAlignment: Record<string, number>;
  categoryLabels: Record<string, string>;
  mutualPornCategories: string[];
  mode: ShareMode;
  /** Non-identifying display handles, safe to show to both adults. */
  selfAlias: string;
  partnerAlias: string;
  /** Present only when both profiles independently opted into full comparison. */
  talkItThrough?: string[];
  boundaryMismatches?: string[];
}

const isComparable = (value: string | string[] | undefined): value is string =>
  typeof value === "string" && value !== "prefer_not_to_answer";

/**
 * Derives the permitted comparison for two profiles. Only aggregate, mutual
 * information leaves this function: raw answers, one-sided interests, skips,
 * and (in mutual-only mode) every difference stay private.
 */
export function compareProfiles(self: ProfilePayload, partner: ProfilePayload): Comparison {
  const selfAnswers = new Map(self.answers.map((answer) => [answer.questionId, answer.value]));
  const partnerAnswers = new Map(partner.answers.map((answer) => [answer.questionId, answer.value]));

  const strongMatches: string[] = [];
  const sharedCuriosities: string[] = [];
  const talkItThrough: string[] = [];
  const boundaryMismatches: string[] = [];
  const alignmentByCategory = new Map<string, number[]>();
  const categoryLabels: Record<string, string> = {};

  let mutuallyAnswered = 0;

  for (const question of getQuestions()) {
    if (!question.comparisonEnabled) continue;

    const selfValue = selfAnswers.get(question.id);
    const partnerValue = partnerAnswers.get(question.id);
    if (!isComparable(selfValue) || !isComparable(partnerValue)) continue;

    const selfOption = question.answerOptions.find((option) => option.value === selfValue);
    const partnerOption = question.answerOptions.find((option) => option.value === partnerValue);
    if (selfOption?.score === undefined || partnerOption?.score === undefined) continue;

    mutuallyAnswered++;
    const lowest = Math.min(selfOption.score, partnerOption.score);
    const highest = Math.max(selfOption.score, partnerOption.score);
    const curious =
      selfValue === "want_to_try" ||
      selfValue === "maybe_conditions" ||
      partnerValue === "want_to_try" ||
      partnerValue === "maybe_conditions";

    if (lowest >= 70) strongMatches.push(question.shortLabel);
    else if (lowest >= 40 && curious) sharedCuriosities.push(question.shortLabel);

    if (highest >= 70 && lowest >= 25 && lowest <= 55) talkItThrough.push(question.shortLabel);
    if (
      (selfValue === "hard_limit" && partnerOption.score >= 70) ||
      (partnerValue === "hard_limit" && selfOption.score >= 70)
    ) {
      boundaryMismatches.push(question.shortLabel);
    }

    const scores = alignmentByCategory.get(question.categoryId) ?? [];
    scores.push(100 - Math.abs(selfOption.score - partnerOption.score));
    alignmentByCategory.set(question.categoryId, scores);
    categoryLabels[question.categoryId] = question.categoryLabel;
  }

  const categoryAlignment = Object.fromEntries(
    [...alignmentByCategory].map(([categoryId, scores]) => [
      categoryId,
      Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    ]),
  );
  const categoryValues = Object.values(categoryAlignment);

  // Full comparison requires both adults to have opted in independently.
  const mode: ShareMode =
    self.shareMode === "full_comparison" && partner.shareMode === "full_comparison"
      ? "full_comparison"
      : "mutual_only";

  const selfMedia = selfAnswers.get("porn_categories");
  const partnerMedia = partnerAnswers.get("porn_categories");

  const comparison: Comparison = {
    alignment: categoryValues.length
      ? Math.round(categoryValues.reduce((a, b) => a + b, 0) / categoryValues.length)
      : 0,
    mutuallyAnswered,
    strongMatches,
    sharedCuriosities,
    sharedBoundaries: boundaryMismatches.length,
    categoryAlignment,
    categoryLabels,
    mutualPornCategories:
      Array.isArray(selfMedia) && Array.isArray(partnerMedia)
        ? selfMedia.filter((category) => partnerMedia.includes(category))
        : [],
    mode,
    selfAlias: self.alias,
    partnerAlias: partner.alias,
  };

  if (mode === "full_comparison") {
    comparison.talkItThrough = talkItThrough;
    comparison.boundaryMismatches = boundaryMismatches;
  }

  return comparison;
}
