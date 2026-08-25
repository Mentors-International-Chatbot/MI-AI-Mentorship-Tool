"use client";

import { useState } from "react";
import { BlockFeedback, feedbackAllowsRetry } from "./BlockFeedback";
import { BoundedAssessmentContainer, type BoundedAssessmentPhase } from "./BoundedAssessmentContainer";

type Question = {
  id: string;
  prompt: string;
  options?: string[];
  graded: boolean;
};

type SubmitResult = {
  completed: boolean;
  feedback?: unknown;
};

type Props = {
  blockId: string;
  title?: string;
  questions: Question[];
  busy: boolean;
  initiallyComplete?: boolean;
  initialFeedback?: unknown;
  onSubmit: (answers: Record<string, string>) => Promise<SubmitResult | null>;
  onReturnToThread: () => Promise<void>;
};

export function WebQuizExperience({
  blockId,
  title = "Knowledge check",
  questions,
  busy,
  initiallyComplete = false,
  initialFeedback = null,
  onSubmit,
  onReturnToThread,
}: Props) {
  const [phase, setPhase] = useState<BoundedAssessmentPhase>(initiallyComplete ? "verdict" : "entry");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<unknown>(initialFeedback);
  const [attempt, setAttempt] = useState(1);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    const result = await onSubmit(answers);
    if (!result) return;
    setFeedback(result.feedback ?? null);
    if (result.completed) {
      setPhase("verdict");
    } else {
      setAttempt((value) => value + 1);
    }
  }

  async function returnToThread() {
    setError("");
    try {
      await onReturnToThread();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to return to the lesson");
    }
  }

  const quizFeedback = feedback && typeof feedback === "object"
    ? feedback as { kind?: string; correct?: boolean }
    : null;
  const passed = quizFeedback?.kind === "quiz" ? quizFeedback.correct : undefined;

  return (
    <BoundedAssessmentContainer
      payloadType="web_quiz"
      title={title}
      description="Open the quiz when you are ready. Your lesson thread will be waiting when you finish."
      entryLabel="Start quiz"
      phase={phase}
      busy={busy}
      attemptLabel={`Attempt ${attempt}`}
      error={error}
      onEnter={() => setPhase("active")}
      canComplete={false}
      verdict={{
        heading: passed === true ? "Correct" : passed === false ? "Attempt complete" : "Submitted",
        message: passed === true
          ? "Review the result, then return to the lesson."
          : "Your response has been recorded. Return to the lesson when you are ready.",
        passed,
      }}
      returnLabel="Return to lesson"
      onReturn={returnToThread}
    >
      {phase === "active" && (
        <>
          {questions.map((question) => (
            <fieldset key={question.id}>
              <legend>{question.prompt}</legend>
              {question.options?.length ? question.options.map((option) => (
                <label className="player-option" key={option}>
                  <input
                    type="radio"
                    name={`${blockId}-${question.id}`}
                    value={option}
                    checked={answers[question.id] === option}
                    onChange={() => setAnswers((value) => ({ ...value, [question.id]: option }))}
                  />
                  {option}
                </label>
              )) : (
                <input
                  className="player-bounded-short-answer"
                  value={answers[question.id] ?? ""}
                  onChange={(event) => setAnswers((value) => ({ ...value, [question.id]: event.target.value }))}
                  aria-label={question.prompt}
                />
              )}
            </fieldset>
          ))}
          <BlockFeedback
            feedback={feedback}
            questionPrompts={Object.fromEntries(questions.map((question) => [question.id, question.prompt]))}
          />
          <button
            type="button"
            disabled={busy || questions.some((question) => !answers[question.id]?.trim())}
            onClick={() => void submit()}
          >
            {feedbackAllowsRetry(feedback) ? "Try again" : questions.some((question) => question.graded) ? "Submit answer" : "Continue"}
          </button>
        </>
      )}
      {phase === "verdict" && (
        <BlockFeedback
          feedback={feedback}
          questionPrompts={Object.fromEntries(questions.map((question) => [question.id, question.prompt]))}
        />
      )}
    </BoundedAssessmentContainer>
  );
}
