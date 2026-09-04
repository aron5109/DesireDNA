import { getQuestions } from "@/data/questions";
import type { QuizAnswer, QuizResult } from "./types";

/**
 * Result personalities. Thresholds are inclusive lower bounds on the
 * Adventure Index, so a profile always resolves to exactly one band and the
 * same saved answers always produce the same result text.
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

/** The category whose score is reported separately from adventurousness. */
export const COMMUNICATION_CATEGORY = "communication";

const isSkip = (value: string | string[] | undefined) =>
  value === undefined || value === "prefer_not_to_answer" || (Array.isArray(value) && value.length === 0);

/**
 * Server-authoritative scoring. Category scores are averaged per category and
 * then averaged again, so a large category cannot dominate the overall index.
 */
export function scoreQuiz(answers: QuizAnswer[], tone: "playful" | "unfiltered" = "playful"): QuizResult {
  const bank = getQuestions();
  const submitted = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  const totals = new Map<string, { sum: number; count: number }>();
  const categoryLabels: Record<string, string> = {};

  let answered = 0;
  let skipped = 0;
  let hardLimits = 0;

  for (const question of bank) {
    const value = submitted.get(question.id);
    if (isSkip(value)) {
      skipped++;
      continue;
    }
    answered++;
    if (value === "hard_limit") hardLimits++;

    // Multi-select and flagged questions are recorded but never scored.
    if (!question.scoringEnabled || Array.isArray(value)) continue;

    const option = question.answerOptions.find((candidate) => candidate.value === value);
    if (option?.score === undefined || option.excluded) continue;

    const totalsForCategory = totals.get(question.categoryId) ?? { sum: 0, count: 0 };
    totalsForCategory.sum += option.score;
    totalsForCategory.count++;
    totals.set(question.categoryId, totalsForCategory);
    categoryLabels[question.categoryId] = question.categoryLabel;
  }

  const categoryScores = Object.fromEntries(
    [...totals].map(([categoryId, total]) => [categoryId, Math.round(total.sum / total.count)]),
  );

  const adventureCategories = Object.entries(categoryScores)
    .filter(([categoryId]) => categoryId !== COMMUNICATION_CATEGORY)
    .map(([, score]) => score);
  const adventureIndex = adventureCategories.length
    ? Math.round(adventureCategories.reduce((a, b) => a + b, 0) / adventureCategories.length)
    : 0;

  const band = [...BANDS].reverse().find((candidate) => adventureIndex >= candidate.min) ?? BANDS[0];

  return {
    adventureIndex,
    communicationScore: categoryScores[COMMUNICATION_CATEGORY] ?? 0,
    categoryScores,
    categoryLabels,
    answered,
    skipped,
    hardLimits,
    personality: {
      name: tone === "unfiltered" ? band.unfiltered : band.playful,
      emoji: band.emoji,
      description: band.description,
    },
  };
}
