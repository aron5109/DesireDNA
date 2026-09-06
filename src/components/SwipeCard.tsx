"use client";

import { useCallback, useRef, useState } from "react";

import type { Interest } from "@/lib/quiz/answer";
import type { QuestionCard } from "@/lib/quiz/bank-types";

/** How far a horizontal drag must travel before it counts as an answer. */
const COMMIT_DISTANCE = 88;
/** Below this the gesture is treated as a tap, not a drag. */
const DRAG_THRESHOLD = 10;
/** A drag is horizontal only if it clearly out-runs the vertical movement. */
const HORIZONTAL_RATIO = 1.3;

interface SwipeCardProps {
  card: QuestionCard;
  /** Called once per completed gesture. */
  onAnswer: (interest: Interest) => void;
  swipeEnabled: boolean;
  reduceMotion: boolean;
  children: React.ReactNode;
}

/**
 * The draggable question card.
 *
 * Pointer events are captured on the card itself, never on the document, and a
 * gesture only counts when it is clearly horizontal and travels far enough.
 * Anything shorter, more vertical, or cancelled springs back without answering,
 * so scrolling the page can never record a preference by accident.
 */
export function SwipeCard({ card, onAnswer, swipeEnabled, reduceMotion, children }: SwipeCardProps) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const axis = useRef<"undecided" | "horizontal" | "vertical">("undecided");
  /** Guards against a second commit from the same gesture or a stray click. */
  const committed = useRef(false);

  const reset = useCallback(() => {
    start.current = null;
    axis.current = "undecided";
    setDragging(false);
    setOffset(0);
  }, []);

  const commit = useCallback(
    (interest: Interest) => {
      if (committed.current) return;
      committed.current = true;
      reset();
      onAnswer(interest);
      // Released on the next frame so a trailing click cannot double-answer.
      window.setTimeout(() => {
        committed.current = false;
      }, 250);
    },
    [onAnswer, reset],
  );

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!swipeEnabled) return;
    // Never start a drag from inside a control or a field.
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea, [role='dialog']")) return;
    start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    axis.current = "undecided";
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const origin = start.current;
    if (!origin || origin.id !== event.pointerId) return;

    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;

    if (axis.current === "undecided") {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      // Let the page scroll if the movement is not clearly sideways.
      axis.current = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO ? "horizontal" : "vertical";
      if (axis.current === "horizontal") {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }
    }

    if (axis.current !== "horizontal") return;
    setOffset(dx);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const origin = start.current;
    if (!origin || origin.id !== event.pointerId) return;

    const travelled = offset;
    const wasHorizontal = axis.current === "horizontal";
    reset();

    if (!wasHorizontal) return;
    if (travelled <= -COMMIT_DISTANCE) commit("no");
    else if (travelled >= COMMIT_DISTANCE) commit("yes");
    // Anything shorter simply springs back.
  }

  /** A cancelled pointer (a call, a system gesture) must never answer. */
  function onPointerCancel() {
    reset();
  }

  const intent = offset <= -COMMIT_DISTANCE ? "no" : offset >= COMMIT_DISTANCE ? "yes" : null;
  const rotation = reduceMotion ? 0 : Math.max(-8, Math.min(8, offset / 14));

  return (
    <div
      className="relative touch-pan-y select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{
        transform: reduceMotion ? undefined : `translateX(${offset}px) rotate(${rotation}deg)`,
        transition: dragging ? "none" : reduceMotion ? "none" : "transform 180ms ease-out",
      }}
    >
      {/* Directional feedback, shown only while a horizontal drag is live. */}
      {dragging && (
        <>
          <span
            aria-hidden="true"
            className={`absolute left-4 top-4 z-10 rounded-full border-2 px-3 py-1 text-sm font-bold uppercase tracking-wide transition-opacity ${
              intent === "no" ? "border-rose text-rose opacity-100" : "opacity-30 border-white/40 text-white/60"
            }`}
          >
            Not for me
          </span>
          <span
            aria-hidden="true"
            className={`absolute right-4 top-4 z-10 rounded-full border-2 px-3 py-1 text-sm font-bold uppercase tracking-wide transition-opacity ${
              intent === "yes" ? "border-emerald-400 text-emerald-300 opacity-100" : "opacity-30 border-white/40 text-white/60"
            }`}
          >
            Into it
          </span>
        </>
      )}
      <div className="card flex min-h-[34svh] flex-col justify-center p-5" data-testid={`card-${card.id}`}>
        {children}
      </div>
    </div>
  );
}
