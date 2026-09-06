"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Check, Heart, HelpCircle, RotateCcw, Settings, X } from "lucide-react";

import { CURRENT_QUIZ_VERSION, getCards } from "@/data/bank/registry";
import { generateAlias } from "@/lib/quiz/alias";
import type { Interest, QuestionResponse, ResponseMap } from "@/lib/quiz/answer";
import type { QuestionCard } from "@/lib/quiz/bank-types";
import { DEFAULT_PREFS, buildDraft, clearDraft, loadDraft, loadPrefs, savePrefs, saveDraft } from "@/lib/quiz/draft";
import type { QuizPrefs } from "@/lib/quiz/draft";
import { isCardVisible } from "@/lib/quiz/scoring";
import { BrandMark } from "./BrandMark";
import { DetailsSheet } from "./DetailsSheet";
import { SwipeCard } from "./SwipeCard";
import { useTurnstile } from "./TurnstileGate";

const CONSENT_POINTS = [
  "I confirm that I am at least 18 years old.",
  "I understand that this quiz contains explicit adult questions.",
  "I explicitly consent to the processing and encrypted storage of my answers for the purpose of creating my result and comparisons I initiate.",
  "I understand that I can skip any question and permanently delete my profile.",
];

type Phase = "consent" | "quiz" | "review" | "saving";

/** Subscribes to the OS reduced-motion setting without a state update on mount. */
function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

type DraftPresence = "none" | "current" | "stale";

/** Reports whether a draft is waiting, without reading storage during render on the server. */
function useDraftPresence(): DraftPresence {
  return useSyncExternalStore(
    () => () => undefined,
    () => {
      const loaded = loadDraft(CURRENT_QUIZ_VERSION);
      return loaded.status === "ok" ? "current" : loaded.status === "incompatible" ? "stale" : "none";
    },
    () => "none" as DraftPresence,
  );
}

export function QuizExperience() {
  const router = useRouter();
  const allCards = useMemo(() => getCards(), []);

  const [phase, setPhase] = useState<Phase>("consent");
  const [checks, setChecks] = useState([false, false, false, false]);
  const [retention, setRetention] = useState<1 | 7 | 30>(7);
  const [tone, setTone] = useState<"playful" | "unfiltered">("playful");
  const [alias, setAlias] = useState("");
  const [responses, setResponses] = useState<ResponseMap>({});
  const [cardId, setCardId] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<QuizPrefs>(() =>
    typeof window === "undefined" ? DEFAULT_PREFS : loadPrefs(),
  );
  const systemReducedMotion = useSystemReducedMotion();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");
  const [setupProblems, setSetupProblems] = useState<string[]>([]);
  const [status, setStatus] = useState("");

  const submitting = useRef(false);
  const turnstile = useTurnstile("create_profile");
  const liveRegion = useRef<HTMLParagraphElement>(null);

  /** Cards currently in play, after conditional gates are resolved. */
  const visibleCards = useMemo(
    () => allCards.filter((card) => isCardVisible(card, responses)),
    [allCards, responses],
  );

  const index = cardId ? visibleCards.findIndex((card) => card.id === cardId) : 0;
  const current: QuestionCard | undefined = index >= 0 ? visibleCards[index] : visibleCards[0];
  const answeredCount = visibleCards.filter((card) => responses[card.id]).length;
  const reduceMotion = prefs.reduceMotion || systemReducedMotion;

  // Whether a draft exists is read through a store so the server and the first
  // client render agree; the draft itself is loaded when the person starts.
  const draftPresent = useDraftPresence();

  // Persist the draft whenever the quiz state moves.
  useEffect(() => {
    if (phase !== "quiz" && phase !== "review") return;
    if (!alias) return;
    saveDraft(buildDraft(CURRENT_QUIZ_VERSION, current?.id ?? "", responses, retention, tone, alias));
  }, [phase, current?.id, responses, retention, tone, alias]);

  const setPreference = useCallback((next: Partial<QuizPrefs>) => {
    setPrefs((previous) => {
      const merged = { ...previous, ...next };
      savePrefs(merged);
      return merged;
    });
  }, []);

  /** Loads any saved draft, then starts. Reading storage here keeps it out of render. */
  function begin() {
    const loaded = loadDraft(CURRENT_QUIZ_VERSION);
    if (loaded.status === "ok") {
      setResponses(loaded.draft.responses);
      setRetention(loaded.draft.retentionDays);
      setTone(loaded.draft.tone);
      setAlias(loaded.draft.alias || generateAlias());
      setCardId(loaded.draft.cardId || visibleCards[0]?.id || null);
      setPhase("quiz");
      return;
    }

    setAlias((existing) => existing || generateAlias());
    if (!cardId && visibleCards[0]) setCardId(visibleCards[0].id);
    setPhase("quiz");
  }

  /** Moves forward one card, or to the review screen at the end. */
  const advance = useCallback(
    (from: QuestionCard, nextResponses: ResponseMap) => {
      const remaining = allCards.filter((card) => isCardVisible(card, nextResponses));
      const position = remaining.findIndex((card) => card.id === from.id);
      const next = remaining[position + 1];

      if (next) {
        setHistory((stack) => [...stack, from.id]);
        setCardId(next.id);
      } else {
        setPhase("review");
      }
    },
    [allCards],
  );

  const record = useCallback(
    (response: QuestionResponse, options: { advance?: boolean } = {}) => {
      if (!current) return;
      const next: ResponseMap = { ...responses, [current.id]: response };
      setResponses(next);
      if (options.advance ?? prefs.autoAdvance) advance(current, next);
    },
    [advance, current, prefs.autoAdvance, responses],
  );

  const answerInterest = useCallback(
    (interest: Interest) => {
      if (!current) return;
      const existing = responses[current.id];
      const details = existing?.kind === "interest" ? existing.details : undefined;
      // A hard limit only survives a "Not for me"; any other answer clears it.
      const kept = interest === "no" ? details : details && { ...details, hardLimit: undefined };
      record({ kind: "interest", interest, ...(kept && Object.keys(kept).length ? { details: kept } : {}) });
    },
    [current, record, responses],
  );

  const undo = useCallback(() => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((stack) => stack.slice(0, -1));
    setCardId(previous);
    setPhase("quiz");
  }, [history]);

  // Announce each new card for screen readers.
  useEffect(() => {
    if (phase !== "quiz" || !current) return;
    if (liveRegion.current) {
      liveRegion.current.textContent = `${current.categoryLabel}. Question ${index + 1} of ${visibleCards.length}. ${current.prompt}`;
    }
  }, [phase, current, index, visibleCards.length]);

  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setPhase("saving");
    setError("");
    setSetupProblems([]);
    setStatus("Sequencing your DesireDNA");

    const submittedAlias = alias || generateAlias();
    // Requested here rather than at the start: a token minted before a long
    // quiz would have expired by now.
    const turnstileToken = await turnstile.handle.getToken();

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20_000);
      let response: Response;
      try {
        // The request starts immediately; the animation runs alongside it
        // rather than delaying it.
        response = await fetch("/api/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            ageConfirmed: true,
            explicitContentConfirmed: true,
            storageConsent: true,
            deletionUnderstood: true,
            quizVersion: CURRENT_QUIZ_VERSION,
            retentionDays: retention,
            tone,
            alias: submittedAlias,
            responses,
            ...(turnstileToken ? { turnstileToken } : {}),
          }),
        });
      } finally {
        window.clearTimeout(timeout);
      }

      if (!response.ok) {
        turnstile.handle.reset();
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          missingConfiguration?: string[];
          invalidConfiguration?: { name: string; reason: string }[];
        };
        setSetupProblems([
          ...(data.missingConfiguration ?? []).map((name) => `${name} is not set`),
          ...(data.invalidConfiguration ?? []).map((entry) => `${entry.name} ${entry.reason}`),
        ]);
        throw new Error(data.error ?? "We could not save your profile.");
      }

      // Only cleared once the server has confirmed the save.
      clearDraft();
      router.replace("/results");
    } catch (reason) {
      setError(
        reason instanceof DOMException && reason.name === "AbortError"
          ? "That took too long. Your answers are still here — try again."
          : reason instanceof Error
            ? reason.message
            : "We could not create your result. Please try again.",
      );
      setPhase("review");
    } finally {
      submitting.current = false;
    }
  }

  // ------------------------------------------------------------------ consent
  if (phase === "consent") {
    const allChecked = checks.every(Boolean);
    return (
      <section className="card my-6 p-5 md:p-8">
        <BrandMark />
        <p className="eyebrow mt-6">Before we start</p>
        <h1 className="mt-2 text-3xl font-semibold">A few ground rules</h1>
        <p className="mt-3 text-muted">
          Everyone involved is a consenting adult who can stop at any time. Recording, being watched, and anything
          involving other people always needs everyone&rsquo;s explicit agreement, every time.
        </p>

        {draftPresent === "current" && (
          <p className="mt-4 rounded-xl border border-white/15 bg-white/5 p-3 text-sm">
            Unfinished answers from this tab were found. Confirming below picks up where you left off.
          </p>
        )}
        {draftPresent === "stale" && (
          <p className="mt-4 rounded-xl border border-white/15 bg-white/5 p-3 text-sm">
            The quiz has changed since your last unfinished attempt, so this one starts fresh.
          </p>
        )}

        <div className="my-6 space-y-2">
          {CONSENT_POINTS.map((label, position) => (
            <label key={label} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-3">
              <input
                type="checkbox"
                checked={checks[position]}
                onChange={() => setChecks((current) => current.map((value, i) => (i === position ? !value : value)))}
                className="mt-0.5 h-5 w-5 shrink-0 accent-rose"
              />
              <span className="text-sm leading-6">{label}</span>
            </label>
          ))}
        </div>

        <fieldset>
          <legend className="font-semibold">How long should your profile last?</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {([1, 7, 30] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={retention === value}
                onClick={() => setRetention(value)}
                className={`btn ${retention === value ? "btn-primary" : "btn-secondary"}`}
              >
                {value === 1 ? "24 hours" : `${value} days`}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="font-semibold">Result wording</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["playful", "unfiltered"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tone === value}
                onClick={() => setTone(value)}
                className={`btn ${tone === value ? "btn-primary" : "btn-secondary"}`}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </fieldset>

        <button
          disabled={!allChecked}
          onClick={begin}
          className="btn btn-primary mt-7 w-full disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start
        </button>
        <p className="mt-3 text-center text-xs text-muted">{visibleCards.length} cards. Nothing is required.</p>
      </section>
    );
  }

  // ------------------------------------------------------------------- saving
  if (phase === "saving") {
    return (
      <section className="card my-6 flex min-h-[60svh] flex-col items-center justify-center p-8 text-center">
        <div className={`mb-6 h-16 w-16 rounded-full border-2 border-rose ${reduceMotion ? "" : "animate-pulse"}`}>
          <BrandMark compact />
        </div>
        <h1 className="text-xl font-semibold" aria-live="polite">
          {status}
        </h1>
        <p className="mt-2 text-sm text-muted">Keep this page open.</p>
      </section>
    );
  }

  // ------------------------------------------------------------------- review
  if (phase === "review") {
    const skipped = visibleCards.filter((card) => responses[card.id]?.kind === "skipped").length;
    const unanswered = visibleCards.length - answeredCount;

    return (
      <section className="card my-6 p-5 md:p-8">
        <p className="eyebrow">Ready</p>
        <h1 className="mt-2 text-3xl font-semibold">That&rsquo;s everything</h1>
        <p className="mt-3 text-muted">
          You answered {answeredCount} of {visibleCards.length} cards
          {skipped > 0 ? `, skipping ${skipped}` : ""}
          {unanswered > 0 ? `, and left ${unanswered} untouched` : ""}. Skipped cards are left out of your result
          entirely — they are never read as a no.
        </p>

        {error && (
          <div role="alert" className="mt-5 rounded-xl border border-rose/50 bg-rose/10 p-4">
            <p>{error}</p>
            {setupProblems.length > 0 && (
              <>
                <p className="mt-3 text-sm font-semibold">The deployment still needs:</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
                  {setupProblems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {turnstile.element}

        <div className="mt-7 flex flex-col gap-2">
          <button onClick={() => void submit()} className="btn btn-primary">
            See my result
          </button>
          <button
            onClick={() => {
              const first = visibleCards.find((card) => !responses[card.id]) ?? visibleCards[0];
              setCardId(first.id);
              setPhase("quiz");
            }}
            className="btn btn-secondary"
          >
            Go back through the cards
          </button>
        </div>
      </section>
    );
  }

  // --------------------------------------------------------------------- quiz
  if (!current) {
    return (
      <section className="card p-8 text-center">
        <h1 className="text-xl font-semibold">No cards available</h1>
        <p className="mt-2 text-muted">The question bank could not be loaded. Please reload the page.</p>
      </section>
    );
  }

  const response = responses[current.id];
  const details = response?.kind === "interest" ? (response.details ?? {}) : {};
  const progress = ((index + 1) / visibleCards.length) * 100;

  return (
    <section className="flex min-h-[100svh] flex-col">
      <header className="flex items-center justify-between gap-2 py-3">
        <BrandMark compact />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex min-h-12 min-w-12 items-center justify-center rounded-full text-muted hover:text-cream"
            aria-label="Quiz settings"
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            onClick={() => {
              clearDraft();
              router.push("/");
            }}
            className="min-h-12 px-2 text-sm text-muted underline"
          >
            Clear &amp; exit
          </button>
        </div>
      </header>

      <div className="mb-3">
        <div className="flex justify-between text-xs text-muted">
          <span>{current.categoryLabel}</span>
          <span>
            {index + 1} / {visibleCards.length}
          </span>
        </div>
        <div className="bar mt-1.5 h-1">
          <span style={{ width: `${progress}%` }} />
        </div>
        <p ref={liveRegion} className="sr-only" aria-live="polite" />
      </div>

      <div className="flex flex-1 flex-col justify-center pb-4">
        <SwipeCard
          card={current}
          onAnswer={answerInterest}
          swipeEnabled={prefs.swipeEnabled && current.responseType === "interest"}
          reduceMotion={reduceMotion}
        >
          <p className="eyebrow">{current.topic}</p>
          <h1 className="mt-2 text-2xl font-semibold leading-snug">{current.prompt}</h1>
          {current.note && <p className="mt-3 text-sm text-muted">{current.note}</p>}

          {current.responseType === "single_select" && (
            <div className="mt-5 space-y-2">
              {current.options?.map((option) => (
                <button
                  key={option.value}
                  aria-pressed={response?.kind === "choice" && response.value === option.value}
                  onClick={() => record({ kind: "choice", value: option.value })}
                  className={`min-h-12 w-full rounded-xl border p-3 text-left ${
                    response?.kind === "choice" && response.value === option.value
                      ? "border-rose bg-rose/15"
                      : "border-white/10 bg-white/[.03]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {current.responseType === "multi_select" && (
            <MultiSelect card={current} response={response} onChange={(next) => record(next, { advance: false })} />
          )}

          {response?.kind === "interest" && (
            <p className="mt-4 text-sm text-rose">
              Recorded: {{ no: "Not for me", curious: "Curious", yes: "Into it" }[response.interest]}
              {details.hardLimit ? " · hard limit" : ""}
              {details.intent === "fantasy_only" ? " · fantasy only" : ""}
            </p>
          )}
        </SwipeCard>
      </div>

      <div className="sticky bottom-0 mt-4 space-y-3 bg-ink/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {current.responseType === "interest" ? (
          <div className="grid grid-cols-3 gap-2">
            <AnswerButton
              label="Not for me"
              tone="no"
              active={response?.kind === "interest" && response.interest === "no"}
              onClick={() => answerInterest("no")}
              icon={<X className="h-6 w-6" aria-hidden="true" />}
            />
            <AnswerButton
              label="Curious"
              tone="curious"
              active={response?.kind === "interest" && response.interest === "curious"}
              onClick={() => answerInterest("curious")}
              icon={<HelpCircle className="h-6 w-6" aria-hidden="true" />}
            />
            <AnswerButton
              label="Into it"
              tone="yes"
              active={response?.kind === "interest" && response.interest === "yes"}
              onClick={() => answerInterest("yes")}
              icon={<Heart className="h-6 w-6" aria-hidden="true" />}
            />
          </div>
        ) : current.responseType === "multi_select" ? (
          <button
            onClick={() => advance(current, responses)}
            disabled={!response}
            className="btn btn-primary w-full disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="mr-2 h-4 w-4" aria-hidden="true" /> Continue
          </button>
        ) : (
          // A single-select commits on choice, so there is nothing to confirm.
          <p className="text-center text-sm text-muted">Pick one to continue.</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            onClick={undo}
            disabled={history.length === 0}
            className="flex min-h-12 items-center gap-1.5 px-2 text-muted disabled:opacity-30"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Undo
          </button>
          <button onClick={() => record({ kind: "skipped" })} className="min-h-12 px-2 text-muted underline">
            Prefer not to answer
          </button>
          {current.responseType === "interest" && (
            <>
              <button onClick={() => record({ kind: "not_applicable" })} className="min-h-12 px-2 text-muted underline">
                Not applicable
              </button>
              {current.allowDetails && (
                <button onClick={() => setDetailsOpen(true)} className="min-h-12 px-2 text-rose underline">
                  Details
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {detailsOpen && (
        <DetailsSheet
          topic={current.topic}
          details={details}
          onChange={(next) => {
            const base = response?.kind === "interest" ? response.interest : "no";
            // A hard limit is only coherent alongside "Not for me".
            const interest: Interest = next.hardLimit ? "no" : base;
            setResponses((existing) => ({
              ...existing,
              [current.id]: { kind: "interest", interest, ...(Object.keys(next).length ? { details: next } : {}) },
            }));
          }}
          onClose={() => setDetailsOpen(false)}
        />
      )}

      {settingsOpen && (
        <QuizSettings
          prefs={prefs}
          onChange={setPreference}
          alias={alias}
          retention={retention}
          tone={tone}
          systemReducedMotion={systemReducedMotion}
          onClear={() => {
            clearDraft();
            setResponses({});
            setHistory([]);
            setCardId(visibleCards[0]?.id ?? null);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </section>
  );
}

function AnswerButton({
  label,
  tone,
  active,
  onClick,
  icon,
}: {
  label: string;
  tone: "no" | "curious" | "yes";
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  const palette = {
    no: "border-white/20 text-cream",
    curious: "border-amber-300/40 text-amber-200",
    yes: "border-emerald-400/40 text-emerald-200",
  }[tone];
  const activeStyle = { no: "bg-white/15", curious: "bg-amber-300/20", yes: "bg-emerald-400/20" }[tone];

  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl border ${palette} ${
        active ? activeStyle : "bg-white/[.03]"
      }`}
    >
      {icon}
      <span className="text-xs font-semibold">{label}</span>
    </button>
  );
}

function MultiSelect({
  card,
  response,
  onChange,
}: {
  card: QuestionCard;
  response: QuestionResponse | undefined;
  onChange: (response: QuestionResponse) => void;
}) {
  const selected = response?.kind === "multi" ? response.values : [];
  const groups = card.groups ?? [{ label: "", options: card.options ?? [] }];

  const toggle = (value: string) => {
    const next = selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value];
    onChange(next.length ? { kind: "multi", values: next } : { kind: "multi_none" });
  };

  return (
    <div className="mt-5 space-y-4">
      {groups.map((group) => (
        <div key={group.label || "all"}>
          {group.label && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{group.label}</p>}
          <div className="flex flex-wrap gap-2">
            {group.options.map((option) => (
              <button
                key={option.value}
                aria-pressed={selected.includes(option.value)}
                onClick={() => toggle(option.value)}
                className={`min-h-12 rounded-full border px-4 text-sm ${
                  selected.includes(option.value)
                    ? "border-rose bg-rose/20 text-cream"
                    : "border-white/15 bg-white/[.03] text-muted"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {/* An empty selection is ambiguous, so "none" is stated explicitly. */}
      <button
        aria-pressed={response?.kind === "multi_none"}
        onClick={() => onChange({ kind: "multi_none" })}
        className={`min-h-12 rounded-full border px-4 text-sm ${
          response?.kind === "multi_none" ? "border-rose bg-rose/20 text-cream" : "border-white/15 text-muted"
        }`}
      >
        None of these
      </button>
    </div>
  );
}

function QuizSettings({
  prefs,
  onChange,
  alias,
  retention,
  tone,
  systemReducedMotion,
  onClear,
  onClose,
}: {
  prefs: QuizPrefs;
  onChange: (next: Partial<QuizPrefs>) => void;
  alias: string;
  retention: number;
  tone: string;
  systemReducedMotion: boolean;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-settings-title"
        className="card max-h-[85vh] w-full max-w-md overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-start justify-between">
          <h2 id="quiz-settings-title" className="text-xl font-semibold">
            Settings
          </h2>
          <button autoFocus onClick={onClose} className="btn btn-secondary min-h-12 px-4 text-sm">
            Done
          </button>
        </div>

        <Toggle
          label="Swipe as well as tap"
          description="Turn off to answer with the buttons only."
          checked={prefs.swipeEnabled}
          onChange={(value) => onChange({ swipeEnabled: value })}
        />
        <Toggle
          label="Move on automatically"
          description="Advance to the next card as soon as you answer."
          checked={prefs.autoAdvance}
          onChange={(value) => onChange({ autoAdvance: value })}
        />
        <Toggle
          label="Reduce motion"
          description={
            systemReducedMotion
              ? "Your device already asks for reduced motion, which is being respected."
              : "Removes card movement and transitions."
          }
          checked={prefs.reduceMotion || systemReducedMotion}
          disabled={systemReducedMotion}
          onChange={(value) => onChange({ reduceMotion: value })}
        />

        <dl className="mt-6 space-y-1 border-t border-white/10 pt-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Your alias</dt>
            <dd className="font-semibold">{alias || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Retention</dt>
            <dd>{retention === 1 ? "24 hours" : `${retention} days`}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Result wording</dt>
            <dd className="capitalize">{tone}</dd>
          </div>
        </dl>

        <button onClick={onClear} className="btn btn-secondary mt-5 w-full text-rose">
          Clear my answers
        </button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="mt-5 flex min-h-12 cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-rose"
      />
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-sm text-muted">{description}</span>
      </span>
    </label>
  );
}
