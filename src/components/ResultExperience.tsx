"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { Comparison, MatchEntry } from "@/lib/quiz/comparison";
import type { QuizResult, ShareMode } from "@/lib/quiz/types";
import { ResultIllustration } from "./ResultIllustration";
import { useTurnstile } from "./TurnstileGate";

export interface ProfileView {
  result: QuizResult;
  desireCode: string;
  alias: string;
  /** ISO string; formatted on the client to avoid a hydration mismatch. */
  expiresAt: string;
  shareMode: ShareMode;
}

const labelFor = (categoryId: string, labels: Record<string, string> | undefined) =>
  labels?.[categoryId] ?? categoryId.replaceAll("_", " ");

function MatchList({ title, entries, empty }: { title: string; entries: MatchEntry[]; empty: string }) {
  return (
    <div className="mt-6">
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {entries.length ? (
          entries.map((entry) => (
            <span
              key={`${entry.activityId}-${entry.topic}`}
              className="rounded-full bg-white/10 px-3 py-2 text-sm"
              title={entry.complementary ? "Your roles fit together" : undefined}
            >
              {entry.topic}
              {entry.complementary && <span className="ml-1.5 text-rose">↔</span>}
            </span>
          ))
        ) : (
          <span className="text-sm text-muted">{empty}</span>
        )}
      </div>
    </div>
  );
}

export function CompareForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const turnstile = useTurnstile("compare");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // A fresh token per attempt; the previous one is single-use.
      const turnstileToken = await turnstile.handle.getToken();
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ desireCode: code, ...(turnstileToken ? { turnstileToken } : {}) }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        comparison?: Comparison;
        storageProblem?: string;
        hint?: string;
      };
      if (!response.ok) {
        turnstile.handle.reset();
        setComparison(null);
        setError(
          [data.error ?? "Comparison failed. Please try again.", data.storageProblem, data.hint]
            .filter(Boolean)
            .join(" "),
        );
      } else {
        setComparison(data.comparison ?? null);
      }
    } catch {
      setComparison(null);
      setError("We could not reach the comparison service. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit}>
        <label htmlFor="code" className="font-semibold">
          Enter a trusted adult&rsquo;s DesireCode
        </label>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            id="code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="DDNA-XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            className="min-h-12 w-full min-w-0 flex-1 rounded-xl border border-white/20 bg-black/20 px-4 uppercase"
            aria-describedby={error ? "code-error" : undefined}
            aria-invalid={error ? true : undefined}
          />
          <button disabled={busy || !code.trim()} className="btn btn-primary disabled:opacity-40">
            {busy ? "Comparing…" : "Compare"}
          </button>
        </div>
        {turnstile.element}
        {error && (
          <p id="code-error" role="alert" className="mt-3 text-rose">
            {error}
          </p>
        )}
      </form>

      {comparison && (
        <section className="mt-8" aria-live="polite">
          <p className="eyebrow">
            {comparison.selfAlias} &amp; {comparison.partnerAlias}
          </p>

          {comparison.sharedInterest === null ? (
            <>
              <h2 className="mt-2 text-2xl font-semibold">Not enough comparable answers</h2>
              <p className="mt-2 text-muted">
                You have {comparison.comparableAnswers} cards in common so far — too few for a meaningful percentage.
                The matches below are still accurate.
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-2 text-3xl font-semibold">{comparison.sharedInterest}% shared interest</h2>
              <p className="mt-2 text-sm text-muted">
                Of the {comparison.comparableAnswers} cards you both answered, this is the share you are both keen on.
                {comparison.preferenceSimilarity !== null && (
                  <> Your answers are {comparison.preferenceSimilarity}% alike overall, which includes shared nos.</>
                )}
              </p>
            </>
          )}

          <MatchList title="Strong matches" entries={comparison.strongMatches} empty="None yet" />
          <MatchList title="Shared curiosities" entries={comparison.sharedCuriosities} empty="None yet" />
          {comparison.fantasyOverlap.length > 0 && (
            <>
              <MatchList title="Shared as fantasy" entries={comparison.fantasyOverlap} empty="None" />
              <p className="mt-2 text-sm text-muted">
                At least one of you marked these as fantasy. That is not a plan or a suggestion to act.
              </p>
            </>
          )}

          {comparison.mutualMediaCategories.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold">Adult media you both picked</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {comparison.mutualMediaCategories.map((entry) => (
                  <span key={entry} className="rounded-full bg-white/10 px-3 py-2 text-sm">
                    {entry}
                  </span>
                ))}
              </div>
            </div>
          )}

          {comparison.mode === "mutual_only" ? (
            <p className="mt-8 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-muted">
              Mutual-only mode. Anything only one of you wants, anything either of you turned down, skipped answers,
              and both of your boundaries stay private — including how many there are.
            </p>
          ) : (
            <>
              <MatchList
                title="Talk it through"
                entries={comparison.talkItThrough ?? []}
                empty="Nothing flagged"
              />
              <div className="mt-6">
                <h3 className="font-semibold">Boundary differences</h3>
                <p className="mt-2 text-sm text-muted">
                  One of you marked a firm boundary where the other showed interest. A hard limit is not an invitation
                  to persuade or negotiate — it is a full stop.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(comparison.boundaryMismatches ?? []).length ? (
                    (comparison.boundaryMismatches ?? []).map((entry) => (
                      <span key={entry.activityId} className="rounded-full bg-rose/15 px-3 py-2 text-sm">
                        {entry.topic}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-muted">None</span>
                  )}
                </div>
              </div>

              {comparison.categoryAlignment && Object.keys(comparison.categoryAlignment).length > 0 && (
                <div className="mt-8">
                  <h3 className="font-semibold">By category</h3>
                  {Object.entries(comparison.categoryAlignment).map(([categoryId, value]) => (
                    <div className="mt-3" key={categoryId}>
                      <div className="flex justify-between text-sm">
                        <span>{labelFor(categoryId, comparison.categoryLabels)}</span>
                        <span>{value}%</span>
                      </div>
                      <div className="bar mt-1.5">
                        <span style={{ width: `${value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <p className="mt-7 rounded-xl border border-rose/30 bg-rose/10 p-4 text-sm">
            A matching interest never replaces active, sober, informed consent. Only share a code with an adult you
            trust — a code is not proof of anything on its own.
          </p>
        </section>
      )}
    </div>
  );
}

export function ResultView({ profile: initial }: { profile: ProfileView }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");
  const [deleteState, setDeleteState] = useState<"idle" | "confirming" | "deleting" | "failed">("idle");
  const [deleteError, setDeleteError] = useState("");
  const [rotating, setRotating] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const result = profile.result;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(profile.desireCode);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2500);
    } catch {
      // Clipboard access can be refused; the code stays selectable on screen.
      setCopyState("failed");
    }
  }

  async function updateShareMode(shareMode: ShareMode) {
    setShareBusy(true);
    setShareError("");
    try {
      const response = await fetch("/api/profile/share-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareMode }),
      });
      if (!response.ok) throw new Error();
      setProfile({ ...profile, shareMode });
    } catch {
      setShareError("Sharing mode could not be updated. Please try again.");
    } finally {
      setShareBusy(false);
    }
  }

  async function rotateCode() {
    setRotating(true);
    try {
      const response = await fetch("/api/profile", { method: "PATCH" });
      const data = (await response.json().catch(() => ({}))) as { desireCode?: string; error?: string };
      if (!response.ok || !data.desireCode) throw new Error(data.error ?? "");
      setProfile({ ...profile, desireCode: data.desireCode });
      setCopyState("idle");
    } catch {
      setShareError("The code could not be replaced. Please try again.");
    } finally {
      setRotating(false);
    }
  }

  /** Deletion only navigates away once the server confirms it happened. */
  async function confirmDelete() {
    if (deleteState === "deleting") return;
    setDeleteState("deleting");
    setDeleteError("");
    try {
      const response = await fetch("/api/profile", { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Your profile was not deleted.");
      }
      try {
        window.sessionStorage.clear();
      } catch {
        // Nothing stored, or storage is unavailable.
      }
      router.replace("/");
      router.refresh();
    } catch (error) {
      setDeleteState("failed");
      setDeleteError(
        error instanceof Error && error.message
          ? error.message
          : "Your profile was not deleted. It is still here — please try again.",
      );
    }
  }

  const hasIndex = result.adventureIndex !== null;

  return (
    <div className="space-y-4">
      <section className="card p-6 text-center">
        <ResultIllustration adventureIndex={result.adventureIndex ?? 0} label={result.personality.name} />
        <p className="eyebrow mt-3">{profile.alias}</p>
        <h1 className="mt-1.5 text-3xl font-semibold">
          <span aria-hidden="true">{result.personality.emoji} </span>
          {result.personality.name}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">{result.personality.description}</p>

        {hasIndex && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/5 p-4">
              <strong className="text-2xl">{result.adventureIndex}%</strong>
              <p className="text-xs text-muted">Adventure Index</p>
            </div>
            <div className="rounded-2xl bg-white/5 p-4">
              <strong className="text-2xl">
                {result.communicationScore === null ? "—" : `${result.communicationScore}%`}
              </strong>
              <p className="text-xs text-muted">Communication</p>
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-muted">
          Based on {result.scoredCount} scored answers out of {result.asked} cards. A snapshot of preferences, not a
          measurement of anything about you.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">Your categories</h2>
        {Object.keys(result.categoryScores).length === 0 ? (
          <p className="mt-2 text-sm text-muted">No scored answers yet, so there is nothing to break down.</p>
        ) : (
          Object.entries(result.categoryScores).map(([categoryId, value]) => (
            <div className="mt-3" key={categoryId}>
              <div className="flex justify-between text-sm">
                <span>{labelFor(categoryId, result.categoryLabels)}</span>
                <span>{value}%</span>
              </div>
              <div className="bar mt-1.5">
                <span style={{ width: `${value}%` }} />
              </div>
            </div>
          ))
        )}
        <button onClick={() => setExpanded((open) => !open)} className="mt-4 text-sm text-rose underline">
          {expanded ? "Hide details" : "Show details"}
        </button>
        {expanded && (
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm text-muted">
            <div><dt className="inline">Answered: </dt><dd className="inline">{result.answered}</dd></div>
            <div><dt className="inline">Skipped: </dt><dd className="inline">{result.skipped}</dd></div>
            <div><dt className="inline">Not applicable: </dt><dd className="inline">{result.notApplicable}</dd></div>
            <div><dt className="inline">Hard limits: </dt><dd className="inline">{result.hardLimits}</dd></div>
          </dl>
        )}
      </section>

      <section className="card p-5">
        <p className="eyebrow">Your DesireCode</p>
        <code className="mt-2 block break-all text-lg font-bold tracking-wider">{profile.desireCode}</code>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-secondary" onClick={() => void copyCode()}>
            {copyState === "copied" ? "Copied" : "Copy code"}
          </button>
          <button className="btn btn-secondary" onClick={() => void rotateCode()} disabled={rotating}>
            {rotating ? "Replacing…" : "Replace code"}
          </button>
        </div>
        <p className="mt-2 text-sm text-muted" aria-live="polite">
          {copyState === "failed"
            ? "Copying was blocked by your browser — select the code above to copy it by hand."
            : "Share it only with an adult you trust. Replacing it stops the old code working immediately."}
        </p>
        <ExpiryNotice iso={profile.expiresAt} />

        <fieldset className="mt-5">
          <legend className="font-semibold">Comparison sharing</legend>
          <p className="mt-1 text-sm text-muted">
            Full comparison reveals differences and boundary mismatches, and only ever applies when the other person
            has independently chosen it too.
          </p>
          <select
            className="mt-2 min-h-12 w-full rounded-xl bg-black/30 px-3"
            value={profile.shareMode}
            disabled={shareBusy}
            onChange={(event) => void updateShareMode(event.target.value as ShareMode)}
            aria-label="Comparison sharing mode"
          >
            <option value="mutual_only">Mutual matches only</option>
            <option value="full_comparison">Full comparison</option>
          </select>
          {shareError && (
            <p role="alert" className="mt-2 text-sm text-rose">
              {shareError}
            </p>
          )}
        </fieldset>
      </section>

      <section className="card p-5">
        <CompareForm />
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">Profile</h2>
        {deleteState === "confirming" ? (
          <div role="dialog" aria-modal="false" aria-labelledby="delete-title" className="mt-3">
            <p id="delete-title" className="font-semibold">
              Delete your profile permanently?
            </p>
            <p className="mt-1 text-sm text-muted">
              Your answers and your code are removed straight away. This cannot be undone.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => void confirmDelete()} className="btn btn-primary">
                Yes, delete it
              </button>
              <button onClick={() => setDeleteState("idle")} className="btn btn-secondary">
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => setDeleteState("confirming")}
              disabled={deleteState === "deleting"}
              className="btn btn-secondary text-rose"
            >
              {deleteState === "deleting" ? "Deleting…" : "Delete profile"}
            </button>
            <a href="/quiz" className="btn btn-secondary">
              Take it again
            </a>
          </div>
        )}
        {deleteState === "failed" && deleteError && (
          <p role="alert" className="mt-3 rounded-xl border border-rose/50 bg-rose/10 p-3 text-sm">
            {deleteError}
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Formats the expiry in a fixed locale and time zone, so the server and the
 * client always produce the same text and there is nothing to reconcile.
 */
const EXPIRY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "UTC",
});

function ExpiryNotice({ iso }: { iso: string }) {
  let formatted = iso.slice(0, 10);
  try {
    formatted = `${EXPIRY_FORMAT.format(new Date(iso))} UTC`;
  } catch {
    // Fall back to the plain date.
  }

  return (
    <p className="mt-2 text-sm text-muted">
      Deleted automatically on <time dateTime={iso}>{formatted}</time>.
    </p>
  );
}
