'use client';

import { useState } from 'react';
import { useDashboardLang } from '../../DashboardLangContext';

export function AiToggleButton({
  socioId,
  initialAiPaused,
}: {
  socioId: string;
  initialAiPaused: boolean;
}) {
  const { t } = useDashboardLang();
  const [aiPaused, setAiPaused] = useState(initialAiPaused);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    setLoading(true);
    setError('');
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
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 bg-white rounded-lg shadow px-4 py-3">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${aiPaused ? 'bg-yellow-400' : 'bg-green-500'}`} />
      <span className="text-sm text-gray-600">
        {aiPaused ? t.aiPausedLabel : t.aiActive}
      </span>
      <button
        onClick={toggle}
        disabled={loading}
        className={`ml-auto px-4 py-1.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 ${
          aiPaused
            ? 'bg-green-600 hover:bg-green-700'
            : 'bg-yellow-500 hover:bg-yellow-600'
        }`}
      >
        {loading ? '...' : aiPaused ? t.handBackToAi : t.takeOver}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
