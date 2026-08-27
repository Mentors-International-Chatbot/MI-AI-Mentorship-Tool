"use client";

import { useEffect, useRef, useState } from "react";
import { playerFetch } from "@/lib/player/client";
import { BoundedAssessmentContainer, type BoundedAssessmentPhase } from "./BoundedAssessmentContainer";

type AssessmentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type SessionData = {
  session: {
    status: "pending" | "in_progress" | "completed";
    lessonKey: string;
    blockId: string | null;
    attemptNumber: number;
    passedAt: string | null;
  };
  messages: AssessmentMessage[];
  config: { allowRetake: boolean };
};

type MessageResult = {
  status: "continue" | "passed" | "max_turns";
  response: string;
  requiresCompletion?: boolean;
};

type CompletionResult = {
  passed?: boolean;
  message: string;
  scores?: Record<string, number> | null;
};

type Props = {
  course: string;
  lessonKey: string;
  blockId: string;
  title?: string;
  initiallyComplete?: boolean;
  onWriteBlockCompletion: () => Promise<boolean>;
  onReturnToThread: () => Promise<void>;
};

export function ReteachGateExperience({
  course,
  lessonKey,
  blockId,
  title = "Talk it through",
  initiallyComplete = false,
  onWriteBlockCompletion,
  onReturnToThread,
}: Props) {
  const [phase, setPhase] = useState<BoundedAssessmentPhase>(initiallyComplete ? "verdict" : "entry");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [attemptNumber, setAttemptNumber] = useState<number | null>(null);
  const [messages, setMessages] = useState<AssessmentMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readyToComplete, setReadyToComplete] = useState(false);
  const [terminalPassed, setTerminalPassed] = useState(false);
  const [allowRetake, setAllowRetake] = useState(true);
  const [completion, setCompletion] = useState<CompletionResult | null>(initiallyComplete ? {
    passed: true,
    message: "Your conversation is complete.",
  } : null);

  /**
   * `.player-bounded-conversation` is its own fixed-height (420px) scrollbox,
   * separate from the page — the page-level scroll LessonPlayer's `bottomRef`
   * handles doesn't reach in here. Without this, a new turn renders below the
   * fold of that box and the learner has to notice and scroll manually.
   */
  const conversationRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = conversationRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function enter() {
    setBusy(true);
    setError("");
    try {
      const resolved = await playerFetch<{ sessionId: string }>(
        `/api/learn/${encodeURIComponent(course)}/${encodeURIComponent(lessonKey)}/blocks/${encodeURIComponent(blockId)}/assessment-session`,
        { method: "POST" },
      );
      setSessionId(resolved.sessionId);

      const loaded = await playerFetch<SessionData>(`/api/assessment/${resolved.sessionId}`);
      setAttemptNumber(loaded.session.attemptNumber);
      setAllowRetake(loaded.config.allowRetake);
      setMessages(loaded.messages);

      if (loaded.session.status === "pending") {
        const started = await playerFetch<{ openingMessage: string }>("/api/assessment/start", {
          method: "POST",
          body: JSON.stringify({ lessonKey, blockId, sessionId: resolved.sessionId }),
        });
        setMessages((value) => value.length > 0 ? value : [{
          id: `opening-${resolved.sessionId}`,
          role: "assistant",
          content: started.openingMessage,
        }]);
      }
      setPhase("active");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to start this activity");
    } finally {
      setBusy(false);
    }
  }

  async function sendTurn() {
    const studentText = input.trim();
    if (!studentText || !sessionId || busy || readyToComplete) return;
    setBusy(true);
    setError("");
    setInput("");
    const optimistic: AssessmentMessage = {
      id: `learner-${Date.now()}`,
      role: "user",
      content: studentText,
    };
    setMessages((value) => [...value, optimistic]);
    try {
      const result = await playerFetch<MessageResult>(`/api/assessment/${sessionId}/message`, {
        method: "POST",
        body: JSON.stringify({ message: studentText }),
      });
      setMessages((value) => [...value, {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: result.response,
      }]);
      if (result.requiresCompletion) {
        setReadyToComplete(true);
        setTerminalPassed(result.status === "passed");
      }
    } catch (reason) {
      setMessages((value) => value.filter((message) => message.id !== optimistic.id));
      setInput(studentText);
      setError(reason instanceof Error ? reason.message : "AI Mentor did not reply. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      const result = await playerFetch<CompletionResult>(`/api/assessment/${sessionId}/complete`, {
        method: "POST",
      });
      const passed = result.passed ?? terminalPassed;
      const blockCompleted = await onWriteBlockCompletion();
      if (passed && !blockCompleted) {
        throw new Error("The conversation finished, but lesson progress could not be saved");
      }
      setCompletion({ ...result, passed });
      setPhase("verdict");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to finish this activity");
    } finally {
      setBusy(false);
    }
  }

  async function returnFromVerdict() {
    if (completion?.passed) {
      await onReturnToThread();
      return;
    }
    setSessionId(null);
    setAttemptNumber(null);
    setMessages([]);
    setReadyToComplete(false);
    setTerminalPassed(false);
    setCompletion(null);
    setPhase("entry");
  }

  const score = completion?.scores ? Object.values(completion.scores)[0] : undefined;
  return (
    <BoundedAssessmentContainer
      payloadType="reteach_gate"
      title={title}
      description="Open a focused conversation with AI Mentor. Explain the idea in your own words and respond to follow-up questions."
      entryLabel="Start conversation"
      phase={phase}
      busy={busy}
      attemptLabel={attemptNumber ? `Attempt ${attemptNumber}` : undefined}
      error={error}
      onEnter={enter}
      canComplete={readyToComplete}
      completeLabel="Finish conversation"
      onComplete={finish}
      verdict={completion ? {
        heading: completion.passed ? "You passed" : "Keep working on it",
        message: score === undefined
          ? completion.message
          : `${completion.message} Score: ${Math.round(score * 10) / 10}.`,
        passed: completion.passed,
      } : undefined}
      returnLabel={completion?.passed ? "Return to lesson" : allowRetake ? "Try again" : "Return to lesson"}
      onReturn={returnFromVerdict}
    >
      {phase === "active" && (
        <>
          <div className="player-bounded-conversation" aria-label="Assessment conversation" ref={conversationRef}>
            {messages.map((message) => (
              <div key={message.id} className={`player-message ${message.role === "user" ? "learner" : ""}`}>
                <strong>{message.role === "user" ? "You" : "AI Mentor"}</strong>
                <p>{message.content}</p>
              </div>
            ))}
          </div>
          {!readyToComplete && (
            <div className="player-bounded-input">
              <label htmlFor={`reteach-${blockId}`}>Your response</label>
              <textarea
                id={`reteach-${blockId}`}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={4}
                disabled={busy}
                placeholder="Explain it in your own words…"
              />
              <button type="button" disabled={busy || !input.trim()} onClick={() => void sendTurn()}>Send</button>
            </div>
          )}
        </>
      )}
    </BoundedAssessmentContainer>
  );
}
