"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { Comparison } from "@/lib/quiz/comparison";
import type { QuizResult, ShareMode } from "@/lib/quiz/types";
import { ResultIllustration } from "./ResultIllustration";

const labelFor = (categoryId: string, labels: Record<string, string>) =>
  labels[categoryId] ?? categoryId.replaceAll("_", " ");

export function CompareForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ desireCode: code }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; comparison?: Comparison };
      if (!response.ok) {
        setComparison(null);
        setError(data.error ?? "Comparison failed. Please try again.");
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
            className="min-h-12 flex-1 rounded-xl border border-white/20 bg-black/20 px-4 uppercase"
            aria-describedby={error ? "code-error" : undefined}
            aria-invalid={error ? true : undefined}
          />
          <button disabled={busy || !code.trim()} className="btn btn-primary disabled:opacity-40">
            {busy ? "Comparing…" : "Compare privately"}
          </button>
        </div>
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
          <h2 className="mt-2 text-3xl font-semibold">{comparison.alignment}% shared-interest alignment</h2>
          <p className="mt-2 text-muted">
            {comparison.mutuallyAnswered} mutually answered · {comparison.strongMatches.length} strong matches ·{" "}
            {comparison.sharedCuriosities.length} shared curiosities · {comparison.sharedBoundaries} shared
            boundaries
          </p>

          {(
            [
              ["Strong Matches", comparison.strongMatches],
              ["Shared Curiosities", comparison.sharedCuriosities],
              ["Mutual adult-media categories", comparison.mutualPornCategories],
            ] as const
          ).map(([name, list]) => (
            <div className="mt-6" key={name}>
              <h3 className="font-semibold">{name}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {list.length ? (
                  list.map((entry) => (
                    <span className="rounded-full bg-white/10 px-3 py-2 text-sm" key={entry}>
                      {entry}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted">None to show</span>
                )}
              </div>
            </div>
          ))}

          {Object.keys(comparison.categoryAlignment).length > 0 && (
            <div className="mt-8">
              <h3 className="font-semibold">Category alignment</h3>
              {Object.entries(comparison.categoryAlignment).map(([categoryId, value]) => (
                <div className="mt-4" key={categoryId}>
                  <div className="flex justify-between text-sm">
                    <span>{labelFor(categoryId, comparison.categoryLabels)}</span>
                    <span>{value}%</span>
                  </div>
                  <div className="bar mt-2">
                    <span style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {comparison.mode === "mutual_only" ? (
            <p className="mt-8 text-sm text-muted">
              Mutual-only mode is active. Differences, one-sided interests, skipped questions, and each person&rsquo;s
              boundaries stay private.
            </p>
          ) : (
            <>
              <div className="mt-8">
                <h3 className="font-semibold">Talk It Through</h3>
                <p className="mt-2 text-muted">
                  {comparison.talkItThrough?.length ? comparison.talkItThrough.join(", ") : "Nothing flagged."}
                </p>
              </div>
              <div className="mt-6">
                <h3 className="font-semibold">Boundary mismatches</h3>
                <p className="mt-2 text-muted">
                  One person expressed interest while the other marked this as a firm boundary. A hard limit is not an
                  invitation to persuade or negotiate.
                </p>
                <p className="mt-2">
                  {comparison.boundaryMismatches?.length
                    ? comparison.boundaryMismatches.join(", ")
                    : "None to show."}
                </p>
              </div>
            </>
          )}

          <p className="mt-7 rounded-xl border border-rose/30 bg-rose/10 p-4">
            A matching interest never replaces active, sober, informed consent.
          </p>
        </section>
      )}
    </div>
  );
}

export interface ProfileView {
  result: QuizResult;
  desireCode: string;
  alias: string;
  expiresAt: string;
  shareMode: ShareMode;
}

/**
 * Renders a result that the server already loaded and decrypted. Keeping the
 * fetch on the server means the outcome is present in the first response —
 * there is no client round trip that can leave someone staring at a spinner
 * after finishing the quiz.
 */
export function ResultView({ profile: initialProfile }: { profile: ProfileView }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [copied, setCopied] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");

  const result = profile.result;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(profile.desireCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
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

  async function remove() {
    if (!window.confirm("Permanently delete your profile? This cannot be undone.")) return;
    await fetch("/api/profile", { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden p-7 text-center">
        <ResultIllustration adventureIndex={result.adventureIndex} label={result.personality.name} />
        <p className="eyebrow mt-4">{profile.alias}</p>
        <h1 className="mt-2 text-4xl font-semibold">
          <span aria-hidden="true">{result.personality.emoji} </span>
          {result.personality.name}
        </h1>
        <p className="mx-auto mt-4 max-w-lg leading-7 text-muted">{result.personality.description}</p>

        <div className="mt-7 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/5 p-5">
            <strong className="text-3xl">{result.adventureIndex}%</strong>
            <p className="text-sm text-muted">Adventure Index</p>
          </div>
          <div className="rounded-2xl bg-white/5 p-5">
            <strong className="text-3xl">{result.communicationScore}%</strong>
            <p className="text-sm text-muted">Communication &amp; Boundaries</p>
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-xl font-semibold">Your categories</h2>
        {Object.keys(result.categoryScores).length === 0 ? (
          <p className="mt-3 text-muted">
            Every scored question was skipped, so there are no category percentages to show.
          </p>
        ) : (
          Object.entries(result.categoryScores).map(([categoryId, value]) => (
            <div className="mt-4" key={categoryId}>
              <div className="flex justify-between">
                <span>{labelFor(categoryId, result.categoryLabels ?? {})}</span>
                <span>{value}%</span>
              </div>
              <div className="bar mt-2">
                <span style={{ width: `${value}%` }} />
              </div>
            </div>
          ))
        )}
        <div className="mt-6 flex flex-wrap gap-4 text-sm text-muted">
          <span>{result.answered} answered</span>
          <span>{result.skipped} skipped</span>
          <span>{result.hardLimits} hard limits recorded</span>
        </div>
      </section>

      <section className="card p-6">
        <p className="eyebrow">Your private DesireCode</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <code className="flex-1 text-xl font-bold tracking-wider">{profile.desireCode}</code>
          <button className="btn btn-secondary" onClick={() => void copyCode()}>
            {copied ? "Copied" : "Copy code"}
          </button>
        </div>
        <p className="mt-3 text-sm text-muted" aria-live="polite">
          Keep this code private and share it only with a trusted adult. Your profile and code are deleted on{" "}
          {new Date(profile.expiresAt).toLocaleString()}.
        </p>

        <fieldset className="mt-6">
          <legend className="font-semibold">Comparison sharing</legend>
          <label htmlFor="share-mode" className="mt-1 block text-sm text-muted">
            Full comparison only ever applies when the other adult has independently chosen it too.
          </label>
          <select
            id="share-mode"
            className="mt-2 min-h-12 w-full rounded-xl bg-black/30 px-3"
            value={profile.shareMode}
            disabled={shareBusy}
            onChange={(event) => void updateShareMode(event.target.value as ShareMode)}
          >
            <option value="mutual_only">Mutual matches only</option>
            <option value="full_comparison">Full comparison (only when both enable it)</option>
          </select>
          {shareError && (
            <p role="alert" className="mt-2 text-sm text-rose">
              {shareError}
            </p>
          )}
        </fieldset>
      </section>

      <section className="card p-6">
        <CompareForm />
      </section>

      <div className="flex flex-wrap justify-center gap-3">
        <button onClick={() => void remove()} className="btn btn-secondary text-rose">
          Delete profile permanently
        </button>
        <a href="/quiz" className="btn btn-secondary">
          Start new profile
        </a>
      </div>
    </div>
  );
}
