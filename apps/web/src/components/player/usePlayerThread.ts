"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playerFetch } from "@/lib/player/client";

export type PlayerThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  senderType: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

export function mergePlayerMessages(
  current: PlayerThreadMessage[],
  incoming: PlayerThreadMessage[],
): PlayerThreadMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => {
    const timeDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return timeDifference || left.id.localeCompare(right.id);
  });
}

export function usePlayerThread(course: string, lessonKey: string) {
  const [messages, setMessages] = useState<PlayerThreadMessage[]>([]);
  const sinceRef = useRef<string | null>(null);

  const advanceCursor = useCallback((rows: PlayerThreadMessage[]) => {
    for (const row of rows) {
      if (!sinceRef.current || row.createdAt > sinceRef.current) sinceRef.current = row.createdAt;
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const result = await playerFetch<{ messages: PlayerThreadMessage[] }>(
        `/api/learn/${encodeURIComponent(course)}/${encodeURIComponent(lessonKey)}/thread`,
      );
      advanceCursor(result.messages);
      setMessages((current) => mergePlayerMessages(current, result.messages));
    } catch {
      // History is decoration around the learning flow, never a blocker.
    }
  }, [advanceCursor, course, lessonKey]);

  useEffect(() => {
    let active = true;
    let polling = false;
    setMessages([]);
    // Capture the lower bound before hydration so a mentor message committed
    // during the mount fetch cannot fall between the snapshot and the poll.
    sinceRef.current = new Date().toISOString();
    void reload();

    const poll = async () => {
      if (polling || !sinceRef.current) return;
      polling = true;
      try {
        const result = await playerFetch<{ messages: PlayerThreadMessage[] }>(
          `/api/chat/poll?since=${encodeURIComponent(sinceRef.current)}`,
        );
        if (!active) return;
        advanceCursor(result.messages);
        const mentorMessages = result.messages.filter((message) => message.senderType === "mentor");
        if (mentorMessages.length > 0) {
          setMessages((current) => mergePlayerMessages(current, mentorMessages));
        }
      } catch {
        // Transcript polling is best-effort and must never interrupt a lesson.
      } finally {
        polling = false;
      }
    };

    const interval = window.setInterval(() => { void poll(); }, 5_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [advanceCursor, reload]);

  return { messages, reload };
}
