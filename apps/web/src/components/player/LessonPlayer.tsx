"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import "./player.css";

type BlockBase = { id: string; order: number; blockType: string; contentVersion: number; concepts: string[]; handoff?: string };
type Teach = BlockBase & { blockType: "teach"; content: string; expectsResponse?: boolean };
type Quiz = BlockBase & { blockType: "quiz_checkpoint"; title?: string; questions: Array<{ id: string; prompt: string; options?: string[]; graded: boolean }> };
type Drag = BlockBase & { blockType: "drag_order"; prompt: string; items: string[] };
type TeachBack = BlockBase & { blockType: "teach_back"; prompt: string };
type Block = Teach | Quiz | Drag | TeachBack | BlockBase;
type ProgressItem = { blockId: string; completedAt: string | null; state?: { turnCount?: number; reviewPending?: boolean }; feedback?: unknown };
type LessonDto = {
  lesson: { key: string; title: string; category?: string; keyConcepts: string[]; blocks: Block[] };
  previousLessonKey: string | null; nextLessonKey: string | null;
  hasCapstone: boolean;
  helpRequestEnabled?: boolean;
  /** Null for a course without project selection, or a learner without a project. */
  dashboard?: LessonDashboard | null;
  progress: ProgressItem[];
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
/** A persisted row, as `toClientMessage` serializes it. */
export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  senderType: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

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
  | { kind: "block"; key: string; content: string }
  | { kind: "prompt"; key: string; content: string }
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

function historyContent(block: Block): string | null {
  if (block.blockType === "teach") return (block as Teach).content;
  if (block.blockType === "teach_back") return (block as TeachBack).prompt;
  if (block.blockType === "drag_order") return (block as Drag).prompt;
  if (block.blockType === "quiz_checkpoint") {
    return (block as Quiz).questions.map((question) => `**${question.prompt}**`).join("\n\n");
  }
  return null;
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
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [teachBackTurn, setTeachBackTurn] = useState(1);
  const [submittedComplete, setSubmittedComplete] = useState<Set<string>>(new Set());
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

  /**
   * The thread is server state, so every turn ends by re-reading it rather than
   * appending a local guess. A refresh mid-lesson now restores the whole
   * conversation instead of an empty sidebar.
   *
   * Failures are swallowed: the thread is history, and losing it must not cost
   * the learner the lesson they are in the middle of.
   */
  const loadThread = useCallback(async () => {
    try {
      const result = await playerFetch<{ messages: ThreadMessage[] }>(
        `/api/learn/${encodeURIComponent(course)}/${encodeURIComponent(lessonKey)}/thread`,
      );
      setThreadMessages(result.messages);
    } catch { /* history is decoration around the lesson, never a blocker */ }
  }, [course, lessonKey]);

  useEffect(() => { void loadThread(); }, [loadThread]);

  const current = useMemo(() => data?.lesson.blocks.find((block) => !completed.has(block.id)) ?? null, [data, completed]);
  const teachingBack = current?.blockType === "teach_back";
  /**
   * This block asks for typed text and will not advance without it.
   *
   * The block used to offer "Skip for now" on the card *and* "Ask a question"
   * under the box. Two controls, and the prominent one was the one that
   * abandoned the interaction, so the way out read as the way forward. Now
   * there is one: a primary send-and-advance button under the box, disabled
   * until something is typed.
   */
  const requiresResponse = current?.blockType === "teach" && (current as Teach).expectsResponse === true;
  useEffect(() => {
    if (current?.blockType === "drag_order") setOrder((current as Drag).items.map((_, index) => index));
    const savedTurn = data?.progress.find((item) => item.blockId === current?.id)?.state?.turnCount;
    const savedFeedback = data?.progress.find((item) => item.blockId === current?.id)?.feedback;
    setAnswers({}); setFeedback(savedFeedback === undefined || !current ? {} : { [current.id]: savedFeedback }); setTeachBackTurn(savedTurn === 1 ? 2 : 1); setSendFailures(0);
  }, [current, data]);

  async function complete(response?: unknown) {
    if (!current) return;
    setBusy(true); setError("");
    try {
      const result = await playerFetch<{ completed: boolean; feedback?: unknown; reviewPending?: boolean }>(`/api/learn/${course}/${lessonKey}/blocks/${current.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ response, openQuestionGateEnabled: gatedStreak < OPEN_QUESTION_GATE_CAP }),
      });
      setFeedback((value) => ({ ...value, [current.id]: result.feedback }));
      if (result.completed) {
        if (result.reviewPending) {
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
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save progress"); }
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
    const teachingBack = current?.blockType === "teach_back";
    const intent = teachingBack ? "teach_back" as const : "question" as const;
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

    const tutorFor = (blockId: string | undefined): ThreadItem[] => threadMessages
      .filter((message) => {
        const meta = message.metadata ?? {};
        if ((meta.blockId as string | undefined) !== blockId) return false;
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

    const items: ThreadItem[] = [...tutorFor(undefined)];
    for (const block of data.lesson.blocks) {
      const isDone = completed.has(block.id);
      const isCurrent = current?.id === block.id;
      if (!isDone && !isCurrent) break;
      if (isDone) {
        const history = historyContent(block);
        if (history) items.push({ kind: "block", key: block.id, content: history });
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
      items.push(...tutorFor(block.id));
    }
    return items;
  }, [data, completed, current, threadMessages]);

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
          return <div key={item.key} className={`player-message lesson ${item.kind === "prompt" ? "is-prompt" : ""}`}>
            <strong>{item.kind === "prompt" ? "AI Mentor" : "Lesson"}</strong>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
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
        <div className="player-step">Step {done + 1} of {total}</div>
        {/* A block that asks for typed text carries no button of its own. Its
            one control lives under the box, so the card reads as the
            invitation it is and the action sits with the writing. */}
        {/* The block's own content and button both hide once `submittedComplete`,
            on every block type: a reviewed block shows only the Continue below,
            never its authored prompt re-shown next to an exchange the thread
            already carries. That is the Problem A shape, and it applies whether
            the review came from a graded verdict or from the open-question gate. */}
        {current.blockType === "teach" && !submittedComplete.has(current.id) && <><ReactMarkdown remarkPlugins={[remarkGfm]}>{(current as Teach).content}</ReactMarkdown>{!requiresResponse && <button disabled={busy} onClick={() => advance({ acknowledged: true })}>{primaryLabel(question)}</button>}</>}
        {current.blockType === "quiz_checkpoint" && !submittedComplete.has(current.id) && <>
          {(current as Quiz).title && <h2>{(current as Quiz).title}</h2>}
          {(current as Quiz).questions.map((question) => <fieldset key={question.id}><legend>{question.prompt}</legend>{question.options?.map((option) => <label className="player-option" key={option}><input type="radio" name={question.id} value={option} checked={answers[question.id] === option} onChange={() => setAnswers((value) => ({ ...value, [question.id]: option }))} />{option}</label>)}</fieldset>)}
          {/* An opinion poll has nothing to submit an answer *to*, so it does
              not claim otherwise. */}
          <button disabled={busy || (current as Quiz).questions.some((q) => !answers[q.id])} onClick={() => advance(answers)}>{feedbackAllowsRetry(feedback[current.id]) ? "Try again" : (current as Quiz).questions.some((q) => q.graded) ? "Submit answer" : "Continue"}</button>
        </>}
        {current.blockType === "drag_order" && !submittedComplete.has(current.id) && <><h2>{(current as Drag).prompt}</h2><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={order} strategy={verticalListSortingStrategy}><ol className="player-sort-list">{order.map((item, index) => <SortableOrderItem key={item} id={item} label={(current as Drag).items[item]} position={index} />)}</ol></SortableContext></DndContext><button disabled={busy} onClick={() => advance(order)}>Check order</button></>}
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
        {error && <p className="player-error">{error}</p>}
      </section><aside className="player-card"><h2>{requiresResponse ? "Your response" : "Ask AI Mentor"}</h2><textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} disabled={busy} placeholder={teachingBack ? "Explain it in your own words…" : requiresResponse ? "Type your response…" : "Ask about this lesson…"} />
        {/* One control on a block that requires text: it sends and advances,
            and it is disabled until there is something to send. On every other
            block this stays what it was — a way to ask, next to the card's own
            way forward. */}
        {/* Once reviewed — graded or gated on an open question — this falls to
            the ask-only branch below, same as every other reviewed block:
            no live advance control competing with the Continue on the card. */}
        {requiresResponse && !submittedComplete.has(current.id)
          ? <button disabled={busy || !question.trim()} onClick={() => advance({ acknowledged: true })}>Send and continue</button>
          : <button disabled={busy || !question.trim()} onClick={() => askTutor()}>{teachingBack ? (teachBackTurn === 1 ? "Share with AI Mentor" : "Send follow-up") : "Ask a question"}</button>}
        {requiresResponse && !submittedComplete.has(current.id) && !question.trim() && <p className="player-teachback-hint">Type your response to continue.</p>}
        {/* Only after a send has actually failed twice, and only here. This is
            not a second way forward competing with the button above it: until
            the tutor breaks it does not exist. Without it a tutor outage on the
            first block of a lesson is a locked door. */}
        {requiresResponse && !submittedComplete.has(current.id) && sendFailures >= 2 && <button type="button" className="player-secondary" disabled={busy} onClick={() => complete({ acknowledged: true })}>Continue without sending</button>}
        {/* Chips are for asking about the lesson. During a teach-back the box is
            the learner's own explanation, and a canned question is not that. */}
        {!teachingBack && !requiresResponse && <div className="player-chip-row">{TUTOR_CHIPS.map((chip) => <button type="button" className="player-chip" key={chip} disabled={busy} onClick={() => askTutor(chip)}>{chip}</button>)}</div>}
      </aside></> :<section className="player-card player-complete"><span>Lesson complete</span><h2>Nicely done.</h2><p>Your progress is saved.</p>{data.nextLessonKey
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
        />
      )}
      </div>
    </main>
  );
}
