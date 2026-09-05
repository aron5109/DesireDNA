import { z } from "zod";
import { getQuestions } from "@/data/questions";
import type { QuizAnswer } from "./types";

const answerSchema = z.object({
  questionId: z.string().min(1).max(64),
  value: z.union([z.string().max(120), z.array(z.string().max(120)).max(30)]),
});

export const createProfileSchema = z
  .object({
    ageConfirmed: z.literal(true),
    explicitContentConfirmed: z.literal(true),
    storageConsent: z.literal(true),
    deletionUnderstood: z.literal(true),
    retentionDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    tone: z.enum(["playful", "unfiltered"]),
    /** Optional: re-derived server-side when absent or not from the word list. */
    alias: z.string().max(40).optional(),
    answers: z.array(answerSchema).max(250),
  })
  .strict();

export class AnswerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerValidationError";
  }
}

/**
 * Rejects anything the current question bank does not recognise. Answers are
 * never trusted from the browser: unknown IDs, duplicates, wrong shapes, and
 * values outside a question's own option list are all refused.
 */
export function validateAnswers(answers: QuizAnswer[]): QuizAnswer[] {
  const bank = new Map(getQuestions().map((question) => [question.id, question]));
  const seen = new Set<string>();

  for (const answer of answers) {
    if (seen.has(answer.questionId)) throw new AnswerValidationError("Duplicate answer ID");
    seen.add(answer.questionId);

    const question = bank.get(answer.questionId);
    if (!question) throw new AnswerValidationError("Unknown question ID");

    const allowed = new Set([...question.answerOptions.map((option) => option.value), "prefer_not_to_answer"]);
    const values = Array.isArray(answer.value) ? answer.value : [answer.value];
    if (values.some((value) => !allowed.has(value))) throw new AnswerValidationError("Invalid answer value");

    if (question.responseType === "multi_select") {
      if (values.includes("prefer_not_to_answer") && values.length > 1) {
        throw new AnswerValidationError("Skipped answers must be selected alone");
      }
      if (new Set(values).size !== values.length) {
        throw new AnswerValidationError("Duplicate selection");
      }
    } else if (Array.isArray(answer.value)) {
      throw new AnswerValidationError("Invalid answer shape");
    }
  }

  return answers;
}
