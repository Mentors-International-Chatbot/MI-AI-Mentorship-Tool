'use client';

import { useDashboardLang } from '../../DashboardLangContext';

type SerializedMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

const ROLE_STYLES: Record<string, string> = {
  user: 'bg-[#2DD4BF] text-white ml-auto',
  assistant: 'bg-gray-200 text-gray-900 mr-auto',
  mentor: 'bg-[#1B2A4A] text-white mr-auto',
  system: 'bg-gray-100 text-gray-500 mr-auto italic',
};

export function ChatHistory({ messages }: { messages: SerializedMessage[] }) {
  const { lang, t } = useDashboardLang();

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
          <div key={msg.id} className={`max-w-[80%] rounded-lg px-4 py-2 ${ROLE_STYLES[msg.role] ?? ROLE_STYLES.system}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold opacity-75">{roleLabels[msg.role] ?? msg.role}</span>
              <span className="text-xs opacity-50">{formatTime(msg.createdAt)}</span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
