import { z } from "zod";

import { CURRENT_QUIZ_VERSION, getCards } from "@/data/bank/registry";
import { assertCoherent, responseSchema } from "./answer";
import type { ResponseMap } from "./answer";
import { isCardVisible } from "./scoring";

export class AnswerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerValidationError";
  }
}

export const createProfileSchema = z
  .object({
    ageConfirmed: z.literal(true),
    explicitContentConfirmed: z.literal(true),
    storageConsent: z.literal(true),
    deletionUnderstood: z.literal(true),
    quizVersion: z.string().max(16),
    retentionDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    tone: z.enum(["playful", "unfiltered"]),
    alias: z.string().max(40).optional(),
    /** Keyed by stable card id. */
    responses: z.record(z.string().min(1).max(64), responseSchema),
    turnstileToken: z.string().max(2048).optional(),
    /** Set when this submission replaces the caller's existing profile. */
    replaceExisting: z.boolean().optional(),
  })
  .strict();

export type CreateProfileInput = z.infer<typeof createProfileSchema>;

/**
 * Checks a submission against the current bank. Nothing from the browser is
 * trusted: unknown ids, responses of the wrong shape for their card, values a
 * card does not offer, answers to cards that were never shown, and internally
 * contradictory details are all refused.
 */
export function validateResponses(responses: ResponseMap, quizVersion: string): ResponseMap {
  if (quizVersion !== CURRENT_QUIZ_VERSION) {
    throw new AnswerValidationError("This quiz version is no longer accepted");
  }

  const cards = new Map(getCards().map((card) => [card.id, card]));

  for (const [id, response] of Object.entries(responses)) {
    const card = cards.get(id);
    if (!card) throw new AnswerValidationError("Unknown question id");

    assertCoherent(response);

    switch (card.responseType) {
      case "interest":
        if (!["interest", "skipped", "not_applicable"].includes(response.kind)) {
          throw new AnswerValidationError("Wrong response shape for an interest card");
        }
        break;
      case "single_select": {
        if (response.kind === "skipped") break;
        if (response.kind !== "choice") throw new AnswerValidationError("Wrong response shape for a choice card");
        if (!card.options?.some((option) => option.value === response.value)) {
          throw new AnswerValidationError("Value not offered by this card");
        }
        break;
      }
      case "multi_select": {
        if (response.kind === "skipped" || response.kind === "multi_none") break;
        if (response.kind !== "multi") throw new AnswerValidationError("Wrong response shape for a multi-select card");
        const allowed = new Set<string>([
          ...(card.options ?? []).map((option) => option.value),
          ...(card.groups ?? []).flatMap((group) => group.options.map((option) => option.value)),
        ]);
        if (response.values.some((value) => !allowed.has(value))) {
          throw new AnswerValidationError("Value not offered by this card");
        }
        if (new Set(response.values).size !== response.values.length) {
          throw new AnswerValidationError("Duplicate selection");
        }
        break;
      }
    }
  }

  // A conditional card must not carry an answer when its gate was not met:
  // that would mean an answer to a question the person was never asked.
  for (const [id, card] of cards) {
    if (!card.showWhen || !responses[id]) continue;
    if (!isCardVisible(card, responses)) {
      throw new AnswerValidationError("Answer to a question that was not asked");
    }
  }

  return responses;
}
