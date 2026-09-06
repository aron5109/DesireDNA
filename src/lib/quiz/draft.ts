import { z } from "zod";

import { responseSchema } from "./answer";
import type { ResponseMap } from "./answer";

/**
 * Unfinished quiz drafts.
 *
 * Answers live in sessionStorage only, never localStorage, and are versioned:
 * a draft written against an older question bank is discarded rather than
 * silently reattached to different questions.
 */

export const DRAFT_KEY = "ddna_draft";
/** Display preferences only. Never answers, results, or codes. */
export const PREFS_KEY = "ddna_prefs";

export const draftSchema = z
  .object({
    draftVersion: z.literal(1),
    quizVersion: z.string().max(16),
    cardId: z.string().max(64),
    responses: z.record(z.string().max(64), responseSchema),
    retentionDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    tone: z.enum(["playful", "unfiltered"]),
    alias: z.string().max(40),
  })
  .strict();

export type QuizDraft = z.infer<typeof draftSchema>;

export const prefsSchema = z
  .object({
    swipeEnabled: z.boolean(),
    autoAdvance: z.boolean(),
    reduceMotion: z.boolean(),
  })
  .strict();

export type QuizPrefs = z.infer<typeof prefsSchema>;

export const DEFAULT_PREFS: QuizPrefs = {
  swipeEnabled: true,
  autoAdvance: true,
  reduceMotion: false,
};

export type DraftLoad =
  | { status: "none" }
  | { status: "ok"; draft: QuizDraft }
  | { status: "incompatible" };

/** Reads a draft, tolerating unavailable, malformed, or stale storage. */
export function loadDraft(currentQuizVersion: string): DraftLoad {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(DRAFT_KEY);
  } catch {
    return { status: "none" };
  }
  if (!raw) return { status: "none" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearDraft();
    return { status: "none" };
  }

  const result = draftSchema.safeParse(parsed);
  if (!result.success) {
    clearDraft();
    return { status: "none" };
  }
  if (result.data.quizVersion !== currentQuizVersion) {
    clearDraft();
    return { status: "incompatible" };
  }
  return { status: "ok", draft: result.data };
}

/** Writes a draft. A storage failure is non-fatal: the quiz keeps working. */
export function saveDraft(draft: QuizDraft): void {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Private mode, or the quota is full. In-memory state remains the source
    // of truth for this session, so nothing is lost until the tab closes.
  }
}

export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to do.
  }
}

export function loadPrefs(): QuizPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = prefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: QuizPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience; losing them changes nothing important.
  }
}

/** Helper used by the quiz to build the draft it stores. */
export const buildDraft = (
  quizVersion: string,
  cardId: string,
  responses: ResponseMap,
  retentionDays: 1 | 7 | 30,
  tone: "playful" | "unfiltered",
  alias: string,
): QuizDraft => ({ draftVersion: 1, quizVersion, cardId, responses, retentionDays, tone, alias });
