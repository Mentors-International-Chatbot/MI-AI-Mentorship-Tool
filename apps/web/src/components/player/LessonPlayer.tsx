"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { playerFetch } from "@/lib/player/client";
import type { LessonDashboard } from "@/lib/player/dashboard";
import { BlockFeedback, feedbackAllowsRetry } from "./BlockFeedback";
import { HelpRequestPanel } from "./HelpRequestPanel";
import { PlayerDashboard } from "./PlayerDashboard";
import { SortableOrderItem } from "./SortableOrderItem";
import { usePlayerThread } from "./usePlayerThread";
import { ReteachGateExperience } from "./ReteachGateExperience";
import { WebQuizExperience } from "./WebQuizExperience";
import "./player.css";

type BlockBase = {
  id: string;
  order: number;
  blockType: string;
  contentVersion: number;
  concepts: string[];
  handoff?: string;
  assessment?: { mode: "reteach_gate" | "web_quiz" };
};
type Teach = BlockBase & { blockType: "teach"; content: string; expectsResponse?: boolean };
type Quiz = BlockBase & { blockType: "quiz_checkpoint"; title?: string; questions: Array<{
  id: string;
  prompt: string;
  format: "multiple_choice" | "short_answer" | "fill_in_blank" | "drag_to_order" | "matching";
  options?: string[];
  matchingPrompts?: Array<{ id: string; text: string }>;
  graded: boolean;
}> };
type Drag = BlockBase & { blockType: "drag_order"; prompt: string; items: string[] };
type TeachBack = BlockBase & { blockType: "teach_back"; prompt: string };
type Media = BlockBase & { blockType: "media"; kind: string; config: Record<string, unknown>; caption?: string };
type ResourceValue =
  | { type: "weblink"; url: string; label: string; description?: string }
  | { type: "textbook_reference"; title?: string; isbn?: string; chapter?: string; page?: string; callout?: string }
  | { type: "mcp_connector"; connector: string; context?: string };
type Resource = BlockBase & { blockType: "resource"; resource: ResourceValue };
type Project = BlockBase & { blockType: "project"; content: string; requiresSubmission?: boolean; blocking?: boolean };
type OnboardingSurvey = BlockBase & { blockType: "onboarding_survey"; steps: Array<{ id: string; prompt: string; field: string }> };
type Block = Teach | Quiz | Drag | TeachBack | Media | Resource | Project | OnboardingSurvey | BlockBase;
type ProgressItem = { blockId: string; completedAt: string | null; state?: { turnCount?: number; stepIndex?: number; reviewPending?: boolean }; feedback?: unknown; surveyAnswers?: Record<string, string> };
type LessonDto = {
  lesson: { key: string; title: string; category?: string; keyConcepts: string[]; blocks: Block[] };
  /** B.1: authored course opener, present only entering the course's first lesson. */
  introMessage?: string | null;
  previousLessonKey: string | null; nextLessonKey: string | null;
  hasCapstone: boolean;
  helpRequestEnabled?: boolean;
  /** Null for a course without project selection, or a learner without a project. */
  dashboard?: LessonDashboard | null;
  progress: ProgressItem[];
};
type CompleteBlockResult = {
  completed: boolean;
  feedback?: unknown;
  reviewPending?: boolean;
  /** C.1: a teach block's milestoneRef checkpoint, unresolved. Null once done/skip is recorded. */
  interleave?: { milestoneKey: string; prompt: string } | null;
};
type ParentIntent = "question" | "teach_back" | "lesson_entry" | "capstone";
const PARENT_INTENTS: ParentIntent[] = ["question", "teach_back", "lesson_entry", "capstone"];

/**
 * Fixed prompts for the docked tutor, sent with the current block as context.
 *
 * Deliberately not authored per block: a block type carrying its own chips was
 * the more expensive option and would have needed schema, converter, renderer
 * and progress semantics for what is a shortcut into an input that already
 * exists. These two are course-neutral, so they need no configuration.
 *
 * "No questions, continue" is not here — that is the block's own Next button,
 * and a second control doing the same thing is worse than none.
 */
const TUTOR_CHIPS = ["Give me an example", "Can you rephrase that?"] as const;
/**
 * One entry in the lesson thread, discriminated by `kind` the way the chat
 * surface discriminates its assessment card.
 *
 * `block` and `prompt` are *derived* from the lesson body rather than copied
 * into the messages table. Authored content already has a home — the published
 * lesson version — and a second copy could drift from it. Deriving also makes
 * the text verbatim by construction: there is no path by which a model turn
 * could rewrite it.
 */
type ThreadItem =
  | { kind: "block"; key: string; content: string; externalLinks?: boolean }
  | { kind: "prompt"; key: string; content: string }
  | { kind: "divider"; key: string }
  | {
      kind: "tutor";
      key: string;
      role: "learner" | "mentor";
      /**
       * `Message.senderType`, carried through so the render can tell a human
       * mentor's reply apart from the AI's. Legacy rows predate the column and
       * read `null` — those must keep rendering as the AI, not as "unknown".
       */
      senderType: string | null;
      content: string;
      parentIntent?: ParentIntent;
      blockId?: string;
    };

/**
 * Every `/api/chat` call below passes the `course` route prop. It used to send
 * the literal `"AIESS"`, which was harmless only while AI Essentials was the
 * sole player course: `ValidatedPlayerContext.courseCode` was typed `"AIESS"`,
 * so the compiler agreed with the hardcoded value in each caller, and the chat
 * route rejected anything else outright.
 *
 * Both were widened when the second player course landed. The route now defers
 * to `resolvePlayerAccess`, which is the real authority on whether a learner
 * may take a tutor turn in a given course.
 */
/**
 * What a finished block looks like in the thread. Authored strings only — the
 * teach body, the question that was asked — never a generated summary.
 */
/**
 * What the block's primary control says.
 *
 * `expectsResponse` never reaches here any more: those blocks render their one
 * control next to the box instead of on the card, because the action is "send
 * what you wrote" and that belongs with the writing. See `requiresResponse`.
 *
 * Text in the box still wins on every other teach block — that is the
 * send-before-advance floor made visible before it happens.
 */
function primaryLabel(typed: string): string {
  return typed.trim() ? "Send and continue" : "Next";
}

/**
 * Three gates hold a block from advancing. They answer different questions
 * and none of them is a variation on another:
 *
 *   requiresResponse   client-side, this file. Gates on *something being
 *                       typed*. See the note on `requiresResponse` below.
 *   teach_back          server-side, `preparePlayerContext` /
 *                       `recordPlayerTutorSuccess` in player/service.ts.
 *                       Gates on *the tutor having replied twice*.
 *   open-question gate   server-side, `completeBlock` in player/service.ts.
 *                       Gates on *the mentor's last reply for this block not
 *                       being an unanswered question* and persists that hold.
 *
 * A fourth gate that reads like a variant of one of these belongs in this
 * list, not bolted onto the nearest existing one.
 */
const OPEN_QUESTION_GATE_CAP = 5;

/** Split durable progress into blocks that may move on and blocks awaiting review. */
export function hydrateBlockProgress(progress: ProgressItem[]) {
  const completed = new Set<string>();
  const submittedComplete = new Set<string>();
  const feedback: Record<string, unknown> = {};
  for (const item of progress) {
    if (!item.completedAt) continue;
    if (item.state?.reviewPending === true) {
      submittedComplete.add(item.blockId);
      if (item.feedback !== undefined) feedback[item.blockId] = item.feedback;
    }
    else completed.add(item.blockId);
  }
  return { completed, submittedComplete, feedback };
}

export function historyContent(block: Block, surveyAnswers?: Record<string, string>): string | null {
  if (block.blockType === "teach") return (block as Teach).content;
  if (block.blockType === "project") return (block as Project).content;
  // Bug 2: this used to join only the authored prompts, dropping every
  // answer the learner actually gave — the live per-step bubbles show the
  // question, but once the block completes its history collapsed to
  // questions with no answers at all. `surveyAnswers` is keyed by `field`,
  // same as the block's own accumulated response object.
  if (block.blockType === "onboarding_survey") {
    return (block as OnboardingSurvey).steps
      .map((step) => {
        const answer = surveyAnswers?.[step.field];
        return answer !== undefined ? `**${step.prompt}**\n\n${answer}` : `**${step.prompt}**`;
      })
      .join("\n\n");
  }
  if (block.blockType === "teach_back") return (block as TeachBack).prompt;
  if (block.blockType === "drag_order") return (block as Drag).prompt;
  if (block.blockType === "quiz_checkpoint") {
    return (block as Quiz).questions.map((question) => `**${question.prompt}**`).join("\n\n");
  }
  if (block.blockType === "media") {
    const media = block as Media;
    return [media.kind, media.caption].filter((value): value is string => value !== undefined).join("\n\n");
  }
  if (block.blockType === "resource") {
    const resource = (block as Resource).resource;
    if (resource.type === "weblink") {
      return [resource.label, resource.description, `[${resource.label}](${resource.url})`]
        .filter((value): value is string => value !== undefined)
        .join("\n\n");
    }
    if (resource.type === "textbook_reference") {
      return [resource.title, resource.isbn, resource.chapter, resource.page, resource.callout]
        .filter((value): value is string => value !== undefined)
        .join("\n\n");
    }
    return [resource.connector, resource.context]
      .filter((value): value is string => value !== undefined)
      .join("\n\n");
  }
  return null;
}

/**
 * The prompt bubbles for an onboarding_survey's steps *before* the one
 * currently showing, mirroring `teach_back`'s "a question being asked reads
 * as a message" treatment (see the `teach_back` case in `threadItems`) —
 * generalized to a block with several internal steps instead of one.
 *
 * The live step is deliberately excluded: it now lives in the pinned card
 * (see the merged input in the render below), so mirroring it into the
 * thread too printed the same question twice. Each mirrored step carries its
 * answer, keyed by `field` out of the same `surveyAnswers` map the completed
 * -history branch reads, so the thread reads as Q&A rather than a stack of
 * bare questions.
 *
 * A pure function of `(blockId, steps, stepIndex, answers)`, not an event:
 * called fresh on every `threadItems` recompute, so there is no "already
 * mirrored" state to track and nothing to duplicate. The same inputs always
 * produce the same array of stable keys, whether reached by stepping through
 * the survey turn by turn or by loading straight into it mid-survey after a
 * reload — history and live progression render identically.
 */
export function onboardingSurveyPromptBubbles(
  blockId: string,
  steps: ReadonlyArray<{ prompt: string; field: string }>,
  stepIndex: number,
  answers?: Record<string, string>,
): ThreadItem[] {
  if (steps.length === 0) return [];
  const answeredThrough = Math.min(Math.max(stepIndex, 0), steps.length);
  const items: ThreadItem[] = [];
  for (let index = 0; index < answeredThrough; index += 1) {
    const step = steps[index];
    const answer = answers?.[step.field];
    items.push({
      kind: "prompt",
      key: `${blockId}-step-${index}-prompt`,
      content: answer !== undefined ? `**${step.prompt}**\n\n${answer}` : `**${step.prompt}**`,
    });
  }
  return items;
}

function MediaBlock({ block }: { block: Media }) {
  const kind = block.kind.trim() || "media";
  return <>
    <h2>{kind}</h2>
    {block.caption && <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.caption}</ReactMarkdown>}
    <p className="player-teachback-hint">This {kind} does not have an in-player preview yet.</p>
  </>;
}

function ResourceBlock({ block }: { block: Resource }) {
  const resource = block.resource;
  if (resource.type === "weblink") {
    return <>
      <h2>{resource.label}</h2>
      {resource.description && <ReactMarkdown remarkPlugins={[remarkGfm]}>{resource.description}</ReactMarkdown>}
      <p><a href={resource.url} target="_blank" rel="noopener noreferrer">Open resource</a></p>
    </>;
  }
  if (resource.type === "textbook_reference") {
    return <>
      <h2>{resource.title ?? "Textbook reference"}</h2>
      {(resource.isbn || resource.chapter || resource.page) && <dl>
        {resource.isbn && <><dt>ISBN</dt><dd>{resource.isbn}</dd></>}
        {resource.chapter && <><dt>Chapter</dt><dd>{resource.chapter}</dd></>}
        {resource.page && <><dt>Page</dt><dd>{resource.page}</dd></>}
      </dl>}
      {resource.callout && <ReactMarkdown remarkPlugins={[remarkGfm]}>{resource.callout}</ReactMarkdown>}
    </>;
  }
  return <>
    <h2>Connected resource</h2>
    {resource.context && <ReactMarkdown remarkPlugins={[remarkGfm]}>{resource.context}</ReactMarkdown>}
    <p className="player-teachback-hint">Connector: {resource.connector}</p>
  </>;
}

export function LessonPlayer({ course, lessonKey }: { course: string; lessonKey: string }) {
  const [data, setData] = useState<LessonDto | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * A tutor turn is in flight. Separate from `busy`, which also covers block
   * completion — that returns in well under a second and needs no indicator,
   * while a tutor turn runs 3.5-5.2s and reads as a frozen page without one.
   *
   * Carries the learner's own text so it can be shown immediately, in the
   * thread, before the server round trip returns it.
   */
  const [pending, setPending] = useState<{ learnerText?: string } | null>(null);
  /** Tutor failure, rendered where the reply would have been. */
  const [tutorError, setTutorError] = useState("");
  /**
   * Consecutive failed sends on the current block. Reset on success and on
   * every block change.
   *
   * Only `requiresResponse` blocks read it, and only to decide whether to offer
   * a way past a tutor that is not answering. Removing "Skip for now" removes
   * the learner's only other exit, and block 1 of SKILLS is the first block of
   * the lesson: an outage there would otherwise mean nobody can enter the
   * course at all. One failure leaves a working retry, which is the floor;
   * the second says the retry is not the problem.
   */
  const [sendFailures, setSendFailures] = useState(0);
  /**
   * Consecutive blocks completed via the open-question gate rather than
   * straight through. Backstop only, per the three-gate note above: Continue
   * already gets a gated block unstuck in
   * one click, so nothing here is load-bearing for "can the learner proceed."
   * It exists so a systematic problem — the model ending every reply in a
   * question despite the style contract — degrades to "the gate stops
   * pausing" instead of pausing every single block for the rest of the
   * lesson. Reset on any block that completes without gating.
   */
  const [gatedStreak, setGatedStreak] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<Record<string, unknown>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<number[]>([]);
  const [question, setQuestion] = useState("");
  const { messages: threadMessages, reload: loadThread } = usePlayerThread(course, lessonKey);
  const [teachBackTurn, setTeachBackTurn] = useState(1);
  const [submittedComplete, setSubmittedComplete] = useState<Set<string>>(new Set());
  const [surveyStepIndex, setSurveyStepIndex] = useState(0);
  /** C.1: the current block's milestoneRef checkpoint, held until Done/Skip. */
  const [pendingInterleave, setPendingInterleave] = useState<{ blockId: string; prompt: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    let active = true;
    playerFetch<LessonDto>(`/api/learn/${encodeURIComponent(course)}/${encodeURIComponent(lessonKey)}`)
      .then((result) => {
        if (!active) return;
        const hydrated = hydrateBlockProgress(result.progress);
        setData(result);
        setCompleted(hydrated.completed);
        setSubmittedComplete(hydrated.submittedComplete);
        setFeedback(hydrated.feedback);
      })
      .catch((reason: Error & { code?: string }) => {
        if (reason.code === "project_required") window.location.assign(`/learn/${course}/project-setup`);
        else if (reason.code === "diagnostic_required") window.location.assign(`/learn/${course}/diagnostic`);
        else setError(reason.message);
      });
    return () => { active = false; };
  }, [course, lessonKey]);

  const current = useMemo(() => data?.lesson.blocks.find((block) => !completed.has(block.id)) ?? null, [data, completed]);
  const boundedMode = current?.assessment?.mode;
  const teachingBack = current?.blockType === "teach_back" && boundedMode !== "reteach_gate";
  /**
   * This block asks for typed text and will not advance without it.
   *
   * The block used to offer "Skip for now" on the card *and* "Ask a question"
   * under the box. Two controls, and the prominent one was the one that
   * abandoned the interaction, so the way out read as the way forward. Now
   * there is one: a primary send-and-advance button under the box, disabled
   * until something is typed.
   */
  const requiresResponse = (current?.blockType === "teach" && (current as Teach).expectsResponse === true)
    || (current?.blockType === "project" && (current as Project).requiresSubmission === true);
  const isSurvey = current?.blockType === "onboarding_survey";
  /**
   * A block that asks for typed text gets its input merged into the pinned
   * lesson card instead of the docked aside below it — one box, directly
   * under whatever is asking, rather than two or three disconnected cards.
   * Decided by block type alone, not by review state:
   * `tutorInputPanel` below is what decides whether that merged box has
   * anything in it once a block is `submittedComplete`.
   */
  const isTextAnswerBlock = isSurvey || teachingBack || requiresResponse;
  useEffect(() => {
    if (current?.blockType === "drag_order") setOrder((current as Drag).items.map((_, index) => index));
    const savedTurn = data?.progress.find((item) => item.blockId === current?.id)?.state?.turnCount;
    const savedStepIndex = data?.progress.find((item) => item.blockId === current?.id)?.state?.stepIndex;
    const savedFeedback = data?.progress.find((item) => item.blockId === current?.id)?.feedback;
    setAnswers({}); setFeedback(savedFeedback === undefined || !current ? {} : { [current.id]: savedFeedback }); setTeachBackTurn(savedTurn === 1 ? 2 : 1); setSurveyStepIndex(typeof savedStepIndex === "number" ? savedStepIndex : 0); setSendFailures(0); setPendingInterleave(null);
  }, [current, data]);

  async function complete(response?: unknown): Promise<CompleteBlockResult | null> {
    if (!current) return null;
    setBusy(true); setError("");
    try {
      const result = await playerFetch<CompleteBlockResult>(`/api/learn/${course}/${lessonKey}/blocks/${current.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ response, openQuestionGateEnabled: gatedStreak < OPEN_QUESTION_GATE_CAP }),
      });
      setFeedback((value) => ({ ...value, [current.id]: result.feedback }));
      if (result.completed) {
        if (result.interleave) {
          // Holds the block open on its milestone checkpoint instead of
          // advancing — mirrors reviewPending's "server-authoritative pause"
          // shape, just for a done/skip decision instead of graded feedback.
          setPendingInterleave({ blockId: current.id, prompt: result.interleave.prompt });
          setGatedStreak(0);
        } else if (result.reviewPending) {
          // Server-authoritative review state. This covers graded feedback and
          // unanswered mentor questions, and survives a reload through progress.
          setSubmittedComplete((value) => new Set(value).add(current.id));
          if (!result.feedback) setGatedStreak((value) => value + 1);
          else setGatedStreak(0);
        } else {
          setCompleted((value) => new Set(value).add(current.id));
          setGatedStreak(0);
        }
      }
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save progress");
      return null;
    }
    finally { setBusy(false); }
  }

  /**
   * The block's primary control. Sends whatever is in the tutor box first, then
   * completes the block.
   *
   * This is the floor, and it applies to every block regardless of authoring:
   * "advance the lesson" and "send to the mentor" used to be separate controls
   * in separate places, so a learner who typed an answer and then pressed Next
   * had it silently discarded. `expectsResponse` makes the invitation legible
   * on blocks that ask for one; this makes discarding impossible on all of them.
   *
   * Send, await, then complete — in that order, so the learner watches their
   * message land instead of watching the block vanish out from under it. A
   * failed send aborts the advance rather than completing anyway: `askTutor`
   * puts the text back in the box, and completing here would throw it away
   * again through a different door.
   */
  async function advance(response?: unknown) {
    if (question.trim()) {
      const sent = await askTutor();
      if (!sent) return;
    }
    await complete(response);
  }

  /**
   * onboarding_survey's steps are canned questions, not a conversation — each
   * answer is graded deterministically server-side (see gradePlayerBlock),
   * never by the model. `advance()` cannot be reused here: it sends any
   * typed text to `askTutor()` first, which would turn every one of the
   * course's canned questions into a live AI turn. This calls `complete()`
   * directly with the raw answer, exactly like `drag_order`'s `advance(order)`
   * bypasses the tutor for a non-text response.
   */
  async function submitSurveyStep() {
    const answer = question.trim();
    if (!answer) return;
    setQuestion("");
    const result = await complete(answer);
    // Every other block type advances by changing `current` (its id leaves
    // `completed`), which re-renders on its own. onboarding_survey's steps
    // all share one block id, so nothing else moves `current` between them —
    // without this, the card keeps showing the just-answered question until
    // a full reload re-derives `surveyStepIndex` from the server. A learner
    // who doesn't know to reload sees a frozen screen and re-answers it,
    // which the server then silently files under the next unanswered field.
    if (result && !result.completed) setSurveyStepIndex((value) => value + 1);
    // Mirror the answer into local `data.progress` too, not just the step
    // pointer: `onboardingSurveyPromptBubbles` reads surveyAnswers from
    // `data.progress`, the same place the completed-history branch reads it
    // from. Without this, a step answered this session — before any reload
    // refetches the lesson — mirrored into the thread as a bare question
    // again once the live step moved past it: the exact bug Part 2 removes,
    // just shifted from the live step to the one behind it.
    //
    // Also writes the same next index into that item's `state.stepIndex`.
    // The block-change effect below reruns on any `data` change (it depends
    // on `[current, data]`) and re-derives `surveyStepIndex` from exactly
    // that field — leaving it stale here would have the effect stamp
    // `surveyStepIndex` right back down the moment this `setData` commits.
    if (result && !result.completed) {
      const surveyBlock = current?.blockType === "onboarding_survey" ? current as OnboardingSurvey : undefined;
      const field = surveyBlock?.steps[surveyStepIndex]?.field;
      if (surveyBlock && field) {
        const nextStepIndex = surveyStepIndex + 1;
        setData((value) => value && {
          ...value,
          progress: value.progress.map((item) => item.blockId === surveyBlock.id
            ? {
                ...item,
                surveyAnswers: { ...item.surveyAnswers, [field]: answer },
                state: { ...(item.state ?? {}), stepIndex: nextStepIndex },
              }
            : item),
        });
      }
    }
  }

  async function advanceReviewedBlock() {
    if (!current) return;
    setBusy(true); setError("");
    try {
      await playerFetch(`/api/learn/${course}/${lessonKey}/blocks/${current.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ acknowledgeReview: true }),
      });
      setSubmittedComplete((value) => { const next = new Set(value); next.delete(current.id); return next; });
      setCompleted((value) => new Set(value).add(current.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save review progress");
    } finally {
      setBusy(false);
    }
  }

  /** C.1: "done" records the milestone reached; "skip" just moves on. Either way the block advances. */
  async function resolveInterleave(action: "done" | "skip") {
    if (!current) return;
    setBusy(true); setError("");
    try {
      await playerFetch(`/api/learn/${course}/${lessonKey}/blocks/${current.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ interleaveAction: action }),
      });
      setPendingInterleave(null);
      setCompleted((value) => new Set(value).add(current.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save milestone check-in");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The one place a learner's text reaches the tutor.
   *
   * There used to be two: this box and a `teach_back` textarea with its own
   * "Share with AI Mentor" button, both posting to `/api/chat` and differing
   * only by `intent`. Two text inputs on one screen is the problem the redesign
   * exists to remove, so the intent now follows the current block instead of
   * following which box was typed into.
   *
   * Nothing about completion moved to the client. `preparePlayerContext`
   * rejects a `teach_back` intent on a block that is not one, counts the turn
   * server-side, and `recordPlayerTutorSuccess` writes the progress row — which
   * is why `gradePlayerBlock` refuses to complete a teach-back any other way.
   *
   * `preset` comes from a tutor chip: a shortcut into this path, not a second one.
   */
  async function askTutor(preset?: string): Promise<boolean> {
    const content = (preset ?? question).trim();
    if (!content) return false;
    const teachingBack = current?.blockType === "teach_back" && current.assessment?.mode !== "reteach_gate";
    // A motivating-activity project submission is relayed and acknowledged,
    // not answered as a question — see the "project" case in
    // `intentCalibration` (responseStyle.ts) for why `question`'s Socratic
    // clarification behavior was the wrong contract for it.
    const isProjectSubmission = current?.blockType === "project" && (current as Project).requiresSubmission === true;
    const intent = teachingBack ? "teach_back" as const : isProjectSubmission ? "project" as const : "question" as const;
    const blockId = current?.id;
    setBusy(true); setError(""); setTutorError("");
    // Clear the box and echo the text into the thread straight away. On failure
    // it goes back, so a failed turn never costs the learner what they wrote.
    setQuestion("");
    setPending({ learnerText: content });
    try {
      const result = await playerFetch<{ response: string; isError?: boolean }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: content, context: { surface: "player", courseCode: course, lessonKey, blockId, intent } }),
      });
      await loadThread();
      setSendFailures(0);
      if (teachingBack && current && !result.isError) {
        // Turn 2 completes the block server-side, but the learner decides when
        // to leave it. Auto-advancing buried the mentor's closing feedback under
        // the next block the instant it arrived — and when that feedback ended
        // in a question, it read as the mentor abandoning its own question.
        //
        // `submittedComplete` is the review state quiz blocks already use:
        // recorded on the server, still on screen, waiting for Continue. The
        // learner can keep talking to the tutor from here; further turns stay at
        // turn 2 server-side and re-stamp the same completion.
        if (teachBackTurn === 2) setSubmittedComplete((value) => new Set(value).add(current.id));
        else setTeachBackTurn(2);
      }
      return true;
    } catch (reason) {
      setQuestion(content);
      setSendFailures((value) => value + 1);
      setTutorError(reason instanceof Error ? reason.message : "AI Mentor did not reply. Try sending that again.");
      return false;
    }
    finally { setBusy(false); setPending(null); }
  }

  async function explainMore(parentIntent: ParentIntent, blockId?: string) {
    setBusy(true); setError(""); setTutorError("");
    setPending({});
    try {
      await playerFetch<{ response: string }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ context: { surface: "player", courseCode: course, lessonKey, blockId, intent: "expand", parentIntent } }),
      });
      await loadThread();
    } catch (reason) {
      setTutorError(reason instanceof Error ? reason.message : "AI Mentor could not expand that. Try again.");
    }
    finally { setBusy(false); setPending(null); }
  }

  /**
   * History for the blocks the learner has finished, plus every tutor turn,
   * in lesson order.
   *
   * The *current* block is deliberately absent: its content lives in the pinned
   * card below so that a reference-heavy block — exact URLs, numbered setup
   * steps — cannot scroll out of view the moment the learner asks a question
   * about step three. Once complete it moves in here and becomes re-readable,
   * without its controls: the thread is a record, not a second set of buttons.
   */
  const threadItems = useMemo<ThreadItem[]>(() => {
    if (!data) return [];

    // Human mentor DMs are learner-level and therefore carry no block id. For
    // display only, place each one after the most recent persisted block turn;
    // if the lesson has no turns yet, place it with the current block. This
    // preserves the createdAt ordering supplied by `usePlayerThread` without
    // putting every global mentor message at the top of the lesson.
    const mentorBlockIds = new Map<string, string | undefined>();
    let precedingBlockId: string | undefined;
    for (const message of threadMessages) {
      const explicitBlockId = typeof message.metadata?.blockId === "string"
        ? message.metadata.blockId
        : undefined;
      if (message.senderType === "mentor") {
        mentorBlockIds.set(message.id, explicitBlockId ?? precedingBlockId ?? current?.id);
      } else if (explicitBlockId) {
        precedingBlockId = explicitBlockId;
      }
    }

    const tutorFor = (blockId: string | undefined): ThreadItem[] => threadMessages
      .filter((message) => {
        const meta = message.metadata ?? {};
        const messageBlockId = message.senderType === "mentor"
          ? mentorBlockIds.get(message.id)
          : meta.blockId as string | undefined;
        if (messageBlockId !== blockId) return false;
        // `lesson_entry` and `expand` send a canned string the learner never
        // typed. Showing "Introduce this lesson." as their own words would be a
        // small lie about who said what.
        return !(message.role === "user" && (meta.intent === "lesson_entry" || meta.intent === "expand"));
      })
      .map((message) => {
        const intent = message.metadata?.intent;
        return {
          kind: "tutor" as const,
          key: message.id,
          role: message.role === "user" ? "learner" as const : "mentor" as const,
          senderType: message.senderType,
          content: message.content,
          blockId,
          parentIntent: PARENT_INTENTS.includes(intent as ParentIntent) ? intent as ParentIntent : undefined,
        };
      });

    // B.1: the authored course intro, when present, is the thread's very
    // first item — ahead of any tutor turn or block. Derived verbatim from
    // package metadata, never a model turn, same as `handoff`/teach-back
    // prompts below.
    const items: ThreadItem[] = data.introMessage
      ? [{ kind: "prompt", key: "course-intro", content: data.introMessage }, ...tutorFor(undefined)]
      : [...tutorFor(undefined)];
    for (const block of data.lesson.blocks) {
      const isDone = completed.has(block.id);
      const isCurrent = current?.id === block.id;
      if (!isDone && !isCurrent) break;
      const surveyAnswers = block.blockType === "onboarding_survey"
        ? data.progress.find((item) => item.blockId === block.id)?.surveyAnswers
        : undefined;
      if (isDone) {
        const history = historyContent(block, surveyAnswers);
        if (history) items.push({
          kind: "block",
          key: block.id,
          content: history,
          externalLinks: block.blockType === "resource" && (block as Resource).resource.type === "weblink",
        });
      }
      // Bug 3: a uniform, content-free signal that a new block just became
      // current — independent of block type, and independent of whether
      // that block has an authored `handoff` or a prompt-mirror of its own.
      // Without this, a live AI reply belonging to the PREVIOUS block sits
      // directly above the new pinned card with nothing marking the seam
      // between them, for every block type that isn't teach_back or
      // onboarding_survey (i.e. most of them: teach, project,
      // quiz_checkpoint, drag_order, media, resource). Suppressed for
      // teach_back/onboarding_survey specifically: their own prompt-mirror
      // already reads as "something new just arrived" — stacking a second,
      // wordless signal on top of an already-visible one is redundant, not
      // clarifying.
      if (isCurrent && block.blockType !== "teach_back" && block.blockType !== "onboarding_survey") {
        items.push({ kind: "divider", key: `${block.id}-transition` });
      }
      // An authored transition into this block, so a quiz that follows a
      // conversation arrives as part of the flow instead of materializing
      // under the mentor's last reply. Same derivation as the teach-back
      // prompt below it: verbatim from the block body, never a model turn.
      if (isCurrent && block.handoff) {
        items.push({ kind: "prompt", key: `${block.id}-handoff`, content: block.handoff });
      }
      // A teach-back is a question being asked, so it reads as a message even
      // while it is the current block. Its card carries no prompt of its own.
      if (isCurrent && block.blockType === "teach_back") {
        items.push({ kind: "prompt", key: `${block.id}-prompt`, content: (block as TeachBack).prompt });
      }
      // Same treatment, generalized to onboarding_survey's several internal
      // steps: every step up through the one currently showing reads as a
      // message, so a learner who has answered three of seven questions sees
      // all three as thread history, not just the one in front of them.
      if (isCurrent && block.blockType === "onboarding_survey") {
        items.push(...onboardingSurveyPromptBubbles(block.id, (block as OnboardingSurvey).steps, surveyStepIndex, surveyAnswers));
      }
      items.push(...tutorFor(block.id));
    }
    return items;
  }, [data, completed, current, threadMessages, surveyStepIndex]);

  /**
   * Keep the newest turn in view.
   *
   * Nothing scrolled before this. A reply appends to the end of the thread, and
   * on a lesson with any history that end is below the fold, so the learner
   * sent a message and watched an unchanged screen for the 3.5-5.2s the turn
   * takes. The pending indicator had the same problem: it announced itself to a
   * screen reader and to nobody else.
   *
   * The anchor sits after the tutor input rather than at the end of the thread.
   * Aligning the thread's end to the viewport bottom would push the block card
   * and the input below the fold, which is the bug this is next to. Anchoring
   * past the input docks the input at the bottom instead, with the reply above
   * it. A card taller than the remaining viewport still pushes the reply off
   * the top — that tension is the layout question itself, not something a
   * scroll call can settle.
   *
   * The first population is skipped because it is restored history, not a new
   * learner turn. Scrolling the title away merely because persisted messages
   * loaded would make the page move on its own.
   */
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const seenCount = useRef<number | null>(null);
  useEffect(() => {
    const count = threadItems.length + (pending ? 1 : 0);
    if (count === 0) return;
    if (seenCount.current === null || count <= seenCount.current) {
      seenCount.current = count;
      return;
    }
    seenCount.current = count;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "end" });
  }, [threadItems.length, pending]);

  /**
   * Same POST the chat surface uses, so there is one way to end a session.
   * Full navigation rather than a client push: the session cookie is gone, and
   * a soft transition would leave this component's fetched state on screen
   * behind a page the learner is no longer authenticated for.
   */
  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((items) => arrayMove(items, items.indexOf(Number(active.id)), items.indexOf(Number(over.id))));
  }

  if (error && !data) return <main className="player-shell"><div className="player-error">{error}</div></main>;
  if (!data) return <main className="player-shell"><p>Loading lesson…</p></main>;

  const total = data.lesson.blocks.length;
  const done = completed.size;
  /**
   * The one piece of markup for sending typed text, defined once so there is
   * exactly one text box in this file no matter which of the two spots below
   * ends up rendering it. `isTextAnswerBlock` picks the spot — merged into
   * the pinned card, or the docked aside — this only decides what the box
   * itself looks like once it is there.
   */
  const tutorInputPanel = current ? <>
    <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} disabled={busy} placeholder={isSurvey ? "Type your answer…" : teachingBack ? "Explain it in your own words…" : requiresResponse ? "Type your response…" : "Ask about this lesson…"} />
    {/* One control on a block that requires text: it sends and advances,
        and it is disabled until there is something to send. On every other
        block this stays what it was — a way to ask, next to the card's own
        way forward. */}
    {/* Once reviewed — graded or gated on an open question — this falls to
        the ask-only branch below, same as every other reviewed block:
        no live advance control competing with the Continue on the card. */}
    {/* onboarding_survey never falls to the ask-tutor branch: its steps are
        canned questions, not something to converse about. */}
    {isSurvey && !submittedComplete.has(current.id)
      ? <button disabled={busy || !question.trim()} onClick={submitSurveyStep}>Send and continue</button>
      : requiresResponse && !submittedComplete.has(current.id)
      ? <button disabled={busy || !question.trim()} onClick={() => advance({ acknowledged: true })}>Send and continue</button>
      : !isSurvey && <button disabled={busy || !question.trim()} onClick={() => askTutor()}>{teachingBack ? (teachBackTurn === 1 ? "Share with AI Mentor" : "Send follow-up") : "Ask a question"}</button>}
    {(isSurvey || requiresResponse) && !submittedComplete.has(current.id) && !question.trim() && <p className="player-teachback-hint">Type your {isSurvey ? "answer" : "response"} to continue.</p>}
    {/* Only after a send has actually failed twice, and only here. This is
        not a second way forward competing with the button above it: until
        the tutor breaks it does not exist. Without it a tutor outage on the
        first block of a lesson is a locked door. onboarding_survey never
        calls the tutor, so it has no equivalent failure mode to fall back
        from. */}
    {requiresResponse && !isSurvey && !submittedComplete.has(current.id) && sendFailures >= 2 && <button type="button" className="player-secondary" disabled={busy} onClick={() => complete({ acknowledged: true })}>Continue without sending</button>}
  </> : null;
  return (
    <main className="player-shell">
      <header className="player-header">
        <div>
          {/* Persistent way out. Safe to navigate: the thread is server state
              since it moved to /thread, so leaving and coming back restores the
              conversation rather than dropping it. */}
          <div className="player-nav">
            <Link className="player-home-link" href="/home">← Home</Link>
            <button type="button" className="player-home-link player-logout" onClick={logout}>Log out</button>
          </div>
          <span className="player-eyebrow">{data.lesson.category ?? "AI Essentials"}</span><h1>{data.lesson.title}</h1>{data.hasCapstone && <Link className="player-project-link" href={`/learn/${course}/capstone`}>Open project</Link>}
        </div>
        <div className="player-header-side">
          <div className="player-progress" aria-label={`${done} of ${total} blocks complete`}><span style={{ width: `${100 * done / total}%` }} /></div>
          {/*
            The help button lives in the dashboard when there is one. It falls
            back to the header otherwise, so a learner with no project never
            loses the way to reach a person.
          */}
          {data.helpRequestEnabled && !data.dashboard && (
            <HelpRequestPanel course={course} lessonKey={lessonKey} blockId={current?.id} />
          )}
        </div>
      </header>

      {/*
        Two columns when there is a dashboard, one when there is not. The left
        column holds exactly what the page held before — tutor log, lesson card,
        Ask AI Mentor — in the same order and at very nearly the same measure,
        so nothing about the lesson content or the tutor changes.
      */}
      <div className={data.dashboard ? "player-body has-dash" : "player-body"}>
      <div className="player-main">
      {/* The lesson so far. Everything here is history — no block controls, so
          re-reading block 7 cannot accidentally re-answer it. */}
      {(threadItems.length > 0 || pending || tutorError) && <section className="player-thread" aria-label="Lesson so far">
        {threadItems.map((item, index) => {
          if (item.kind === "tutor") {
            const isLast = index === threadItems.length - 1;
            // `senderType: null` covers rows from before the column existed —
            // those are all AI turns, so only an explicit "mentor" flips the
            // label. A human mentor's own typing is not model output, so it
            // renders as plain text rather than through the markdown pass.
            const isHumanMentor = item.role === "mentor" && item.senderType === "mentor";
            return <div key={item.key} className={`player-message ${item.role}${isHumanMentor ? " human-mentor" : ""}`}>
              <strong>{item.role === "mentor" ? (isHumanMentor ? "Your Mentor" : "AI Mentor") : "You"}</strong>
              {item.role === "mentor" && !isHumanMentor
                ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
                : <p>{item.content}</p>}
              {item.role === "mentor" && !isHumanMentor && item.parentIntent && isLast && <button type="button" className="player-chip" disabled={busy} aria-label="Ask AI Mentor to explain the previous reply in more detail" onClick={() => explainMore(item.parentIntent!, item.blockId)}>Explain more</button>}
            </div>;
          }
          if (item.kind === "divider") return <div key={item.key} className="player-thread-divider" role="separator" />;
          return <div key={item.key} className={`player-message lesson ${item.kind === "prompt" ? "is-prompt" : ""}`}>
            <strong>{item.kind === "prompt" ? "AI Mentor" : "Lesson"}</strong>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={item.kind === "block" && item.externalLinks
                ? { a: ({ node, ...props }) => { void node; return <a {...props} target="_blank" rel="noopener noreferrer" />; } }
                : undefined}
            >{item.content}</ReactMarkdown>
          </div>;
        })}

        {/* In the thread, not at the top of the page: the eye should already be
            where the reply will appear. `aria-live` announces it once. */}
        {pending && <>
          {pending.learnerText && <div className="player-message learner"><strong>You</strong><p>{pending.learnerText}</p></div>}
          <div className="player-message" aria-live="polite">
            <strong>AI Mentor</strong>
            <span className="player-thinking" role="status" aria-label="AI Mentor is thinking">
              <i /><i /><i />
            </span>
          </div>
        </>}

        {tutorError && <div className="player-message is-error" role="alert">
          <strong>AI Mentor</strong>
          <p>{tutorError}</p>
        </div>}
      </section>}

      {/* The current block. Scrolls with the thread since the sticky
          positioning came out; see the note on `.player-current`. */}
      {current ? <><section className="player-card player-current" aria-live="polite">
        {/* onboarding_survey collapses the lesson-level block counter and its
            own internal step counter into one line, since both were stacked
            directly above the same question. Every other block type keeps
            the plain lesson-level counter untouched. */}
        {current.blockType === "onboarding_survey"
          ? (!submittedComplete.has(current.id) && <div className="player-step player-survey-step">Step {done + 1} of {total} · Question {Math.min(surveyStepIndex, (current as OnboardingSurvey).steps.length - 1) + 1} of {(current as OnboardingSurvey).steps.length}</div>)
          : <div className="player-step">Step {done + 1} of {total}</div>}
        {/* A block that asks for typed text carries no button of its own. Its
            one control lives under the box, so the card reads as the
            invitation it is and the action sits with the writing. */}
        {/* The block's own content and button both hide once `submittedComplete`,
            on every block type: a reviewed block shows only the Continue below,
            never its authored prompt re-shown next to an exchange the thread
            already carries. That is the Problem A shape, and it applies whether
            the review came from a graded verdict or from the open-question gate. */}
        {boundedMode === "reteach_gate" ? (
          <ReteachGateExperience
            key={current.id}
            course={course}
            lessonKey={lessonKey}
            blockId={current.id}
            initiallyComplete={submittedComplete.has(current.id)}
            onWriteBlockCompletion={async () => (await complete({}))?.completed === true}
            onReturnToThread={advanceReviewedBlock}
          />
        ) : boundedMode === "web_quiz" && current.blockType === "quiz_checkpoint" ? (
          <WebQuizExperience
            key={current.id}
            blockId={current.id}
            title={(current as Quiz).title}
            questions={(current as Quiz).questions}
            busy={busy}
            initiallyComplete={submittedComplete.has(current.id)}
            initialFeedback={feedback[current.id]}
            onSubmit={complete}
            onReturnToThread={advanceReviewedBlock}
          />
        ) : <>
        {current.blockType === "teach" && !submittedComplete.has(current.id) && pendingInterleave?.blockId !== current.id && <><ReactMarkdown remarkPlugins={[remarkGfm]}>{(current as Teach).content}</ReactMarkdown>{!requiresResponse && <button disabled={busy} onClick={() => advance({ acknowledged: true })}>{primaryLabel(question)}</button>}</>}
        {/* C.1/C.2: milestoneRef checkpoint — teach and project blocks both
            author one (real content puts these on project blocks, e.g. AI
            Essentials' "Milestone 1" block, not teach). The authored prompt
            plus its done/skip affordance, holding the block open until one
            is chosen. */}
        {(current.blockType === "teach" || current.blockType === "project") && pendingInterleave?.blockId === current.id && <div className="player-interleave">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{pendingInterleave.prompt}</ReactMarkdown>
          <button disabled={busy} onClick={() => resolveInterleave("done")}>Done</button>
          <button className="player-secondary" disabled={busy} onClick={() => resolveInterleave("skip")}>Not now</button>
        </div>}
        {current.blockType === "project" && !submittedComplete.has(current.id) && pendingInterleave?.blockId !== current.id && <><ReactMarkdown remarkPlugins={[remarkGfm]}>{(current as Project).content}</ReactMarkdown>{!requiresResponse && <button disabled={busy} onClick={() => advance({ acknowledged: true })}>{primaryLabel(question)}</button>}</>}
        {/* The counter above collapses lesson-step and survey-step into one
            line for this block type; see its render higher up. */}
        {current.blockType === "onboarding_survey" && !submittedComplete.has(current.id) && <ReactMarkdown remarkPlugins={[remarkGfm]}>{(current as OnboardingSurvey).steps[Math.min(surveyStepIndex, (current as OnboardingSurvey).steps.length - 1)]?.prompt ?? ""}</ReactMarkdown>}
        {current.blockType === "quiz_checkpoint" && !submittedComplete.has(current.id) && <>
          {(current as Quiz).title && <h2>{(current as Quiz).title}</h2>}
          {(current as Quiz).questions.map((question) => <fieldset key={question.id}><legend>{question.prompt}</legend>{question.options?.map((option) => <label className="player-option" key={option}><input type="radio" name={question.id} value={option} checked={answers[question.id] === option} onChange={() => setAnswers((value) => ({ ...value, [question.id]: option }))} />{option}</label>)}</fieldset>)}
          {/* An opinion poll has nothing to submit an answer *to*, so it does
              not claim otherwise. */}
          <button disabled={busy || (current as Quiz).questions.some((q) => !answers[q.id])} onClick={() => advance(answers)}>{feedbackAllowsRetry(feedback[current.id]) ? "Try again" : (current as Quiz).questions.some((q) => q.graded) ? "Submit answer" : "Continue"}</button>
        </>}
        {current.blockType === "drag_order" && !submittedComplete.has(current.id) && <><h2>{(current as Drag).prompt}</h2><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={order} strategy={verticalListSortingStrategy}><ol className="player-sort-list">{order.map((item, index) => <SortableOrderItem key={item} id={item} label={(current as Drag).items[item]} position={index} />)}</ol></SortableContext></DndContext><button disabled={busy} onClick={() => advance(order)}>Check order</button></>}
        {current.blockType === "media" && !submittedComplete.has(current.id) && <><MediaBlock block={current as Media} /><button disabled={busy} onClick={() => advance({ acknowledged: true })}>{primaryLabel(question)}</button></>}
        {current.blockType === "resource" && !submittedComplete.has(current.id) && <><ResourceBlock block={current as Resource} /><button disabled={busy} onClick={() => advance({ acknowledged: true })}>{primaryLabel(question)}</button></>}
        {/* The prompt is derived into the thread above, verbatim from the block
            body, and answered in the single input below. This card keeps only
            the heading, so the block still reads as a step. */}
        {current.blockType === "teach_back" && <><h2>Teach it back</h2><p className="player-teachback-hint">{submittedComplete.has(current.id)
          ? "Keep talking with AI Mentor if you want to, or continue when you are ready."
          : "AI Mentor asked you a question. Answer it in the box below."}</p></>}
        {/* Same invitation teach_back shows once reviewed, generalized to any
            block the open-question gate — not a graded verdict — is holding.
            Without it the card was a bare Continue button next to the mentor's
            question, which reads as "no chance to reply" even though the box
            underneath is still open for one. */}
        {current.blockType !== "teach_back" && submittedComplete.has(current.id) && !feedback[current.id] && <p className="player-teachback-hint">
          Keep talking with AI Mentor if you want to, or continue when you are ready.
        </p>}
        {/* Never a raw object: `BlockFeedback` draws only the verdict shapes it
            can name, and renders nothing at all for anything else. */}
        <BlockFeedback
          feedback={feedback[current.id]}
          questionPrompts={current.blockType === "quiz_checkpoint"
            ? Object.fromEntries((current as Quiz).questions.map((item) => [item.id, item.prompt]))
            : undefined}
          items={current.blockType === "drag_order" ? (current as Drag).items : undefined}
        />
        {submittedComplete.has(current.id) && <button disabled={busy} onClick={advanceReviewedBlock}>Continue</button>}
        {/* Merged input: exactly one box, directly under whatever is asking,
            for every block type that asks for typed text. onboarding_survey
            is the one exception — once it is submittedComplete it never
            talks to the tutor, so no box (empty or otherwise) belongs here. */}
        {isTextAnswerBlock && !(isSurvey && submittedComplete.has(current.id)) && tutorInputPanel}
        </>}
        {error && <p className="player-error">{error}</p>}
      </section>{!boundedMode && !isTextAnswerBlock && <aside className="player-card"><h2>Ask AI Mentor</h2>{tutorInputPanel}
        {/* Chips are for asking about the lesson. During a teach-back the box is
            the learner's own explanation, and a canned question is not that. */}
        {!teachingBack && !requiresResponse && !isSurvey && <div className="player-chip-row">{TUTOR_CHIPS.map((chip) => <button type="button" className="player-chip" key={chip} disabled={busy} onClick={() => askTutor(chip)}>{chip}</button>)}</div>}
      </aside>}</> :<section className="player-card player-complete"><span>Lesson complete</span><h2>Nicely done.</h2><p>Your progress is saved.</p>{data.nextLessonKey
          ? <Link className="player-button" href={`/learn/${course}/${data.nextLessonKey}`}>Continue to next lesson</Link>
          : data.hasCapstone
            ? <Link className="player-button" href={`/learn/${course}/capstone`}>Open capstone</Link>
            : null}</section>}
      {/* Scroll target for a new turn. Below the input, so scrolling to it
          docks the input at the viewport bottom rather than burying it. */}
      <div ref={bottomRef} aria-hidden="true" />
      </div>
      {data.dashboard && (
        <PlayerDashboard
          dashboard={data.dashboard}
          course={course}
          lessonKey={lessonKey}
          blockId={current?.id}
          helpRequestEnabled={data.helpRequestEnabled === true}
          hasCapstone={data.hasCapstone}
        />
      )}
      </div>
    </main>
  );
}
