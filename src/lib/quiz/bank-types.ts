/**
 * Question-bank types. Metadata is explicit: roles are declared, never inferred
 * from the wording of a prompt.
 */

export const ROLES = ["self", "giving", "receiving", "watching", "being_watched", "mutual"] as const;
export type Role = (typeof ROLES)[number];

/** How a role pairs up between two people for a complementary match. */
export const COMPLEMENT: Record<Role, Role> = {
  self: "self",
  mutual: "mutual",
  giving: "receiving",
  receiving: "giving",
  watching: "being_watched",
  being_watched: "watching",
};

export type CardResponseType = "interest" | "single_select" | "multi_select";

export interface SelectOption {
  value: string;
  label: string;
  /** Only for scored single-selects (the communication scale). */
  score?: number;
}

export interface QuestionCard {
  /** Stable semantic identifier. Never reused for a different topic. */
  id: string;
  /** Canonical activity, shared by the role variants of one activity. */
  activityId: string;
  role: Role;
  /** The role on the other side that makes this a complementary match. */
  compatibleRole: Role;
  categoryId: string;
  categoryLabel: string;
  /** Short topic name, e.g. "Blindfolds". */
  topic: string;
  /** The question itself, e.g. "Would you enjoy being blindfolded?" */
  prompt: string;
  /** Optional one-line clarification. */
  note?: string;
  responseType: CardResponseType;
  options?: readonly SelectOption[];
  /** Grouped options for a multi-select. */
  groups?: readonly { label: string; options: readonly SelectOption[] }[];
  scoringEnabled: boolean;
  comparisonEnabled: boolean;
  /** Shown only when this predicate holds; otherwise the card is unasked. */
  /** Shown only when the named question was answered this way. */
  showWhen?: { questionId: string; equals?: string; interestIn?: readonly ("no" | "curious" | "yes")[] };
  sensitiveTags?: readonly string[];
  /** Whether the details sheet is offered. */
  allowDetails: boolean;
}

export interface QuestionBank {
  version: string;
  cards: readonly QuestionCard[];
  /** Versions whose stored answers this bank can compare against. */
  comparableWith: readonly string[];
}
