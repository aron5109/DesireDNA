import { z } from "zod";

/**
 * The versioned answer model.
 *
 * Interest, experience, intent, and boundary status are separate facts. The
 * three primary card actions record interest only: a swipe must never fabricate
 * an experience or a willingness the person did not state.
 */

/** What the three primary card actions record. */
export const INTEREST_VALUES = ["no", "curious", "yes"] as const;
export type Interest = (typeof INTEREST_VALUES)[number];

/** Optional, only ever set deliberately through the details sheet. */
export const EXPERIENCE_VALUES = ["tried", "not_tried", "prefer_not_to_say"] as const;
export type Experience = (typeof EXPERIENCE_VALUES)[number];

export const OUTCOME_VALUES = ["positive", "neutral", "negative"] as const;
export type Outcome = (typeof OUTCOME_VALUES)[number];

/** Whether an interest is about real-world intent or stays a fantasy. */
export const INTENT_VALUES = ["real", "conditions", "fantasy_only"] as const;
export type Intent = (typeof INTENT_VALUES)[number];

export interface AnswerDetails {
  experience?: Experience;
  /** Only meaningful when `experience` is "tried". */
  outcome?: Outcome;
  intent?: Intent;
  /** Explicitly marked by the person — never inferred from "Not for me". */
  hardLimit?: boolean;
}

/**
 * A single response. `skipped` and `not_applicable` are distinct from "no":
 * neither is a rejection, and neither is scored.
 */
export type QuestionResponse =
  | { kind: "interest"; interest: Interest; details?: AnswerDetails }
  | { kind: "skipped" }
  | { kind: "not_applicable" }
  | { kind: "choice"; value: string }
  | { kind: "multi"; values: string[] }
  | { kind: "multi_none" };

export type ResponseMap = Record<string, QuestionResponse>;

const detailsSchema = z
  .object({
    experience: z.enum(EXPERIENCE_VALUES).optional(),
    outcome: z.enum(OUTCOME_VALUES).optional(),
    intent: z.enum(INTENT_VALUES).optional(),
    hardLimit: z.boolean().optional(),
  })
  .strict();

export const responseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interest"), interest: z.enum(INTEREST_VALUES), details: detailsSchema.optional() }).strict(),
  z.object({ kind: z.literal("skipped") }).strict(),
  z.object({ kind: z.literal("not_applicable") }).strict(),
  z.object({ kind: z.literal("choice"), value: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal("multi"), values: z.array(z.string().min(1).max(64)).min(1).max(40) }).strict(),
  z.object({ kind: z.literal("multi_none") }).strict(),
]);

export class ContradictoryAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContradictoryAnswerError";
  }
}

/**
 * Rejects internally inconsistent responses. These combinations cannot be
 * produced by the interface, so their presence means a hand-built payload.
 */
export function assertCoherent(response: QuestionResponse): void {
  if (response.kind !== "interest") return;
  const details = response.details;
  if (!details) return;

  if (details.hardLimit && response.interest !== "no") {
    throw new ContradictoryAnswerError("A hard limit cannot be combined with interest");
  }
  if (details.hardLimit && details.intent === "real") {
    throw new ContradictoryAnswerError("A hard limit cannot also be real-world intent");
  }
  if (details.outcome && details.experience !== "tried") {
    throw new ContradictoryAnswerError("An experience outcome requires having tried it");
  }
  if (details.intent && response.interest === "no" && !details.hardLimit) {
    // "Not for me" with an intent qualifier is meaningless but harmless; only
    // reject the combination that claims real intent.
    if (details.intent === "real") {
      throw new ContradictoryAnswerError("Real-world intent contradicts 'Not for me'");
    }
  }
}

/** Interest scores. Experience and intent never raise adventurousness. */
export const INTEREST_SCORE: Record<Interest, number> = { no: 0, curious: 50, yes: 100 };

/** True when the response carries no usable interest signal. */
export function isUnscored(response: QuestionResponse | undefined): boolean {
  return !response || response.kind !== "interest";
}

export const isHardLimit = (response: QuestionResponse | undefined): boolean =>
  response?.kind === "interest" && response.details?.hardLimit === true;

export const isFantasyOnly = (response: QuestionResponse | undefined): boolean =>
  response?.kind === "interest" && response.details?.intent === "fantasy_only";

/** Affirmative present interest. Never implies experience or consent. */
export const isAffirmative = (response: QuestionResponse | undefined): boolean =>
  response?.kind === "interest" && response.interest === "yes";

export const isOpen = (response: QuestionResponse | undefined): boolean =>
  response?.kind === "interest" && (response.interest === "yes" || response.interest === "curious");

export const isCurious = (response: QuestionResponse | undefined): boolean =>
  response?.kind === "interest" && response.interest === "curious";
