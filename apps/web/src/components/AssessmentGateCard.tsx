'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ASSESSMENT_STRINGS, type SupportedLanguage } from '@/lib/i18n/languages';

interface AssessmentGateCardProps {
  sessionId: string;
  content: string;
  language: SupportedLanguage;
}

type SessionStatus = 'pending' | 'in_progress' | 'completed';

interface SessionData {
  session: {
    id: string;
    status: SessionStatus;
    scores: Record<string, number> | null;
    passedAt: string | null;
  };
  config: {
    studentVisibleDimensionKeys: string[];
  };
}

export function AssessmentGateCard({ sessionId, content, language }: AssessmentGateCardProps) {
  const router = useRouter();
  const strings = ASSESSMENT_STRINGS[language];

  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [scores, setScores] = useState<Record<string, number> | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, [sessionId]);

  async function fetchStatus() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/assessment/${sessionId}`);
      if (!res.ok) {
        throw new Error('Failed to fetch');
      }
      const data = (await res.json()) as SessionData;
      setStatus(data.session.status);
      setScores(data.session.scores);
      setVisibleKeys(data.config.studentVisibleDimensionKeys || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function handleNavigate() {
    setNavigating(true);
    router.push(`/chat/assessment/${sessionId}`);
  }

  // Render visible scores as chips
  function renderScoreChips() {
    if (!scores || visibleKeys.length === 0) return null;

    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {visibleKeys.map((key) => {
          const score = scores[key];
          if (score === undefined) return null;
          return (
            <span
              key={key}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
            >
              {strings.scoreLabel} {score.toFixed(1)}/10
            </span>
          );
        })}
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="my-2 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
        <p className="text-zinc-500 dark:text-zinc-400 text-sm">{strings.loading}</p>
      </div>
    );
  }

  // Error state with retry
  if (error) {
    return (
      <div className="my-2 p-4 rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
        <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200 mb-3">{content}</p>
        <p className="text-red-600 dark:text-red-400 text-sm mb-3">{strings.error}</p>
        <button
          onClick={fetchStatus}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Determine button text and styling based on status
  let buttonText = strings.startButton;
  let buttonStyle = 'bg-emerald-600 hover:bg-emerald-700 text-white';

  if (status === 'in_progress') {
    buttonText = strings.resumeButton;
    buttonStyle = 'bg-emerald-600 hover:bg-emerald-700 text-white';
  } else if (status === 'completed') {
    buttonText = strings.viewButton;
    buttonStyle = 'bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200';
  }

  return (
    <div className="my-2 p-4 rounded-2xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/20">
      <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200 mb-4">{content}</p>

      {/* Score chips for completed sessions */}
      {status === 'completed' && renderScoreChips()}

      <div className="mt-4">
        <button
          onClick={handleNavigate}
          disabled={navigating}
          className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${buttonStyle}`}
        >
          {navigating ? strings.loading : buttonText}
        </button>
      </div>
    </div>
  );
}
