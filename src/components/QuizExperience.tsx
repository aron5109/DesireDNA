"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getQuestions } from "@/data/questions";
import type { QuizAnswer } from "@/lib/quiz/types";
import { BrandMark } from "./BrandMark";

const confirmations = [
  "I confirm that I am at least 18 years old.",
  "I understand that this quiz contains explicit adult questions.",
  "I explicitly consent to the processing and encrypted storage of my answers for the purpose of creating my result and comparisons I initiate.",
  "I understand that I can skip any question and permanently delete my profile.",
];
type SkipRequest = "question" | "category" | null;
const isSkipped = (value: string | string[] | undefined) => value === "prefer_not_to_answer";

export function QuizExperience() {
  const router = useRouter();
  const qs = useMemo(() => getQuestions(), []);
  const [started, setStarted] = useState(false);
  const [checks, setChecks] = useState([false, false, false, false]);
  const [retention, setRetention] = useState<1 | 7 | 30>(7);
  const [tone, setTone] = useState<"playful" | "unfiltered">("playful");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [selected, setSelected] = useState<string | string[]>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [skipRequest, setSkipRequest] = useState<SkipRequest>(null);
  const [skipAcknowledged, setSkipAcknowledged] = useState(false);
  const [reviewAnswers, setReviewAnswers] = useState<Record<string, string | string[]> | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("ddna_quiz");
    if (saved) try {
      const value = JSON.parse(saved) as { index: number; answers: Record<string, string | string[]> };
      setIndex(value.index);
      setAnswers(value.answers);
    } catch { sessionStorage.removeItem("ddna_quiz"); }
  }, []);
  useEffect(() => {
    if (started) sessionStorage.setItem("ddna_quiz", JSON.stringify({ index, answers }));
  }, [started, index, answers]);

  const q = qs[index];
  useEffect(() => setSelected(answers[q?.id] ?? ""), [index, answers, q]);

  function requestFinish(finalAnswers: Record<string, string | string[]>) {
    const skipped = qs.filter((question) => isSkipped(finalAnswers[question.id]));
    if (skipped.length) setReviewAnswers(finalAnswers);
    else void finish(finalAnswers);
  }

  async function finish(finalAnswers: Record<string, string | string[]>) {
    setReviewAnswers(null);
    setBusy(true);
    setError("");
    try {
      for (const message of ["Reading your answers", "Mapping your preferences", "Sequencing your DesireDNA"]) {
        setStatus(message);
        await new Promise((resolve) => setTimeout(resolve, 550));
      }
      setStatus("Creating your results");
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      let response: Response;
      try {
        response = await fetch("/api/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            ageConfirmed: true, explicitContentConfirmed: true, storageConsent: true,
            deletionUnderstood: true, retentionDays: retention, tone,
            answers: Object.entries(finalAnswers).map(([questionId, value]) => ({ questionId, value })) satisfies QuizAnswer[],
          }),
        });
      } finally { window.clearTimeout(timeout); }
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Unable to save your profile.");
      }
      sessionStorage.removeItem("ddna_quiz");
      router.push("/results");
    } catch (reason) {
      setError(reason instanceof DOMException && reason.name === "AbortError"
        ? "Creating your results took too long. Please try again."
        : reason instanceof Error ? reason.message : "Unable to create your results. Please try again.");
      setBusy(false);
    }
  }

  function advance(updated: Record<string, string | string[]>) {
    setAnswers(updated);
    if (index === qs.length - 1) requestFinish(updated);
    else setIndex((current) => current + 1);
  }
  function continueQuiz() {
    if (!selected || (Array.isArray(selected) && selected.length === 0)) return;
    advance({ ...answers, [q.id]: selected });
  }
  function confirmSkip() {
    if (!skipRequest || !skipAcknowledged) return;
    setSkipRequest(null);
    setSkipAcknowledged(false);
    const updated = { ...answers };
    if (skipRequest === "question") {
      updated[q.id] = "prefer_not_to_answer";
      advance(updated);
      return;
    }
    qs.forEach((question) => {
      if (question.categoryId === q.categoryId) updated[question.id] = "prefer_not_to_answer";
    });
    setAnswers(updated);
    const last = qs.map((question) => question.categoryId).lastIndexOf(q.categoryId);
    if (last === qs.length - 1) requestFinish(updated);
    else setIndex(last + 1);
  }

  if (!started) {
    const allChecked = checks.every(Boolean);
    return <section className="card p-6 md:p-9">
      <BrandMark /><p className="eyebrow mt-8">Adult consent gate</p>
      <h1 className="mt-2 text-3xl font-semibold">Before we begin</h1>
      <p className="mt-3 text-muted">All participants discussed in this private survey must be consenting adults. Nothing is preselected.</p>
      <div className="my-7 space-y-3">
        {confirmations.map((label, i) => <label className="flex min-h-12 cursor-pointer gap-3 rounded-xl border border-white/10 p-3" key={label}><input type="checkbox" checked={checks[i]} onChange={() => setChecks((current) => current.map((value, j) => j === i ? !value : value))} className="h-5 w-5 accent-rose" /><span>{label}</span></label>)}
        <label className="flex min-h-12 cursor-pointer gap-3 rounded-xl border border-rose/60 bg-rose/10 p-3 font-semibold"><input type="checkbox" checked={allChecked} onChange={(event) => setChecks(confirmations.map(() => event.target.checked))} className="h-5 w-5 accent-rose" /><span>I agree to all of the above.</span></label>
      </div>
      <fieldset><legend className="font-semibold">Data retention</legend><div className="mt-2 grid grid-cols-3 gap-2">{([1, 7, 30] as const).map((value) => <button type="button" onClick={() => setRetention(value)} className={`btn ${retention === value ? "btn-primary" : "btn-secondary"}`} key={value}>{value === 1 ? "24 hours" : `${value} days`}</button>)}</div></fieldset>
      <fieldset className="mt-6"><legend className="font-semibold">Result language</legend><div className="mt-2 grid grid-cols-2 gap-2">{(["playful", "unfiltered"] as const).map((value) => <button type="button" onClick={() => setTone(value)} className={`btn ${tone === value ? "btn-primary" : "btn-secondary"}`} key={value}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></fieldset>
      <button disabled={!allChecked} onClick={() => setStarted(true)} className="btn btn-primary mt-8 w-full disabled:cursor-not-allowed disabled:opacity-40">Begin private quiz</button>
    </section>;
  }

  if (busy) return <section className="card flex min-h-[55vh] flex-col items-center justify-center p-8 text-center" aria-live="polite"><div className="mb-8 h-20 w-20 animate-pulse rounded-full border-2 border-rose shadow-glow"><BrandMark compact /></div><h1 className="text-2xl font-semibold">{status}</h1><p className="mt-3 text-sm text-muted">Please keep this page open.</p><div className="mt-6 h-1 w-48 overflow-hidden rounded bg-white/10"><span className="block h-full w-full origin-left animate-pulse bg-rose" /></div></section>;

  const multi = q.responseType === "multi_select";
  return <section>
    <div className="mb-5 flex items-center justify-between"><BrandMark /><button className="text-sm text-muted underline" onClick={() => { sessionStorage.removeItem("ddna_quiz"); location.href = "/"; }}>Clear &amp; exit</button></div>
    <div aria-live="polite" className="mb-4"><div className="flex justify-between text-sm text-muted"><span>{q.categoryLabel}</span><span>{index + 1} of {qs.length}</span></div><div className="bar mt-2"><span style={{ width: `${((index + 1) / qs.length) * 100}%` }} /></div></div>
    {error && <div role="alert" className="mb-4 rounded-xl border border-rose/50 bg-rose/10 p-4"><p>{error}</p><button className="mt-2 text-sm font-semibold underline" onClick={() => void finish(answers)}>Try creating results again</button></div>}
    <article className="card p-5 md:p-8"><p className="eyebrow">{q.shortLabel}</p><h1 className="mt-3 text-2xl font-semibold leading-snug">{q.prompt}</h1>{q.helpText && <p className="mt-3 text-sm text-muted">{q.helpText}</p>}<div className="mt-6 space-y-2">{q.answerOptions.map((option) => { const active = multi ? Array.isArray(selected) && selected.includes(option.value) : selected === option.value; return <button key={option.value} aria-pressed={active} onClick={() => setSelected(multi ? Array.isArray(selected) && selected.includes(option.value) ? selected.filter((value) => value !== option.value) : [...(Array.isArray(selected) ? selected : []), option.value] : option.value)} className={`min-h-12 w-full rounded-xl border p-3 text-left ${active ? "border-rose bg-rose/15" : "border-white/10 bg-white/[.03] hover:border-white/30"}`}>{option.label}</button>; })}</div></article>
    <div className="sticky bottom-0 mt-4 grid grid-cols-2 gap-2 bg-ink/95 py-3 backdrop-blur sm:grid-cols-4"><button disabled={index === 0} onClick={() => setIndex((current) => current - 1)} className="btn btn-secondary disabled:opacity-30">Back</button><button onClick={() => setSkipRequest("question")} className="btn btn-secondary">Skip</button><button onClick={() => setSkipRequest("category")} className="btn btn-secondary text-xs">Skip category</button><button disabled={!selected || (Array.isArray(selected) && !selected.length)} onClick={continueQuiz} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-40">Continue</button></div>

    {skipRequest && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="skip-title"><div className="card max-w-md p-6"><p className="eyebrow">Before you skip</p><h2 id="skip-title" className="mt-2 text-2xl font-semibold">This will make your results less accurate.</h2><p className="mt-3 leading-7 text-muted">Skipped answers reduce the accuracy of your DesireDNA and make comparisons less complete. You can return to skipped questions before analysis.</p><label className="mt-5 flex cursor-pointer gap-3 rounded-xl border border-white/15 p-3"><input autoFocus type="checkbox" checked={skipAcknowledged} onChange={(event) => setSkipAcknowledged(event.target.checked)} className="h-5 w-5 accent-rose" /><span>I acknowledge that skipping can make my results and comparisons less accurate.</span></label><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button className="btn btn-secondary" onClick={() => { setSkipRequest(null); setSkipAcknowledged(false); }}>Go back</button><button disabled={!skipAcknowledged} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-40" onClick={confirmSkip}>Skip {skipRequest === "category" ? "category" : "question"}</button></div></div></div>}

    {reviewAnswers && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="card max-w-md p-6"><p className="eyebrow">One last check</p><h2 id="review-title" className="mt-2 text-2xl font-semibold">Answer your skipped questions?</h2><p className="mt-3 leading-7 text-muted">You skipped {qs.filter((question) => isSkipped(reviewAnswers[question.id])).length} question(s). Answering them now will make your result and comparisons more complete.</p><div className="mt-6 flex flex-col gap-2"><button className="btn btn-primary" onClick={() => { const first = qs.findIndex((question) => isSkipped(reviewAnswers[question.id])); setAnswers(reviewAnswers); setIndex(first); setReviewAnswers(null); }}>Answer skipped questions</button><button className="btn btn-secondary" onClick={() => void finish(reviewAnswers)}>Analyze with skipped questions</button></div></div></div>}
  </section>;
}
