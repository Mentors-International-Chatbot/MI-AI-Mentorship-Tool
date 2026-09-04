'use client';

import { useState } from 'react';
import { useDashboardLang } from '../../DashboardLangContext';

type ChatTurn = { role: 'user' | 'assistant'; content: string };

type Proposal = { name: string; args: Record<string, unknown> };

const TOOL_LABEL: Record<string, string> = {
  adjust_learner_overrides: 'Adjust AI tutoring settings',
  resolve_flag: 'Resolve a flag',
  snooze_flag: 'Snooze a flag',
  draft_message_to_learner: 'Send a message to this learner',
};

/**
 * D.3 embedded assistant. Ephemeral, client-only chat state — not persisted.
 * Every mutating tool call renders as an inline action card the mentor must
 * confirm; nothing executes on the strength of the model's own say-so. See
 * lib/ai/mentorAssistant/tools.ts for why that split exists.
 */
export function AssistantPanel({ socioId }: { socioId: string }) {
  const { t } = useDashboardLang();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [draftEdit, setDraftEdit] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const message = input.trim();
    if (!message || pending) return;
    setInput('');
    setError(null);
    const nextTurns = [...turns, { role: 'user' as const, content: message }];
    setTurns(nextTurns);
    setPending(true);

    try {
      const res = await fetch(`/api/dashboard/socios/${socioId}/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextTurns }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.assistantError);
        return;
      }
      if (data.type === 'proposal') {
        setProposal(data.proposal);
        if (data.proposal.name === 'draft_message_to_learner') {
          setDraftEdit(String(data.proposal.args.message ?? ''));
        }
        if (data.assistantText) {
          setTurns((prev) => [...prev, { role: 'assistant', content: data.assistantText }]);
        }
      } else {
        setTurns((prev) => [...prev, { role: 'assistant', content: data.content }]);
      }
    } catch {
      setError(t.assistantError);
    } finally {
      setPending(false);
    }
  }

  async function confirmProposal() {
    if (!proposal) return;
    setPending(true);
    setError(null);
    const args =
      proposal.name === 'draft_message_to_learner' ? { message: draftEdit } : proposal.args;

    try {
      const res = await fetch(`/api/dashboard/socios/${socioId}/assistant/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: proposal.name, args }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.assistantError);
        return;
      }
      setTurns((prev) => [...prev, { role: 'assistant', content: data.resultText }]);
      setProposal(null);
    } catch {
      setError(t.assistantError);
    } finally {
      setPending(false);
    }
  }

  function cancelProposal() {
    setProposal(null);
    setTurns((prev) => [...prev, { role: 'assistant', content: t.assistantCancelled }]);
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold text-gray-900 mb-3">{t.assistantTitle}</h3>

      <div className="space-y-2 max-h-72 overflow-y-auto mb-3">
        {turns.length === 0 && !pending && (
          <p className="text-sm text-gray-400">{t.assistantEmpty}</p>
        )}
        {turns.map((turn, i) => (
          <div
            key={i}
            className={`text-sm p-2 rounded ${
              turn.role === 'user' ? 'bg-blue-50 text-blue-900' : 'bg-gray-50 text-gray-700'
            }`}
          >
            {turn.content}
          </div>
        ))}
        {pending && <p className="text-xs text-gray-400">{t.assistantThinking}</p>}
      </div>

      {proposal && (
        <div className="border border-amber-300 bg-amber-50 rounded p-3 mb-3 space-y-2">
          <p className="text-xs font-medium text-amber-800">
            {t.assistantProposalLabel}: {TOOL_LABEL[proposal.name] ?? proposal.name}
          </p>

          {proposal.name === 'draft_message_to_learner' ? (
            <textarea
              value={draftEdit}
              onChange={(e) => setDraftEdit(e.target.value)}
              rows={3}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1"
            />
          ) : (
            <pre className="text-xs text-gray-700 whitespace-pre-wrap">
              {JSON.stringify(proposal.args, null, 2)}
            </pre>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => void confirmProposal()}
              className="text-xs text-white bg-amber-600 hover:bg-amber-700 rounded px-3 py-1 disabled:opacity-50"
            >
              {t.assistantConfirm}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={cancelProposal}
              className="text-xs text-gray-500 hover:underline"
            >
              {t.assistantCancel}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
          placeholder={t.assistantPlaceholder}
          disabled={pending || !!proposal}
          className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100"
        />
        <button
          type="button"
          disabled={pending || !!proposal}
          onClick={() => void send()}
          className="text-sm text-white bg-[#1B2A4A] hover:opacity-90 rounded px-3 py-1 disabled:opacity-50"
        >
          {t.assistantSend}
        </button>
      </div>
    </div>
  );
}
