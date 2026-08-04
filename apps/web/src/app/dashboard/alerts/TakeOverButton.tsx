'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Pauses the chatbot for a socio and sends the mentor to their conversation.
 *
 * Reuses the existing takeover path — the same `ai-toggle` endpoint the socio
 * detail page's AiToggleButton posts to. No new route, no second definition of
 * what "taking over" means.
 */
export function TakeOverButton({ socioId, label }: { socioId: string; label: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function takeOver() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/dashboard/socios/${socioId}/ai-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiPaused: true }),
      });
      if (!res.ok) throw new Error('Failed to take over');
      // Invalidate the client Router Cache before navigating. The detail page
      // seeds its AI toggle from a server prop into useState, which reads the
      // value once on mount — so a cached RSC payload would show "AI active"
      // immediately after we paused it, and the mentor would believe they had
      // taken over while the AI kept answering. `force-dynamic` on that page
      // governs server rendering only; it does not touch this cache. Today's
      // staleTimes.dynamic default of 0 would hide the bug, which is exactly
      // why this does not rely on it.
      router.refresh();
      router.push(`/dashboard/socios/${socioId}`);
    } catch {
      // Staying on the page with the button re-enabled is the recoverable
      // outcome; navigating to a chat the AI still owns would not be.
      setError(true);
      setLoading(false);
    }
  }

  return (
    <button
      onClick={takeOver}
      disabled={loading}
      className={`rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors ${
        error ? 'bg-gray-500 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-700'
      } disabled:opacity-60`}
    >
      {loading ? '...' : label}
    </button>
  );
}
