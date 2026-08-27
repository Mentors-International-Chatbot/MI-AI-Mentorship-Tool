"use client";

import { useEffect, useMemo } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { QuizAnswer } from "@/lib/player/quizGrading";
import { SortableOrderItem } from "./SortableOrderItem";

export type QuizQuestionDto = {
  id: string;
  prompt: string;
  format: "multiple_choice" | "short_answer" | "fill_in_blank" | "drag_to_order" | "matching";
  options?: string[];
  matchingPrompts?: Array<{ id: string; text: string }>;
  /** fill_in_blank only. When present, replaces the free-text input with a click-to-select bank. */
  wordBank?: string[];
  graded: boolean;
};

export function isCompleteQuizAnswer(question: QuizQuestionDto, answer: QuizAnswer | undefined): boolean {
  if (question.format === "drag_to_order") {
    return Array.isArray(answer) && answer.length === (question.options?.length ?? 0);
  }
  if (question.format === "matching") {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false;
    const values = (question.matchingPrompts ?? []).map((prompt) => answer[prompt.id]);
    return values.length >= 2 && values.every(Boolean) && new Set(values).size === values.length;
  }
  return typeof answer === "string" && answer.trim().length > 0;
}

function DragToOrderField({ question, answer, onChange }: {
  question: QuizQuestionDto;
  answer: QuizAnswer | undefined;
  onChange: (answer: QuizAnswer) => void;
}) {
  const options = useMemo(() => question.options ?? [], [question.options]);
  const order = Array.isArray(answer) ? answer : options;
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    if (!Array.isArray(answer) && options.length > 0) onChange(options);
  }, [answer, onChange, options]);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onChange(arrayMove(order, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ol className="player-sort-list">
          {order.map((label, index) => <SortableOrderItem key={label} id={label} label={label} position={index} />)}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

export function QuizQuestionField({ blockId, question, answer, onChange }: {
  blockId: string;
  question: QuizQuestionDto;
  answer: QuizAnswer | undefined;
  onChange: (answer: QuizAnswer) => void;
}) {
  if (question.format === "multiple_choice") {
    return question.options?.map((option) => (
      <label className="player-option" key={option}>
        <input
          type="radio"
          name={`${blockId}-${question.id}`}
          value={option}
          checked={answer === option}
          onChange={() => onChange(option)}
        />
        {option}
      </label>
    ));
  }

  // A word bank replaces the free-text input entirely rather than sitting
  // alongside it: the point is that every submitted answer is one of these
  // exact strings, so grading's normalized match always succeeds for a
  // learner who picks correctly. Free text next to it would reopen the same
  // paraphrase-marked-wrong gap for anyone who typed instead of clicked.
  if (question.format === "fill_in_blank" && question.wordBank && question.wordBank.length > 0) {
    return (
      <div className="player-wordbank" role="group" aria-label={question.prompt}>
        {question.wordBank.map((word) => (
          <button
            type="button"
            key={word}
            className={`player-chip${answer === word ? " is-selected" : ""}`}
            aria-pressed={answer === word}
            onClick={() => onChange(word)}
          >
            {word}
          </button>
        ))}
      </div>
    );
  }

  if (question.format === "short_answer" || question.format === "fill_in_blank") {
    return (
      <input
        className={`player-bounded-short-answer${question.format === "fill_in_blank" ? " is-fill" : ""}`}
        value={typeof answer === "string" ? answer : ""}
        onChange={(event) => onChange(event.target.value)}
        aria-label={question.prompt}
        autoComplete="off"
      />
    );
  }

  if (question.format === "drag_to_order") {
    return <DragToOrderField question={question} answer={answer} onChange={onChange} />;
  }

  const matches = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {};
  const used = new Set(Object.values(matches));
  return (
    <div className="player-matching-grid">
      {(question.matchingPrompts ?? []).map((prompt) => (
        <label key={prompt.id}>
          <span>{prompt.text}</span>
          <select
            value={matches[prompt.id] ?? ""}
            onChange={(event) => onChange({ ...matches, [prompt.id]: event.target.value })}
            aria-label={`Match for ${prompt.text}`}
          >
            <option value="">Choose a match</option>
            {(question.options ?? []).map((option) => (
              <option key={option} value={option} disabled={used.has(option) && matches[prompt.id] !== option}>{option}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
