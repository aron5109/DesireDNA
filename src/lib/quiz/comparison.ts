import { getCards, versionsAreComparable } from "@/data/bank/registry";
import type { QuestionCard, Role } from "./bank-types";
import { isAffirmative, isCurious, isFantasyOnly, isHardLimit, isOpen } from "./answer";
import type { QuestionResponse, ResponseMap } from "./answer";
import type { ProfilePayload, ShareMode } from "./types";

/**
 * Role-aware comparison.
 *
 * Two people match on an activity when their roles fit together, not merely
 * when they answered the same card. One person giving and the other receiving
 * is complementary; both receiving is a similar taste but not an actionable
 * pairing, and the two are reported separately.
 */

export interface MatchEntry {
  /** Canonical activity, so a topic is never listed twice. */
  activityId: string;
  topic: string;
  categoryId: string;
  /** True when the two people's roles fit together rather than merely agree. */
  complementary: boolean;
  /** Set when at least one person marked the interest as fantasy only. */
  fantasyOnly: boolean;
}

export interface Comparison {
  mode: ShareMode;
  selfAlias: string;
  partnerAlias: string;

  /** Both said yes in roles that fit together. */
  strongMatches: MatchEntry[];
  /** Both open, at least one still curious. */
  sharedCuriosities: MatchEntry[];
  /** Overlap that at least one person keeps as fantasy. */
  fantasyOverlap: MatchEntry[];

  /** How many cards both people gave a comparable answer to. */
  comparableAnswers: number;
  /** Share of comparable answers where both are affirmative. Null when too few. */
  sharedInterest: number | null;
  /** How alike the two sets of answers are overall. Null when too few. */
  preferenceSimilarity: number | null;

  mutualMediaCategories: string[];

  /** Full comparison only. */
  talkItThrough?: MatchEntry[];
  boundaryMismatches?: MatchEntry[];
  /** Full comparison only: alignment across categories. */
  categoryAlignment?: Record<string, number>;
  categoryLabels?: Record<string, string>;
}

export class IncompatibleVersionsError extends Error {
  constructor() {
    super("These profiles were created with different versions of the quiz.");
    this.name = "IncompatibleVersionsError";
  }
}

/** Below this, any percentage would be noise and could expose single answers. */
export const MIN_COMPARABLE_ANSWERS = 8;

/** Do the two roles fit together on the same activity? */
function rolesFit(a: Role, b: Role): boolean {
  return a === b || a === COMPLEMENT_OF[b];
}

const COMPLEMENT_OF: Record<Role, Role> = {
  self: "self",
  mutual: "mutual",
  giving: "receiving",
  receiving: "giving",
  watching: "being_watched",
  being_watched: "watching",
};

/** Complementary means the roles differ but fit — giving with receiving. */
const isComplementary = (a: Role, b: Role) => a !== b && COMPLEMENT_OF[a] === b;

interface Pairing {
  activityId: string;
  topic: string;
  categoryId: string;
  self: QuestionResponse;
  partner: QuestionResponse;
  complementary: boolean;
}

/**
 * Every role-compatible pairing between two people, for each activity.
 *
 * All of them are returned rather than one per activity: collapsing early
 * could hide a hard limit recorded against one role while another role
 * happened to match. De-duplication happens per output list instead, so a
 * topic is still only ever shown once.
 */
function pairUp(cards: QuestionCard[], mine: ResponseMap, theirs: ResponseMap): Pairing[] {
  const byActivity = new Map<string, QuestionCard[]>();
  for (const card of cards) {
    if (!card.comparisonEnabled || card.responseType !== "interest") continue;
    const list = byActivity.get(card.activityId) ?? [];
    list.push(card);
    byActivity.set(card.activityId, list);
  }

  const pairings: Pairing[] = [];

  for (const [activityId, activityCards] of byActivity) {
    for (const mineCard of activityCards) {
      const myResponse = mine[mineCard.id];
      if (!myResponse || myResponse.kind !== "interest") continue;

      for (const theirCard of activityCards) {
        const theirResponse = theirs[theirCard.id];
        if (!theirResponse || theirResponse.kind !== "interest") continue;
        if (!rolesFit(mineCard.role, theirCard.role)) continue;

        pairings.push({
          activityId,
          topic: mineCard.topic,
          categoryId: mineCard.categoryId,
          self: myResponse,
          partner: theirResponse,
          complementary: isComplementary(mineCard.role, theirCard.role),
        });
      }
    }
  }

  return pairings;
}

/** Keeps one entry per activity, preferring a complementary pairing. */
function dedupe(entries: MatchEntry[]): MatchEntry[] {
  const best = new Map<string, MatchEntry>();
  for (const entry of entries) {
    const existing = best.get(entry.activityId);
    if (!existing || (entry.complementary && !existing.complementary)) best.set(entry.activityId, entry);
  }
  return [...best.values()];
}

const toEntry = (pairing: Pairing): MatchEntry => ({
  activityId: pairing.activityId,
  topic: pairing.topic,
  categoryId: pairing.categoryId,
  complementary: pairing.complementary,
  fantasyOnly: isFantasyOnly(pairing.self) || isFantasyOnly(pairing.partner),
});

/** Media categories are compared as a plain intersection, never one-sided. */
function mutualMedia(mine: ResponseMap, theirs: ResponseMap, cards: QuestionCard[]): string[] {
  const mediaCard = cards.find((card) => card.id === "media.categories");
  if (!mediaCard?.comparisonEnabled) return [];

  const mineResponse = mine[mediaCard.id];
  const theirsResponse = theirs[mediaCard.id];
  if (mineResponse?.kind !== "multi" || theirsResponse?.kind !== "multi") return [];

  const labels = new Map<string, string>();
  for (const group of mediaCard.groups ?? []) {
    for (const option of group.options) labels.set(option.value, option.label);
  }
  for (const option of mediaCard.options ?? []) labels.set(option.value, option.label);

  const theirSet = new Set(theirsResponse.values);
  return mineResponse.values.filter((value) => theirSet.has(value)).map((value) => labels.get(value) ?? value);
}

export function compareProfiles(self: ProfilePayload, partner: ProfilePayload): Comparison {
  if (!versionsAreComparable(self.quizVersion, partner.quizVersion)) {
    throw new IncompatibleVersionsError();
  }

  const cards = getCards();
  const mine = self.responses ?? {};
  const theirs = partner.responses ?? {};
  const pairings = pairUp(cards, mine, theirs);

  const strongMatches: MatchEntry[] = [];
  const sharedCuriosities: MatchEntry[] = [];
  const fantasyOverlap: MatchEntry[] = [];
  const talkItThrough: MatchEntry[] = [];
  const boundaryMismatches: MatchEntry[] = [];
  const alignmentByCategory = new Map<string, number[]>();
  const categoryLabels: Record<string, string> = {};

  const cardsByCategory = new Map(cards.map((card) => [card.categoryId, card.categoryLabel]));

  const affirmativeActivities = new Set<string>();
  const comparedActivities = new Set<string>();
  const bestPerActivity = new Map<string, number>();

  for (const pairing of pairings) {
    const entry = toEntry(pairing);
    comparedActivities.add(pairing.activityId);

    const bothOpen = isOpen(pairing.self) && isOpen(pairing.partner);
    const bothYes = isAffirmative(pairing.self) && isAffirmative(pairing.partner);

    if (bothYes) {
      affirmativeActivities.add(pairing.activityId);
      if (entry.fantasyOnly) fantasyOverlap.push(entry);
      else strongMatches.push(entry);
    } else if (bothOpen && (isCurious(pairing.self) || isCurious(pairing.partner))) {
      if (entry.fantasyOnly) fantasyOverlap.push(entry);
      else sharedCuriosities.push(entry);
    }

    // One keen, one not — a conversation, never a nudge.
    if (isAffirmative(pairing.self) !== isAffirmative(pairing.partner) && !bothOpen) talkItThrough.push(entry);

    // Checked across every role pairing, so a boundary can never be hidden by
    // a different role on the same activity matching.
    const limitAgainstInterest =
      (isHardLimit(pairing.self) && isOpen(pairing.partner)) ||
      (isHardLimit(pairing.partner) && isOpen(pairing.self));
    if (limitAgainstInterest) boundaryMismatches.push(entry);

    // Similarity uses the closest pairing for each activity.
    const closeness = 100 - Math.abs(interestValue(pairing.self) - interestValue(pairing.partner));
    const previous = bestPerActivity.get(pairing.activityId);
    if (previous === undefined || closeness > previous) {
      bestPerActivity.set(pairing.activityId, closeness);
      const scores = alignmentByCategory.get(pairing.categoryId) ?? [];
      scores.push(closeness);
      alignmentByCategory.set(pairing.categoryId, scores);
      categoryLabels[pairing.categoryId] = cardsByCategory.get(pairing.categoryId) ?? pairing.categoryId;
    }
  }

  const comparableAnswers = comparedActivities.size;
  const enough = comparableAnswers >= MIN_COMPARABLE_ANSWERS;

  // Shared rejection is not shared desire, so the two are reported apart:
  // sharedInterest counts only what both actually want.
  const sharedInterest = enough ? Math.round((affirmativeActivities.size / comparableAnswers) * 100) : null;
  const similarityScores = [...bestPerActivity.values()];
  const preferenceSimilarity = enough
    ? Math.round(similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length)
    : null;

  const mode: ShareMode =
    self.shareMode === "full_comparison" && partner.shareMode === "full_comparison"
      ? "full_comparison"
      : "mutual_only";

  const comparison: Comparison = {
    mode,
    selfAlias: self.alias,
    partnerAlias: partner.alias,
    strongMatches: dedupe(strongMatches),
    sharedCuriosities: dedupe(sharedCuriosities).filter(
      (entry) => !strongMatches.some((match) => match.activityId === entry.activityId),
    ),
    fantasyOverlap: dedupe(fantasyOverlap),
    comparableAnswers,
    sharedInterest,
    preferenceSimilarity,
    mutualMediaCategories: mutualMedia(mine, theirs, cards),
  };

  // Everything below is a private difference. In mutual-only mode none of it
  // leaves the server — not the entries, and not their counts.
  if (mode === "full_comparison") {
    comparison.talkItThrough = dedupe(talkItThrough).filter(
      (entry) =>
        !strongMatches.some((match) => match.activityId === entry.activityId) &&
        !boundaryMismatches.some((match) => match.activityId === entry.activityId),
    );
    comparison.boundaryMismatches = dedupe(boundaryMismatches);
    comparison.categoryAlignment = Object.fromEntries(
      [...alignmentByCategory]
        // A category with one or two answers would expose individual responses.
        .filter(([, scores]) => scores.length >= 3)
        .map(([categoryId, scores]) => [
          categoryId,
          Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        ]),
    );
    comparison.categoryLabels = categoryLabels;
  }

  return comparison;
}

const interestValue = (response: QuestionResponse): number =>
  response.kind === "interest" ? { no: 0, curious: 50, yes: 100 }[response.interest] : 0;
