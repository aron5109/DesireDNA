"use client";

import { useEffect, useRef } from "react";

import type { AnswerDetails, Experience, Intent, Outcome } from "@/lib/quiz/answer";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-5">
      <legend className="text-sm font-semibold text-cream">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-12 rounded-full border px-4 text-sm ${
        active ? "border-rose bg-rose/20 text-cream" : "border-white/15 bg-white/[.03] text-muted"
      }`}
    >
      {children}
    </button>
  );
}

interface DetailsSheetProps {
  topic: string;
  details: AnswerDetails;
  onChange: (details: AnswerDetails) => void;
  onClose: () => void;
}

const EXPERIENCE: { value: Experience; label: string }[] = [
  { value: "tried", label: "I have tried it" },
  { value: "not_tried", label: "I have not tried it" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const OUTCOME: { value: Outcome; label: string }[] = [
  { value: "positive", label: "It went well" },
  { value: "neutral", label: "It was fine" },
  { value: "negative", label: "It did not go well" },
];

const INTENT: { value: Intent; label: string }[] = [
  { value: "real", label: "Something I would actually do" },
  { value: "conditions", label: "Only under the right conditions" },
  { value: "fantasy_only", label: "Fantasy only" },
];

/**
 * Optional detail for one card. Nothing here is required, nothing is filled in
 * on the person's behalf, and the sheet never opens by itself.
 */
export function DetailsSheet({ topic, details, onChange, onClose }: DetailsSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheet.current) return;

      // Keep focus inside the sheet while it is open.
      const focusable = sheet.current.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const toggle = <K extends keyof AnswerDetails>(key: K, value: AnswerDetails[K]) => {
    const next: AnswerDetails = { ...details };
    if (next[key] === value) delete next[key];
    else next[key] = value;
    // An outcome only means something for something actually tried.
    if (key === "experience" && next.experience !== "tried") delete next.outcome;
    // A hard limit cannot also be real-world intent.
    if (key === "hardLimit" && next.hardLimit) delete next.intent;
    onChange(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" role="presentation">
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="details-title"
        className="card max-h-[85vh] w-full max-w-md overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Optional detail</p>
            <h2 id="details-title" className="mt-1 text-xl font-semibold">
              {topic}
            </h2>
          </div>
          <button ref={closeButton} onClick={onClose} className="btn btn-secondary min-h-12 px-4 text-sm">
            Done
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">Everything here is optional. Leave it blank and nothing is assumed.</p>

        <Row label="Have you tried it?">
          {EXPERIENCE.map((option) => (
            <Chip key={option.value} active={details.experience === option.value} onClick={() => toggle("experience", option.value)}>
              {option.label}
            </Chip>
          ))}
        </Row>

        {details.experience === "tried" && (
          <Row label="How was it?">
            {OUTCOME.map((option) => (
              <Chip key={option.value} active={details.outcome === option.value} onClick={() => toggle("outcome", option.value)}>
                {option.label}
              </Chip>
            ))}
          </Row>
        )}

        {!details.hardLimit && (
          <Row label="Real or fantasy?">
            {INTENT.map((option) => (
              <Chip key={option.value} active={details.intent === option.value} onClick={() => toggle("intent", option.value)}>
                {option.label}
              </Chip>
            ))}
          </Row>
        )}

        <Row label="Boundary">
          <Chip active={details.hardLimit === true} onClick={() => toggle("hardLimit", details.hardLimit ? undefined : true)}>
            This is a hard limit
          </Chip>
        </Row>
        <p className="mt-2 text-sm text-muted">
          A hard limit is recorded as a firm boundary. Nobody is ever shown a suggestion to talk you out of it.
        </p>
      </div>
    </div>
  );
}
