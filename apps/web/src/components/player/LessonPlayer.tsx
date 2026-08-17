"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { playerFetch } from "@/lib/player/client";
import type { LessonDashboard } from "@/lib/player/dashboard";
import { HelpRequestPanel } from "./HelpRequestPanel";
import { PlayerDashboard } from "./PlayerDashboard";
import { SortableOrderItem } from "./SortableOrderItem";
import "./player.css";

type BlockBase = { id: string; order: number; blockType: string; contentVersion: number; concepts: string[] };
type Teach = BlockBase & { blockType: "teach"; content: string };
type Quiz = BlockBase & { blockType: "quiz_checkpoint"; questions: Array<{ id: string; prompt: string; options?: string[]; graded: boolean }> };
type Drag = BlockBase & { blockType: "drag_order"; prompt: string; items: string[] };
type TeachBack = BlockBase & { blockType: "teach_back"; prompt: string };
type Block = Teach | Quiz | Drag | TeachBack | BlockBase;
type LessonDto = {
  lesson: { key: string; title: string; category?: string; keyConcepts: string[]; blocks: Block[] };
  previousLessonKey: string | null; nextLessonKey: string | null;
  hasCapstone: boolean;
  helpRequestEnabled?: boolean;
  /** Null for a course without project selection, or a learner without a project. */
  dashboard?: LessonDashboard | null;
  progress: Array<{ blockId: string; completedAt: string | null; state?: { turnCount?: number } }>;
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
type ThreadMessage = {
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
  | { kind: "tutor"; key: string; role: "learner" | "mentor"; content: string; parentIntent?: ParentIntent; blockId?: string };

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
        setData(result);
        setCompleted(new Set(result.progress.filter((item) => item.completedAt).map((item) => item.blockId)));
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

  useEffect(() => {
    if (!data) return;
    playerFetch<{ response?: string; isError?: boolean }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "Introduce this lesson.", context: { surface: "player", courseCode: course, lessonKey, intent: "lesson_entry" } }),
    }).then(() => loadThread()).catch(() => undefined);
    // `course` joined the deps when the hardcoded course code came out. It only
    // changes on a route change, which remounts this component anyway, so the
    // lesson-entry turn still fires exactly once per lesson load.
  }, [data, lessonKey, course, loadThread]);

  const current = useMemo(() => data?.lesson.blocks.find((block) => !completed.has(block.id)) ?? null, [data, completed]);
  const teachingBack = current?.blockType === "teach_back";
  useEffect(() => {
    if (current?.blockType === "drag_order") setOrder((current as Drag).items.map((_, index) => index));
    const savedTurn = data?.progress.find((item) => item.blockId === current?.id)?.state?.turnCount;
    setAnswers({}); setFeedback({}); setTeachBackTurn(savedTurn === 1 ? 2 : 1);
  }, [current, data]);

  async function complete(response?: unknown) {
    if (!current) return;
    setBusy(true); setError("");
    try {
      const result = await playerFetch<{ completed: boolean; feedback?: unknown }>(`/api/learn/${course}/${lessonKey}/blocks/${current.id}/complete`, { method: "POST", body: JSON.stringify({ response }) });
      setFeedback((value) => ({ ...value, [current.id]: result.feedback }));
      if (result.completed) {
        if (result.feedback) setSubmittedComplete((value) => new Set(value).add(current.id));
        else setCompleted((value) => new Set(value).add(current.id));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save progress"); }
    finally { setBusy(false); }
  }

  function advanceReviewedBlock() {
    if (!current) return;
    setSubmittedComplete((value) => { const next = new Set(value); next.delete(current.id); return next; });
    setCompleted((value) => new Set(value).add(current.id));
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
  async function askTutor(preset?: string) {
    const content = (preset ?? question).trim();
    if (!content) return;
    const teachingBack = current?.blockType === "teach_back";
    const intent = teachingBack ? "teach_back" as const : "question" as const;
    const blockId = current?.id;
    setBusy(true); setError("");
    try {
      const result = await playerFetch<{ response: string; isError?: boolean }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: content, context: { surface: "player", courseCode: course, lessonKey, blockId, intent } }),
      });
      setQuestion("");
      await loadThread();
      if (teachingBack && current && !result.isError) {
        // The server has already recorded this turn. Mirroring the second one
        // here is what moves the learner off the block without a refetch.
        if (teachBackTurn === 2) setCompleted((value) => new Set(value).add(current.id));
        else setTeachBackTurn(2);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Tutor reply failed"); }
    finally { setBusy(false); }
  }

  async function explainMore(parentIntent: ParentIntent, blockId?: string) {
    setBusy(true); setError("");
    try {
      await playerFetch<{ response: string }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ context: { surface: "player", courseCode: course, lessonKey, blockId, intent: "expand", parentIntent } }),
      });
      await loadThread();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Tutor expansion failed"); }
    finally { setBusy(false); }
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
      // A teach-back is a question being asked, so it reads as a message even
      // while it is the current block. Its card carries no prompt of its own.
      if (isCurrent && block.blockType === "teach_back") {
        items.push({ kind: "prompt", key: `${block.id}-prompt`, content: (block as TeachBack).prompt });
      }
      items.push(...tutorFor(block.id));
    }
    return items;
  }, [data, completed, current, threadMessages]);

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
          <Link className="player-home-link" href="/home">← Home</Link>
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
      {threadItems.length > 0 && <section className="player-thread" aria-label="Lesson so far">
        {threadItems.map((item, index) => {
          if (item.kind === "tutor") {
            const isLast = index === threadItems.length - 1;
            return <div key={item.key} className={`player-message ${item.role}`}>
              <strong>{item.role === "mentor" ? "AI Mentor" : "You"}</strong>
              {item.role === "mentor"
                ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
                : <p>{item.content}</p>}
              {item.role === "mentor" && item.parentIntent && isLast && <button type="button" className="player-chip" disabled={busy} aria-label="Ask AI Mentor to explain the previous reply in more detail" onClick={() => explainMore(item.parentIntent!, item.blockId)}>Explain more</button>}
            </div>;
          }
          return <div key={item.key} className={`player-message lesson ${item.kind === "prompt" ? "is-prompt" : ""}`}>
            <strong>{item.kind === "prompt" ? "AI Mentor" : "Lesson"}</strong>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
          </div>;
        })}
      </section>}

      {/* The current block, pinned. Sticky rather than inline so a block that is
          a reference — a copy URL, numbered setup steps — stays on screen while
          the learner asks the tutor about it and the thread grows underneath. */}
      {current ? <><section className="player-card player-current" aria-live="polite">
        <div className="player-step">Step {done + 1} of {total}</div>
        {current.blockType === "teach" && <><ReactMarkdown remarkPlugins={[remarkGfm]}>{(current as Teach).content}</ReactMarkdown><button disabled={busy} onClick={() => complete({ acknowledged: true })}>Next</button></>}
        {current.blockType === "quiz_checkpoint" && !submittedComplete.has(current.id) && <>
          {(current as Quiz).questions.map((question) => <fieldset key={question.id}><legend>{question.prompt}</legend>{question.options?.map((option) => <label className="player-option" key={option}><input type="radio" name={question.id} value={option} checked={answers[question.id] === option} onChange={() => setAnswers((value) => ({ ...value, [question.id]: option }))} />{option}</label>)}</fieldset>)}
          {/* An opinion poll has nothing to submit an answer *to*, so it does
              not claim otherwise. */}
          <button disabled={busy || (current as Quiz).questions.some((q) => !answers[q.id])} onClick={() => complete(answers)}>{(current as Quiz).questions.some((q) => q.graded) ? "Submit answer" : "Continue"}</button>
        </>}
        {current.blockType === "drag_order" && !submittedComplete.has(current.id) && <><h2>{(current as Drag).prompt}</h2><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={order} strategy={verticalListSortingStrategy}><ol className="player-sort-list">{order.map((item, index) => <SortableOrderItem key={item} id={item} label={(current as Drag).items[item]} position={index} />)}</ol></SortableContext></DndContext><button disabled={busy} onClick={() => complete(order)}>Check order</button></>}
        {/* The prompt is derived into the thread above, verbatim from the block
            body, and answered in the single input below. This card keeps only
            the heading, so the block still reads as a step. */}
        {current.blockType === "teach_back" && <><h2>Teach it back</h2><p className="player-teachback-hint">AI Mentor asked you a question. Answer it in the box below.</p></>}
        {feedback[current.id] ? <pre className="player-feedback">{JSON.stringify(feedback[current.id], null, 2)}</pre> : null}
        {submittedComplete.has(current.id) && <button onClick={advanceReviewedBlock}>Continue</button>}
        {error && <p className="player-error">{error}</p>}
      </section><aside className="player-card"><h2>Ask AI Mentor</h2><textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} placeholder={teachingBack ? "Explain it in your own words…" : "Ask about this lesson…"} /><button disabled={busy || !question.trim()} onClick={() => askTutor()}>{teachingBack ? (teachBackTurn === 1 ? "Share with AI Mentor" : "Send follow-up") : "Ask a question"}</button>
        {/* Chips are for asking about the lesson. During a teach-back the box is
            the learner's own explanation, and a canned question is not that. */}
        {!teachingBack && <div className="player-chip-row">{TUTOR_CHIPS.map((chip) => <button type="button" className="player-chip" key={chip} disabled={busy} onClick={() => askTutor(chip)}>{chip}</button>)}</div>}
      </aside></> : <section className="player-card player-complete"><span>Lesson complete</span><h2>Nicely done.</h2><p>Your progress is saved.</p>{data.nextLessonKey
          ? <Link className="player-button" href={`/learn/${course}/${data.nextLessonKey}`}>Continue to next lesson</Link>
          : data.hasCapstone
            ? <Link className="player-button" href={`/learn/${course}/capstone`}>Open capstone</Link>
            : null}</section>}
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
