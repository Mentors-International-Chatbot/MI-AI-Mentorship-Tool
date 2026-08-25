"use client";

import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";

export function SortableOrderItem({ id, label, position }: { id: number | string; label: string; position: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.55 : 1 }} className="player-sort-item">
      <span className="player-sort-position">{position + 1}</span>
      <span>{label}</span>
      <button type="button" className="player-drag-handle" aria-label={`Move ${label}`} {...attributes} {...listeners}>↕</button>
    </li>
  );
}
