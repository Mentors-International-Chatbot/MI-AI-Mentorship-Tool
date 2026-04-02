'use client';

import { useRef, useState } from 'react';
import { useDashboardLang } from '../../DashboardLangContext';

export function SendMessageForm({ socioId }: { socioId: string }) {
  const { t } = useDashboardLang();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;

    setSending(true);
    setError('');
    setSent(false);

    try {
      const res = await fetch(`/api/dashboard/socios/${socioId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.sendError);
      }

      setText('');
      setSent(true);
      textareaRef.current?.focus();
      setTimeout(() => setSent(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.sendError);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.sendPlaceholder}
        rows={3}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A] resize-none"
      />
      <div className="flex items-center justify-between mt-2">
        <div className="text-sm">
          {sent && <span className="text-green-600">{t.messageSent}</span>}
          {error && <span className="text-red-600">{error}</span>}
        </div>
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="bg-[#1B2A4A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2a3d66] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? t.sending : t.sendButton}
        </button>
      </div>
    </form>
  );
}
