export const standardValues = [
  "like_it",
  "tried_neutral",
  "tried_disliked",
  "want_to_try",
  "maybe_conditions",
  "not_interested",
  "hard_limit",
  "prefer_not_to_answer",
] as const;

export type StandardValue = (typeof standardValues)[number];

/**
 * Single-choice values are narrowed against `standardValues` at the API
 * boundary. Multi-select questions use their own curated string values.
 */
export type AnswerValue = string | string[];

export interface AnswerOption {
  value: string;
  label: string;
  score?: number;
  boundary?: boolean;
  excluded?: boolean;
}

export type ResponseType = "single_choice" | "multi_select" | "frequency" | "preference_scale";

export type QuestionRole =
  | "self"
  | "giving"
  | "receiving"
  | "watching"
  | "being_watched"
  | "mutual";

export interface Question {
  id: string;
  version: string;
  categoryId: string;
  categoryLabel: string;
  shortLabel: string;
  prompt: string;
  helpText?: string;
  responseType: ResponseType;
  role: QuestionRole;
  intensity: 1 | 2 | 3 | 4 | 5;
  answerOptions: readonly AnswerOption[];
  scoringEnabled: boolean;
  comparisonEnabled: boolean;
  sensitiveTags: readonly string[];
  sortOrder: number;
}

export interface QuizAnswer {
  questionId: string;
  value: AnswerValue;
}

export type ShareMode = "mutual_only" | "full_comparison";

export interface QuizResult {
  adventureIndex: number;
  communicationScore: number;
  categoryScores: Record<string, number>;
  categoryLabels: Record<string, string>;
  answered: number;
  skipped: number;
  hardLimits: number;
  personality: { name: string; emoji: string; description: string };
}

export interface ProfilePayload {
  answers: QuizAnswer[];
  result: QuizResult;
  desireCode: string;
  /** Non-identifying display handle assigned when the quiz was started. */
  alias: string;
  tone: "playful" | "unfiltered";
  consentTimestamp: string;
  quizVersion: string;
  retentionDays: 1 | 7 | 30;
  shareMode: ShareMode;
}
