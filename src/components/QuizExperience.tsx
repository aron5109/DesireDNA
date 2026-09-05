"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { getQuestions } from "@/data/questions";
import { generateAlias } from "@/lib/quiz/alias";
import type { QuizAnswer } from "@/lib/quiz/types";
import { BrandMark } from "./BrandMark";

const confirmations = [
  "I confirm that I am at least 18 years old.",
  "I understand that this quiz contains explicit adult questions.",
  "I explicitly consent to the processing and encrypted storage of my answers for the purpose of creating my result and comparisons I initiate.",
  "I understand that I can skip any question and permanently delete my profile.",
];

const STORAGE_KEY = "ddna_quiz";
const SKIPPED = "prefer_not_to_answer";

type AnswerMap = Record<string, string | string[]>;
type SkipRequest = "question" | "category" | null;
interface SavedProgress {
  index: number;
  answers: AnswerMap;
  alias: string;
}

const isSkipped = (value: string | string[] | undefined) => value === SKIPPED;
const hasSelection = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value.length > 0 : Boolean(value);

/** Restores unfinished progress. sessionStorage only — never localStorage. */
function readProgress(): SavedProgress {
  const empty: SavedProgress = { index: 0, answers: {}, alias: "" };
  if (typeof window === "undefined") return empty;
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return empty;
    const value = JSON.parse(saved) as Partial<SavedProgress>;
    return {
      index: typeof value.index === "number" && value.index >= 0 ? value.index : 0,
      answers: typeof value.answers === "object" && value.answers ? value.answers : {},
      alias: typeof value.alias === "string" ? value.alias : "",
    };
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return empty;
  }
}

export function QuizExperience() {
  const router = useRouter();
  const questions = useMemo(() => getQuestions(), []);
  const restored = useMemo(readProgress, []);

  const [started, setStarted] = useState(false);
  const [checks, setChecks] = useState([false, false, false, false]);
  const [retention, setRetention] = useState<1 | 7 | 30>(7);
  const [tone, setTone] = useState<"playful" | "unfiltered">("playful");
  const [alias, setAlias] = useState(restored.alias);
  const [index, setIndex] = useState(Math.min(restored.index, Math.max(questions.length - 1, 0)));
  const [answers, setAnswers] = useState<AnswerMap>(restored.answers);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [setupProblems, setSetupProblems] = useState<string[]>([]);
  const [skipRequest, setSkipRequest] = useState<SkipRequest>(null);
  const [skipAcknowledged, setSkipAcknowledged] = useState(false);
  const [reviewAnswers, setReviewAnswers] = useState<AnswerMap | null>(null);

  useEffect(() => {
    if (started) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ index, answers, alias } satisfies SavedProgress));
    }
  }, [started, index, answers, alias]);

  const question = questions[index];
  const selected = question ? answers[question.id] : undefined;
  const multi = question?.responseType === "multi_select";

  function begin() {
    setAlias((current) => current || generateAlias());
    setStarted(true);
  }

  function select(value: string) {
    if (!question) return;
    setAnswers((current) => {
      if (!multi) return { ...current, [question.id]: value };
      const existing = Array.isArray(current[question.id]) ? (current[question.id] as string[]) : [];
      const next = existing.includes(value)
        ? existing.filter((entry) => entry !== value)
        : [...existing, value];
      return { ...current, [question.id]: next };
    });
  }

  function requestFinish(finalAnswers: AnswerMap) {
    if (questions.some((entry) => isSkipped(finalAnswers[entry.id]))) setReviewAnswers(finalAnswers);
    else void finish(finalAnswers);
  }

  async function finish(finalAnswers: AnswerMap) {
    setReviewAnswers(null);
    setBusy(true);
    setError("");
    setSetupProblems([]);

    const submittedAlias = alias || generateAlias();
    if (submittedAlias !== alias) setAlias(submittedAlias);

    try {
      for (const message of ["Reading your answers", "Mapping your preferences", "Sequencing your DesireDNA"]) {
        setStatus(message);
        await new Promise((resolve) => setTimeout(resolve, 550));
      }
      setStatus("Creating your result");

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20_000);
      let response: Response;
      try {
        response = await fetch("/api/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            ageConfirmed: true,
            explicitContentConfirmed: true,
            storageConsent: true,
            deletionUnderstood: true,
            retentionDays: retention,
            tone,
            alias: submittedAlias,
            answers: Object.entries(finalAnswers).map(([questionId, value]) => ({
              questionId,
              value,
            })) satisfies QuizAnswer[],
          }),
        });
      } finally {
        window.clearTimeout(timeout);
      }

      if (!response.ok) {
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

      // Answers only leave this device once; the local copy goes immediately.
      window.sessionStorage.removeItem(STORAGE_KEY);
      router.replace("/results");
    } catch (reason) {
      setError(
        reason instanceof DOMException && reason.name === "AbortError"
          ? "Creating your result took too long. Your answers are still here — please try again."
          : reason instanceof Error
            ? reason.message
            : "We could not create your result. Please try again.",
      );
      setBusy(false);
    }
  }

  function advance(updated: AnswerMap) {
    setAnswers(updated);
    if (index >= questions.length - 1) requestFinish(updated);
    else setIndex((current) => current + 1);
  }

  function continueQuiz() {
    if (!question || !hasSelection(selected)) return;
    advance({ ...answers, [question.id]: selected as string | string[] });
  }

  function confirmSkip() {
    if (!question || !skipRequest || !skipAcknowledged) return;
    setSkipRequest(null);
    setSkipAcknowledged(false);

    const updated: AnswerMap = { ...answers };
    if (skipRequest === "question") {
      updated[question.id] = SKIPPED;
      advance(updated);
      return;
    }

    for (const entry of questions) {
      if (entry.categoryId === question.categoryId) updated[entry.id] = SKIPPED;
    }
    setAnswers(updated);

    const last = questions.map((entry) => entry.categoryId).lastIndexOf(question.categoryId);
    if (last >= questions.length - 1) requestFinish(updated);
    else setIndex(last + 1);
  }

  function clearAndExit() {
    window.sessionStorage.removeItem(STORAGE_KEY);
    router.push("/");
  }

  if (!started) {
    const allChecked = checks.every(Boolean);
    const resumable = Object.keys(restored.answers).length > 0;

    return (
      <section className="card p-6 md:p-9">
        <BrandMark />
        <p className="eyebrow mt-8">Adult consent gate</p>
        <h1 className="mt-2 text-3xl font-semibold">Before we begin</h1>
        <p className="mt-3 text-muted">
          All participants discussed in this private survey must be consenting adults. Nothing is preselected.
        </p>
        {resumable && (
          <p className="mt-4 rounded-xl border border-white/15 bg-white/5 p-3 text-sm">
            Unfinished answers from this browser tab were found. Confirming below continues where you left off.
          </p>
        )}

        <div className="my-7 space-y-3">
          {confirmations.map((label, position) => (
            <label
              className="flex min-h-12 cursor-pointer gap-3 rounded-xl border border-white/10 p-3"
              key={label}
            >
              <input
                type="checkbox"
                checked={checks[position]}
                onChange={() =>
                  setChecks((current) => current.map((value, index) => (index === position ? !value : value)))
                }
                className="h-5 w-5 accent-rose"
              />
              <span>{label}</span>
            </label>
          ))}
          <label className="flex min-h-12 cursor-pointer gap-3 rounded-xl border border-rose/60 bg-rose/10 p-3 font-semibold">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(event) => setChecks(confirmations.map(() => event.target.checked))}
              className="h-5 w-5 accent-rose"
            />
            <span>I agree to all of the above.</span>
          </label>
        </div>

        <fieldset>
          <legend className="font-semibold">Data retention</legend>
          <p className="mt-1 text-sm text-muted">Your profile is deleted automatically when this period ends.</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {([1, 7, 30] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={retention === value}
                onClick={() => setRetention(value)}
                className={`btn ${retention === value ? "btn-primary" : "btn-secondary"}`}
              >
                {value === 1 ? "24 hours" : `${value} days`}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-6">
          <legend className="font-semibold">Result language</legend>
          <p className="mt-1 text-sm text-muted">
            Unfiltered uses stronger self-descriptive wording. No degrading label is ever assigned for you.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["playful", "unfiltered"] as const).map((value) => (
              <button
                type="button"
                key={value}
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
          className="btn btn-primary mt-8 w-full disabled:cursor-not-allowed disabled:opacity-40"
        >
          Begin private quiz
        </button>
      </section>
    );
  }

  if (busy) {
    return (
      <section className="card flex min-h-[55vh] flex-col items-center justify-center p-8 text-center">
        <div className="mb-8 h-20 w-20 animate-pulse rounded-full border-2 border-rose shadow-glow">
          <BrandMark compact />
        </div>
        <h1 className="text-2xl font-semibold" aria-live="polite">
          {status}
        </h1>
        <p className="mt-3 text-sm text-muted">Sequencing for {alias}. Please keep this page open.</p>
        <div className="mt-6 h-1 w-48 overflow-hidden rounded bg-white/10">
          <span className="block h-full w-full origin-left animate-pulse bg-rose" />
        </div>
      </section>
    );
  }

  if (!question) {
    return (
      <section className="card p-8 text-center">
        <h1 className="text-2xl font-semibold">No questions are available</h1>
        <p className="mt-3 text-muted">The question bank could not be loaded. Please reload the page.</p>
      </section>
    );
  }

  const skippedHere = isSkipped(selected);

  return (
    <section>
      <div className="mb-5 flex items-center justify-between gap-3">
        <BrandMark />
        <button className="text-sm text-muted underline" onClick={clearAndExit}>
          Clear &amp; exit
        </button>
      </div>

      <p className="mb-4 text-sm text-muted">
        You are answering as <span className="font-semibold text-cream">{alias}</span>. This random alias is the only
        name attached to your result — no real name is ever collected.
      </p>

      <div className="mb-4">
        <div className="flex justify-between text-sm text-muted">
          <span>{question.categoryLabel}</span>
          <span>
            {index + 1} of {questions.length}
          </span>
        </div>
        <div className="bar mt-2">
          <span style={{ width: `${((index + 1) / questions.length) * 100}%` }} />
        </div>
        <p className="sr-only" aria-live="polite">
          Question {index + 1} of {questions.length}, {question.categoryLabel}.
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-rose/50 bg-rose/10 p-4">
          <p>{error}</p>
          {setupProblems.length > 0 && (
            <>
              <p className="mt-3 text-sm font-semibold">The deployment still needs:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
                {setupProblems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-muted">
                Set these in your hosting provider and redeploy. Your answers are still saved in this tab.
              </p>
            </>
          )}
          <button className="mt-3 text-sm font-semibold underline" onClick={() => void finish(answers)}>
            Try creating my result again
          </button>
        </div>
      )}

      <article className="card p-5 md:p-8">
        <p className="eyebrow">{question.shortLabel}</p>
        <h1 className="mt-3 text-2xl font-semibold leading-snug">{question.prompt}</h1>
        {question.helpText && <p className="mt-3 text-sm text-muted">{question.helpText}</p>}
        {multi && <p className="mt-3 text-sm text-muted">Select any that apply.</p>}

        <div className="mt-6 space-y-2">
          {question.answerOptions.map((option) => {
            const active = multi
              ? Array.isArray(selected) && selected.includes(option.value)
              : selected === option.value;
            return (
              <button
                key={option.value}
                aria-pressed={active}
                onClick={() => select(option.value)}
                className={`min-h-12 w-full rounded-xl border p-3 text-left ${
                  active ? "border-rose bg-rose/15" : "border-white/10 bg-white/[.03] hover:border-white/30"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {skippedHere && (
          <p className="mt-4 text-sm text-muted">
            Currently skipped. Choose an answer to include it, or continue to keep it skipped.
          </p>
        )}
      </article>

      <div className="sticky bottom-0 mt-4 grid grid-cols-2 gap-2 bg-ink/95 py-3 backdrop-blur sm:grid-cols-4">
        <button
          disabled={index === 0}
          onClick={() => setIndex((current) => Math.max(current - 1, 0))}
          className="btn btn-secondary disabled:opacity-30"
        >
          Back
        </button>
        <button onClick={() => setSkipRequest("question")} className="btn btn-secondary">
          Skip
        </button>
        <button onClick={() => setSkipRequest("category")} className="btn btn-secondary text-xs">
          Skip category
        </button>
        <button
          disabled={!hasSelection(selected)}
          onClick={continueQuiz}
          className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {index >= questions.length - 1 ? "Finish" : "Continue"}
        </button>
      </div>

      {skipRequest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="skip-title"
        >
          <div className="card max-w-md p-6">
            <p className="eyebrow">Before you skip</p>
            <h2 id="skip-title" className="mt-2 text-2xl font-semibold">
              This will make your result less accurate.
            </h2>
            <p className="mt-3 leading-7 text-muted">
              Skipped answers are excluded from scoring and comparison, and are never shown to anyone as a rejection.
              You can return to them before analysis.
            </p>
            <label className="mt-5 flex cursor-pointer gap-3 rounded-xl border border-white/15 p-3">
              <input
                autoFocus
                type="checkbox"
                checked={skipAcknowledged}
                onChange={(event) => setSkipAcknowledged(event.target.checked)}
                className="h-5 w-5 accent-rose"
              />
              <span>I acknowledge that skipping can make my result and comparisons less accurate.</span>
            </label>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setSkipRequest(null);
                  setSkipAcknowledged(false);
                }}
              >
                Go back
              </button>
              <button
                disabled={!skipAcknowledged}
                className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-40"
                onClick={confirmSkip}
              >
                Skip {skipRequest === "category" ? "category" : "question"}
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewAnswers && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-title"
        >
          <div className="card max-w-md p-6">
            <p className="eyebrow">One last check</p>
            <h2 id="review-title" className="mt-2 text-2xl font-semibold">
              Answer your skipped questions?
            </h2>
            <p className="mt-3 leading-7 text-muted">
              You skipped {questions.filter((entry) => isSkipped(reviewAnswers[entry.id])).length} question(s).
              Answering them now makes your result and comparisons more complete, but skipping is always allowed.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                className="btn btn-primary"
                onClick={() => {
                  const first = questions.findIndex((entry) => isSkipped(reviewAnswers[entry.id]));
                  setAnswers(reviewAnswers);
                  setIndex(first === -1 ? index : first);
                  setReviewAnswers(null);
                }}
              >
                Answer skipped questions
              </button>
              <button className="btn btn-secondary" onClick={() => void finish(reviewAnswers)}>
                Show my result now
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
