"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The learner-facing mirror of `PlayerFeedback` in `@/lib/player/service`.
 *
 * Deliberately re-declared rather than imported: the server type describes what
 * grading *may* produce, and this describes what this component is prepared to
 * draw. Importing would make the two move together, and the whole point of
 * `isQuiz`/`isDragOrder` below is that they are allowed to disagree — a verdict
 * shape this file has never seen must fall through to nothing.
 */
type QuizFeedback = {
  kind: "quiz";
  correct: boolean;
  passed?: boolean;
  retryAvailable: boolean;
  questions: Array<{ questionId: string; correct: boolean; correctAnswer?: string | string[] | Record<string, string>; explanation?: string }>;
};
type DragOrderFeedback = { kind: "drag_order"; correct: boolean; misplacedPositions: number[]; correctOrder?: number[] };
type OnboardingSurveyFeedback = { kind: "onboarding_survey"; closingMessage: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isCorrectAnswer(value: unknown): value is string | string[] | Record<string, string> {
  return typeof value === "string"
    || (Array.isArray(value) && value.every((item) => typeof item === "string"))
    || (isRecord(value) && Object.values(value).every((item) => typeof item === "string"));
}

function isQuiz(value: unknown): value is QuizFeedback {
  return isRecord(value) && value.kind === "quiz" && typeof value.correct === "boolean"
    && typeof value.retryAvailable === "boolean"
    && (value.passed === undefined || typeof value.passed === "boolean")
    && Array.isArray(value.questions)
    && value.questions.every((item) => isRecord(item)
      && typeof item.questionId === "string"
      && typeof item.correct === "boolean"
      && (item.correctAnswer === undefined || isCorrectAnswer(item.correctAnswer))
      && (item.explanation === undefined || typeof item.explanation === "string"));
}

function isDragOrder(value: unknown): value is DragOrderFeedback {
  return isRecord(value) && value.kind === "drag_order" && typeof value.correct === "boolean"
    && Array.isArray(value.misplacedPositions) && value.misplacedPositions.every((item) => typeof item === "number");
}

function isOnboardingSurvey(value: unknown): value is OnboardingSurveyFeedback {
  return isRecord(value) && value.kind === "onboarding_survey" && typeof value.closingMessage === "string";
}

/**
 * Whether this verdict leaves the learner a further attempt at the block.
 *
 * Only ever *narrows* what the server already decided — the block stays on
 * screen because `completeBlock` did not complete it, and this is the label on
 * the button that resubmits it.
 */
export function feedbackAllowsRetry(feedback: unknown): boolean {
  return isQuiz(feedback) && feedback.retryAvailable && !feedback.correct;
}

/**
 * A graded verdict, drawn as a result.
 *
 * Where this component goes, the player used to stringify the grading payload
 * into a `<pre>` — a placeholder that shipped, which meant every graded quiz in
 * every course handed the learner the raw response, answer keys included. Two
 * rules come out of that and both live here:
 *
 *  1. Nothing is rendered by reading arbitrary keys off an object. Each shape is
 *     named, guarded, and drawn by its own branch.
 *  2. An unrecognized shape renders *nothing*. Showing a learner an object is
 *     worse than showing them silence, and silence is a bug report; JSON on the
 *     page is a leak.
 *
 * What is *in* the verdict is the server's decision, not this component's:
 * `correctAnswer` and `explanation` are absent from the payload until the
 * learner has spent their retry, so there is no key here to leak early even if
 * this file wanted to.
 */
export function BlockFeedback({ feedback, questionPrompts, questionFormats, matchingPromptLabels, items }: {
  feedback: unknown;
  /** Question id → authored prompt, so a verdict line names its question. */
  questionPrompts?: Record<string, string>;
  questionFormats?: Record<string, string>;
  matchingPromptLabels?: Record<string, Record<string, string>>;
  /** Source-order labels for a drag block, used to spell out the right order. */
  items?: string[];
}) {
  if (isQuiz(feedback)) {
    const passed = feedback.passed ?? feedback.correct;
    return (
      <section className={`player-feedback ${passed ? "is-correct" : "is-wrong"}`} role="status" aria-live="polite">
        <strong className="player-feedback-verdict">{feedback.correct ? "Correct" : passed ? "Passed" : feedback.retryAvailable ? "Not quite — try again" : "Not quite"}</strong>
        <ol className="player-feedback-list">
          {feedback.questions.map((question) => (
            <li key={question.questionId} className={question.correct ? "is-correct" : "is-wrong"}>
              <span className="player-feedback-mark" aria-hidden="true">{question.correct ? "✓" : "✗"}</span>
              <div>
                <p className="player-feedback-prompt">
                  <span className="player-sr-only">{question.correct ? "Correct: " : "Incorrect: "}</span>
                  {questionPrompts?.[question.questionId] ?? "This question"}
                </p>
                {question.correctAnswer !== undefined && (
                  typeof question.correctAnswer === "string" ? (
                    <p className="player-feedback-answer">Correct answer: {question.correctAnswer}</p>
                  ) : Array.isArray(question.correctAnswer) ? (
                    <p className="player-feedback-answer">
                      Correct answer: {questionFormats?.[question.questionId] === "drag_to_order"
                        ? question.correctAnswer.join(" → ")
                        : question.correctAnswer.join(" or ")}
                    </p>
                  ) : (
                    <div className="player-feedback-answer">
                      <span>Correct matches:</span>
                      <ul>
                        {Object.entries(question.correctAnswer).map(([promptId, answer]) => (
                          <li key={promptId}>{matchingPromptLabels?.[question.questionId]?.[promptId] ?? promptId}: {answer}</li>
                        ))}
                      </ul>
                    </div>
                  )
                )}
                {question.explanation && <div className="player-feedback-why"><ReactMarkdown remarkPlugins={[remarkGfm]}>{question.explanation}</ReactMarkdown></div>}
              </div>
            </li>
          ))}
        </ol>
        {/* Said once, at the bottom, rather than repeated under every missed
            question: the retry is for the block, not for one answer. */}
        {feedback.retryAvailable && !passed && (
          <p className="player-feedback-retry">
            {feedback.passed !== undefined
              ? "Change your answers and submit again. You can keep trying until you pass."
              : "Change your answers and submit again. The correct answers are shown after this attempt."}
          </p>
        )}
      </section>
    );
  }

  if (isDragOrder(feedback)) {
    const order = feedback.correctOrder && items
      ? feedback.correctOrder.map((index) => items[index]).filter((label): label is string => typeof label === "string")
      : [];
    return (
      <section className={`player-feedback ${feedback.correct ? "is-correct" : "is-wrong"}`} role="status" aria-live="polite">
        <strong className="player-feedback-verdict">{feedback.correct ? "Correct" : "Not quite — try again"}</strong>
        {!feedback.correct && (
          <p className="player-feedback-prompt">
            {feedback.misplacedPositions.length === 1
              ? "One item is out of place."
              : `${feedback.misplacedPositions.length} items are out of place.`}
          </p>
        )}
        {order.length > 0 && <ol className="player-feedback-order">{order.map((label, index) => <li key={`${index}-${label}`}>{label}</li>)}</ol>}
      </section>
    );
  }

  if (isOnboardingSurvey(feedback)) {
    return (
      <section className="player-feedback is-correct" role="status" aria-live="polite">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{feedback.closingMessage}</ReactMarkdown>
      </section>
    );
  }

  // Unrecognized — including null, the ungraded-poll case. Render nothing.
  return null;
}
