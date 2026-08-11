"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { playerFetch } from "@/lib/player/client";
import { SortableOrderItem } from "./SortableOrderItem";
import "./player.css";

type BlockBase = { id: string; order: number; blockType: string; contentVersion: number; concepts: string[] };
type Teach = BlockBase & { blockType: "teach"; content: string };
type Quiz = BlockBase & { blockType: "quiz_checkpoint"; questions: Array<{ id: string; prompt: string; options?: string[] }> };
type Drag = BlockBase & { blockType: "drag_order"; prompt: string; items: string[] };
type TeachBack = BlockBase & { blockType: "teach_back"; prompt: string };
type Block = Teach | Quiz | Drag | TeachBack | BlockBase;
type LessonDto = {
  lesson: { key: string; title: string; category?: string; keyConcepts: string[]; blocks: Block[] };
  previousLessonKey: string | null; nextLessonKey: string | null;
  hasCapstone: boolean;
  progress: Array<{ blockId: string; completedAt: string | null; state?: { turnCount?: number } }>;
};
type ParentIntent = "question" | "teach_back" | "lesson_entry" | "capstone";
type TutorMessage = { role: "learner" | "mentor"; text: string; parentIntent?: ParentIntent; blockId?: string };

export function LessonPlayer({ course, lessonKey }: { course: string; lessonKey: string }) {
  const [data, setData] = useState<LessonDto | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<Record<string, unknown>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<number[]>([]);
  const [teachBack, setTeachBack] = useState("");
  const [question, setQuestion] = useState("");
  const [tutorMessages, setTutorMessages] = useState<TutorMessage[]>([]);
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
        if (reason.code === "diagnostic_required") window.location.assign(`/learn/${course}/diagnostic`);
        else setError(reason.message);
      });
    return () => { active = false; };
  }, [course, lessonKey]);

  useEffect(() => {
    if (!data) return;
    playerFetch<{ response?: string; isError?: boolean }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "Introduce this lesson.", context: { surface: "player", courseCode: "AIESS", lessonKey, intent: "lesson_entry" } }),
    }).then((result) => {
      if (result.response) setTutorMessages([{ role: "mentor", text: result.response, ...(result.isError ? {} : { parentIntent: "lesson_entry" as const }) }]);
    }).catch(() => undefined);
  }, [data, lessonKey]);

  const current = useMemo(() => data?.lesson.blocks.find((block) => !completed.has(block.id)) ?? null, [data, completed]);
  useEffect(() => {
    if (current?.blockType === "drag_order") setOrder((current as Drag).items.map((_, index) => index));
    const savedTurn = data?.progress.find((item) => item.blockId === current?.id)?.state?.turnCount;
    setAnswers({}); setFeedback({}); setTeachBack(""); setTeachBackTurn(savedTurn === 1 ? 2 : 1);
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

  async function sendTeachBack() {
    if (!current || current.blockType !== "teach_back" || !teachBack.trim()) return;
    const answer = teachBack.trim(); setBusy(true); setError("");
    try {
      const result = await playerFetch<{ response: string; isError?: boolean }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: answer, context: { surface: "player", courseCode: "AIESS", lessonKey, blockId: current.id, intent: "teach_back" } }),
      });
      setTutorMessages((value) => [...value, { role: "learner", text: answer }, { role: "mentor", text: result.response, ...(result.isError ? {} : { parentIntent: "teach_back" as const, blockId: current.id }) }]);
      setTeachBack("");
      if (!result.isError) {
        if (teachBackTurn === 2) setCompleted((value) => new Set(value).add(current.id));
        else setTeachBackTurn(2);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Tutor reply failed"); }
    finally { setBusy(false); }
  }

  async function askTutor() {
    if (!question.trim()) return;
    const content = question.trim(); setBusy(true); setError("");
    try {
      const result = await playerFetch<{ response: string; isError?: boolean }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: content, context: { surface: "player", courseCode: "AIESS", lessonKey, blockId: current?.id, intent: "question" } }),
      });
      setTutorMessages((value) => [...value, { role: "learner", text: content }, { role: "mentor", text: result.response, ...(result.isError ? {} : { parentIntent: "question" as const, blockId: current?.id }) }]);
      setQuestion("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Tutor reply failed"); }
    finally { setBusy(false); }
  }

  async function explainMore(parentIntent: ParentIntent, blockId?: string) {
    setBusy(true); setError("");
    try {
      const result = await playerFetch<{ response: string }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ context: { surface: "player", courseCode: "AIESS", lessonKey, blockId, intent: "expand", parentIntent } }),
      });
      setTutorMessages((value) => [...value, { role: "mentor", text: result.response }]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Tutor expansion failed"); }
    finally { setBusy(false); }
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
        <div><span className="player-eyebrow">{data.lesson.category ?? "AI Essentials"}</span><h1>{data.lesson.title}</h1>{data.hasCapstone && <Link className="player-project-link" href={`/learn/${course}/capstone`}>Open project</Link>}</div>
        <div className="player-progress" aria-label={`${done} of ${total} blocks complete`}><span style={{ width: `${100 * done / total}%` }} /></div>
      </header>

      {tutorMessages.length > 0 && <aside className="player-tutor-log" aria-label="AI Mentor messages">{tutorMessages.slice(-3).map((message, index, visible) => <div key={`${tutorMessages.length}-${index}`} className={`player-message ${message.role}`}><strong>{message.role === "mentor" ? "AI Mentor" : "You"}</strong><p>{message.text}</p>{message.role === "mentor" && message.parentIntent && index === visible.length - 1 && <button type="button" className="player-chip" disabled={busy} aria-label="Ask AI Mentor to explain the previous reply in more detail" onClick={() => explainMore(message.parentIntent!, message.blockId)}>Explain more</button>}</div>)}</aside>}

      {current ? <><section className="player-card" aria-live="polite">
        <div className="player-step">Step {done + 1} of {total}</div>
        {current.blockType === "teach" && <><ReactMarkdown remarkPlugins={[remarkGfm]}>{(current as Teach).content}</ReactMarkdown><button disabled={busy} onClick={() => complete({ acknowledged: true })}>Next</button></>}
        {current.blockType === "quiz_checkpoint" && !submittedComplete.has(current.id) && <>
          {(current as Quiz).questions.map((question) => <fieldset key={question.id}><legend>{question.prompt}</legend>{question.options?.map((option) => <label className="player-option" key={option}><input type="radio" name={question.id} value={option} checked={answers[question.id] === option} onChange={() => setAnswers((value) => ({ ...value, [question.id]: option }))} />{option}</label>)}</fieldset>)}
          <button disabled={busy || (current as Quiz).questions.some((q) => !answers[q.id])} onClick={() => complete(answers)}>Submit answer</button>
        </>}
        {current.blockType === "drag_order" && !submittedComplete.has(current.id) && <><h2>{(current as Drag).prompt}</h2><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={order} strategy={verticalListSortingStrategy}><ol className="player-sort-list">{order.map((item, index) => <SortableOrderItem key={item} id={item} label={(current as Drag).items[item]} position={index} />)}</ol></SortableContext></DndContext><button disabled={busy} onClick={() => complete(order)}>Check order</button></>}
        {current.blockType === "teach_back" && <><h2>Teach it back</h2><p>{(current as TeachBack).prompt}</p><textarea value={teachBack} onChange={(event) => setTeachBack(event.target.value)} placeholder="Explain it in your own words…" rows={5} /><button disabled={busy || !teachBack.trim()} onClick={sendTeachBack}>{teachBackTurn === 1 ? "Share with AI Mentor" : "Send follow-up"}</button></>}
        {feedback[current.id] ? <pre className="player-feedback">{JSON.stringify(feedback[current.id], null, 2)}</pre> : null}
        {submittedComplete.has(current.id) && <button onClick={advanceReviewedBlock}>Continue</button>}
        {error && <p className="player-error">{error}</p>}
      </section><aside className="player-card"><h2>Ask AI Mentor</h2><textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} placeholder="Ask about this lesson…" /><button disabled={busy || !question.trim()} onClick={askTutor}>Ask a question</button></aside></> : <section className="player-card player-complete"><span>Lesson complete</span><h2>Nicely done.</h2><p>Your progress is saved.</p>{data.nextLessonKey ? <Link className="player-button" href={`/learn/${course}/${data.nextLessonKey}`}>Continue to next lesson</Link> : <Link className="player-button" href={`/learn/${course}/capstone`}>Open capstone</Link>}</section>}
    </main>
  );
}
