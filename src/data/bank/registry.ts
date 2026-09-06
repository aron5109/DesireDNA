import type { QuestionCard } from "@/lib/quiz/bank-types";
import type { Question } from "@/lib/quiz/types";

import { QUIZ_VERSION_V2, getV2Questions } from "./v2-frozen";
import { BANK_V3, QUIZ_VERSION_V3, RACE_SENSITIVE_CARD } from "./v3";

/**
 * Version-aware access to question banks.
 *
 * A stored profile is always interpreted with the bank it was created under —
 * never with "whatever is current". Interpreting old answers against a new bank
 * would silently reattach them to different questions.
 */

export const CURRENT_QUIZ_VERSION = QUIZ_VERSION_V3;
export { QUIZ_VERSION_V2, QUIZ_VERSION_V3 };

/** Versions this build can still read. */
export const KNOWN_VERSIONS = [QUIZ_VERSION_V3, QUIZ_VERSION_V2] as const;
export type KnownVersion = (typeof KNOWN_VERSIONS)[number];

export const isKnownVersion = (version: string): version is KnownVersion =>
  (KNOWN_VERSIONS as readonly string[]).includes(version);

const raceSensitiveEnabled = () => process.env.NEXT_PUBLIC_ENABLE_RACE_SENSITIVE_ITEMS === "true";

/**
 * The current bank. In development and test runs only, a flag can shorten it to
 * one card per category so end-to-end runs stay quick; production builds ignore
 * the flag entirely.
 */
export function getCards(): QuestionCard[] {
  const cards = raceSensitiveEnabled() ? [...BANK_V3.cards, RACE_SENSITIVE_CARD] : [...BANK_V3.cards];

  if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_E2E_SHORT_QUIZ === "true") {
    const firstOfEach = new Map<string, QuestionCard>();
    for (const card of cards) {
      // Conditional cards depend on a gate that the short bank may drop.
      if (card.showWhen) continue;
      if (!firstOfEach.has(card.categoryId)) firstOfEach.set(card.categoryId, card);
    }
    return [...firstOfEach.values()];
  }

  return cards;
}

/** Cards for a specific version, or null when that version is not the current one. */
export function getCardsForVersion(version: string): QuestionCard[] | null {
  return version === QUIZ_VERSION_V3 ? getCards() : null;
}

/** The frozen legacy bank, used only to read existing v2 profiles. */
export function getLegacyQuestions(version: string): Question[] | null {
  return version === QUIZ_VERSION_V2 ? getV2Questions() : null;
}

/**
 * Two profiles may be compared only when their versions share an answer model.
 * v2 and v3 record different things, so they are never mixed.
 */
export function versionsAreComparable(a: string, b: string): boolean {
  if (!isKnownVersion(a) || !isKnownVersion(b)) return false;
  return a === b;
}

export const cardById = (id: string): QuestionCard | undefined =>
  getCards().find((card) => card.id === id);
