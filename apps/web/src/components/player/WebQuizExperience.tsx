"use client";

import { useState } from "react";
import type { QuizAnswer } from "@/lib/player/quizGrading";
import { BlockFeedback, feedbackAllowsRetry } from "./BlockFeedback";
import { BoundedAssessmentContainer, type BoundedAssessmentPhase } from "./BoundedAssessmentContainer";
import { isCompleteQuizAnswer, QuizQuestionField, type QuizQuestionDto } from "./QuizQuestionField";

type SubmitResult = {
  completed: boolean;
  feedback?: unknown;
};

type Props = {
  blockId: string;
  title?: string;
  questions: QuizQuestionDto[];
  busy: boolean;
  initiallyComplete?: boolean;
  initialFeedback?: unknown;
  onSubmit: (answers: Record<string, QuizAnswer>) => Promise<SubmitResult | null>;
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
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});
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
    ? feedback as { kind?: string; correct?: boolean; passed?: boolean }
    : null;
  const passed = quizFeedback?.kind === "quiz" ? quizFeedback.passed ?? quizFeedback.correct : undefined;
  const questionFormats = Object.fromEntries(questions.map((question) => [question.id, question.format]));
  const matchingPromptLabels = Object.fromEntries(questions.flatMap((question) => question.matchingPrompts
    ? [[question.id, Object.fromEntries(question.matchingPrompts.map((prompt) => [prompt.id, prompt.text]))]]
    : []));

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
        heading: passed === true ? "Passed" : passed === false ? "Keep going" : "Submitted",
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
              <QuizQuestionField
                blockId={blockId}
                question={question}
                answer={answers[question.id]}
                onChange={(answer) => setAnswers((value) => ({ ...value, [question.id]: answer }))}
              />
            </fieldset>
          ))}
          <BlockFeedback
            feedback={feedback}
            questionPrompts={Object.fromEntries(questions.map((question) => [question.id, question.prompt]))}
            questionFormats={questionFormats}
            matchingPromptLabels={matchingPromptLabels}
          />
          <button
            type="button"
            disabled={busy || questions.some((question) => !isCompleteQuizAnswer(question, answers[question.id]))}
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
          questionFormats={questionFormats}
          matchingPromptLabels={matchingPromptLabels}
        />
      )}
    </BoundedAssessmentContainer>
  );
}
