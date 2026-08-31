'use client';

import { useEffect, useRef, useState } from 'react';
import { useDashboardLang } from '../../DashboardLangContext';

type SerializedMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  isAssessment?: boolean;
};

const ROLE_STYLES: Record<string, string> = {
  user: 'bg-[#2DD4BF] text-white ml-auto',
  assistant: 'bg-gray-200 text-gray-900 mr-auto',
  mentor: 'bg-[#1B2A4A] text-white mr-auto',
  system: 'bg-gray-100 text-gray-500 mr-auto italic',
};

export function ChatHistory({
  socioId,
  messages: initialMessages,
}: {
  socioId: string;
  messages: SerializedMessage[];
}) {
  const { lang, t } = useDashboardLang();
  const [messages, setMessages] = useState<SerializedMessage[]>(initialMessages);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastTimestampRef = useRef<string | null>(
    initialMessages.length > 0
      ? initialMessages[initialMessages.length - 1].createdAt
      : null,
  );

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll for new messages every 3 seconds
  useEffect(() => {
    const poll = async () => {
      const since = lastTimestampRef.current;
      const url = `/api/dashboard/socios/${socioId}/conversation${since ? `?since=${encodeURIComponent(since)}` : ''}`;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as { messages: SerializedMessage[] };
        if (data.messages.length === 0) return;

        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = data.messages.filter((m) => !existingIds.has(m.id));
          if (newMsgs.length === 0) return prev;
          const updated = [...prev, ...newMsgs];
          lastTimestampRef.current = updated[updated.length - 1].createdAt;
          return updated;
        });
      } catch {
        // ignore poll errors silently
      }
    };

    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [socioId]);

  const roleLabels: Record<string, string> = {
    user: t.roleSocio,
    assistant: t.roleAI,
    mentor: t.roleMentor,
    system: t.roleSystem,
  };

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const locale = lang === 'pt' ? 'pt-BR' : lang === 'en' ? 'en-US' : 'es-CO';
    return d.toLocaleString(locale, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <h3 className="px-4 py-3 font-semibold text-gray-900 border-b">{t.chatTitle}</h3>
      <div className="p-4 space-y-3 max-h-[500px] overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-8">{t.noMessages}</p>
        )}
        {messages.map((msg) => (
          // `msg-<id>` is the scroll target for a flag's "View message" link.
          <div
            key={msg.id}
            id={`msg-${msg.id}`}
            className={`max-w-[80%] rounded-lg px-4 py-2 scroll-mt-4 transition-shadow duration-300 ${ROLE_STYLES[msg.role] ?? ROLE_STYLES.system}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold opacity-75">{roleLabels[msg.role] ?? msg.role}</span>
              {msg.isAssessment && (
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-black/10">{t.assessmentBadge}</span>
              )}
              <span className="text-xs opacity-50">{formatTime(msg.createdAt)}</span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
