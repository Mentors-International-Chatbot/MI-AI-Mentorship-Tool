'use client';

import { useRef, useState } from 'react';
import { useDashboardLang } from '../../DashboardLangContext';

export function SendMessageForm({
  socioId,
  initialAiPaused,
}: {
  socioId: string;
  initialAiPaused: boolean;
}) {
  const { t } = useDashboardLang();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [aiPaused, setAiPaused] = useState(initialAiPaused);
  const [toggling, setToggling] = useState(false);

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

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || t.sendError);
      }

      setText('');
      if (data.whatsappError) {
        setError(`Saved, but WhatsApp delivery failed: ${data.whatsappError}`);
      } else {
        setSent(true);
      }
      textareaRef.current?.focus();
      setTimeout(() => setSent(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.sendError);
    } finally {
      setSending(false);
    }
  }

  async function handleToggle() {
    setToggling(true);
    try {
      const res = await fetch(`/api/dashboard/socios/${socioId}/ai-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiPaused: !aiPaused }),
      });
      if (!res.ok) throw new Error('Failed to update');
      setAiPaused((prev) => !prev);
    } catch {
      setError('Could not update chatbot status. Please try again.');
    } finally {
      setToggling(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${aiPaused ? 'bg-yellow-400' : 'bg-green-500'}`} />
        <span className="text-sm text-gray-600">{aiPaused ? t.aiPausedLabel : t.aiActive}</span>
      </div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.sendPlaceholder}
        rows={3}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A] resize-none"
      />
      <div className="flex items-center justify-between mt-2 gap-2">
        <div className="text-sm">
          {sent && <span className="text-green-600">{t.messageSent}</span>}
          {error && <span className="text-red-600">{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggle}
            disabled={toggling}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 ${
              aiPaused
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-yellow-500 hover:bg-yellow-600'
            }`}
          >
            {toggling ? '...' : aiPaused ? t.handBackToAi : t.takeOver}
          </button>
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="bg-[#1B2A4A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2a3d66] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? t.sending : t.sendButton}
          </button>
        </div>
      </div>
    </form>
  );
}
