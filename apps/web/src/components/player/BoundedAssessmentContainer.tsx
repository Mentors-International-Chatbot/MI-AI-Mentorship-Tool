"use client";

import type { ReactNode } from "react";

export type BoundedAssessmentPhase = "entry" | "active" | "verdict";

type Props = {
  payloadType: "reteach_gate" | "web_quiz";
  title: string;
  description: string;
  entryLabel: string;
  phase: BoundedAssessmentPhase;
  busy?: boolean;
  attemptLabel?: string;
  error?: string;
  onEnter: () => void | Promise<void>;
  canComplete?: boolean;
  completeLabel?: string;
  onComplete?: () => void | Promise<void>;
  verdict?: {
    heading: string;
    message: string;
    passed?: boolean;
  };
  returnLabel?: string;
  onReturn?: () => void | Promise<void>;
  children?: ReactNode;
};

/**
 * Payload-agnostic bounded-experience shell.
 *
 * It owns entry, attempt-state framing, the terminal completion control, and
 * the clean return. Conversation turns and quiz answers stay in children and
 * reach payload-specific adapters supplied by the parent.
 */
export function BoundedAssessmentContainer({
  payloadType,
  title,
  description,
  entryLabel,
  phase,
  busy = false,
  attemptLabel,
  error,
  onEnter,
  canComplete = false,
  completeLabel = "Finish",
  onComplete,
  verdict,
  returnLabel = "Continue",
  onReturn,
  children,
}: Props) {
  return (
    <div className="player-bounded" data-payload-type={payloadType} aria-live="polite">
      {phase === "entry" && (
        <div className="player-bounded-entry">
          <h2>{title}</h2>
          <p>{description}</p>
          <button type="button" disabled={busy} onClick={() => void onEnter()}>{entryLabel}</button>
        </div>
      )}

      {phase === "active" && (
        <div className="player-bounded-attempt">
          <div className="player-bounded-heading">
            <div>
              <span className="player-eyebrow">Focused activity</span>
              <h2>{title}</h2>
            </div>
            {attemptLabel && <span className="player-bounded-attempt-label">{attemptLabel}</span>}
          </div>
          {children}
          {canComplete && onComplete && (
            <button type="button" disabled={busy} onClick={() => void onComplete()}>{completeLabel}</button>
          )}
        </div>
      )}

      {phase === "verdict" && verdict && (
        <div className={`player-bounded-verdict${verdict.passed === true ? " is-passed" : verdict.passed === false ? " is-not-passed" : ""}`}>
          <span className="player-eyebrow">Result</span>
          <h2>{verdict.heading}</h2>
          <p>{verdict.message}</p>
          {children}
          {onReturn && <button type="button" disabled={busy} onClick={() => void onReturn()}>{returnLabel}</button>}
        </div>
      )}

      {error && <p className="player-error" role="alert">{error}</p>}
    </div>
  );
}
