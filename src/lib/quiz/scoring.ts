import { getCards } from "@/data/bank/registry";
import type { QuestionCard } from "./bank-types";
import { INTEREST_SCORE, isHardLimit } from "./answer";
import type { QuestionResponse, ResponseMap } from "./answer";
import type { QuizResult } from "./types";

/**
 * Result bands, keyed on the Adventure Index. Inclusive lower bounds, so the
 * same saved answers always land on the same band and the same text.
 */
const BANDS = [
  {
    min: 0,
    playful: "Soft & Selective",
    unfiltered: "Well-Behaved Angel",
    emoji: "😇",
    description:
      "You know what feels right for you and you are comfortable keeping clear boundaries. Your DesireDNA values trust, comfort, and quality over novelty.",
  },
  {
    min: 25,
    playful: "Playful & Grounded",
    unfiltered: "Sweet With Secrets",
    emoji: "🙂",
    description:
      "You enjoy variety while staying connected to familiar preferences. You are open to fun without needing every experience to be extreme.",
  },
  {
    min: 45,
    playful: "Curious Explorer",
    unfiltered: "Curious Trouble",
    emoji: "😉",
    description:
      "You have a strong mix of established interests and things you would consider trying under the right conditions.",
  },
  {
    min: 65,
    playful: "Adventurous DNA",
    unfiltered: "Freaky Devil",
    emoji: "😈",
    description:
      "You are open-minded, playful, and comfortable exploring a wide range of consensual experiences while maintaining clear personal limits.",
  },
  {
    min: 85,
    playful: "Unfiltered Fire",
    unfiltered: "Certified Freak",
    emoji: "🔥",
    description:
      "You have a highly adventurous DesireDNA and strong curiosity across several categories. Your best matches will combine openness with excellent communication and respect.",
  },
] as const;

export const COMMUNICATION_CATEGORY = "communication";

/** Below this many scored answers there is not enough to characterise anyone. */
export const MIN_SCORED_ANSWERS = 5;

/** True when a card is currently asked, given the answers so far. */
export function isCardVisible(card: QuestionCard, responses: ResponseMap): boolean {
  const condition = card.showWhen;
  if (!condition) return true;

  const gate = responses[condition.questionId];
  if (!gate) return false;
  if (condition.equals !== undefined) return gate.kind === "choice" && gate.value === condition.equals;
  if (condition.interestIn) {
    return gate.kind === "interest" && condition.interestIn.includes(gate.interest);
  }
  return true;
}

/** The score a single response contributes, or null when it must be excluded. */
function scoreOf(card: QuestionCard, response: QuestionResponse | undefined): number | null {
  if (!response || !card.scoringEnabled) return null;

  if (card.responseType === "interest") {
    // Skipped, not-applicable, and unanswered are excluded — never counted as 0.
    return response.kind === "interest" ? INTEREST_SCORE[response.interest] : null;
  }

  if (card.responseType === "single_select" && response.kind === "choice") {
    const option = card.options?.find((entry) => entry.value === response.value);
    return option?.score ?? null;
  }

  return null;
}

/**
 * Server-authoritative scoring. Each category is averaged, then the category
 * averages are averaged, so a large category cannot dominate the total.
 */
export function scoreResponses(responses: ResponseMap, tone: "playful" | "unfiltered" = "playful"): QuizResult {
  const cards = getCards();
  const totals = new Map<string, { sum: number; count: number }>();
  const categoryLabels: Record<string, string> = {};

  let answered = 0;
  let skipped = 0;
  let notApplicable = 0;
  let hardLimits = 0;
  let scoredCount = 0;
  let asked = 0;

  for (const card of cards) {
    if (!isCardVisible(card, responses)) continue;
    asked++;

    const response = responses[card.id];
    if (!response) continue;

    if (response.kind === "skipped") {
      skipped++;
      continue;
    }
    if (response.kind === "not_applicable") {
      notApplicable++;
      continue;
    }

    answered++;
    if (isHardLimit(response)) hardLimits++;

    const score = scoreOf(card, response);
    if (score === null) continue;

    scoredCount++;
    const bucket = totals.get(card.categoryId) ?? { sum: 0, count: 0 };
    bucket.sum += score;
    bucket.count++;
    totals.set(card.categoryId, bucket);
    categoryLabels[card.categoryId] = card.categoryLabel;
  }

  const categoryScores = Object.fromEntries(
    [...totals].map(([categoryId, bucket]) => [categoryId, Math.round(bucket.sum / bucket.count)]),
  );

  const adventureCategories = Object.entries(categoryScores)
    .filter(([categoryId]) => categoryId !== COMMUNICATION_CATEGORY)
    .map(([, score]) => score);

  // Without enough scored answers there is no honest index to report.
  const sufficient = scoredCount >= MIN_SCORED_ANSWERS && adventureCategories.length > 0;
  const adventureIndex = sufficient
    ? Math.round(adventureCategories.reduce((a, b) => a + b, 0) / adventureCategories.length)
    : null;

  const band = adventureIndex === null
    ? null
    : ([...BANDS].reverse().find((candidate) => adventureIndex >= candidate.min) ?? BANDS[0]);

  return {
    adventureIndex,
    communicationScore: categoryScores[COMMUNICATION_CATEGORY] ?? null,
    categoryScores,
    categoryLabels,
    answered,
    skipped,
    notApplicable,
    hardLimits,
    scoredCount,
    asked,
    personality: band
      ? {
          name: tone === "unfiltered" ? band.unfiltered : band.playful,
          emoji: band.emoji,
          description: band.description,
        }
      : {
          name: "Not enough answers yet",
          emoji: "🧬",
          description:
            "There were not enough answers to describe a profile. Take the quiz again and answer a few more cards for a result.",
        },
  };
}
