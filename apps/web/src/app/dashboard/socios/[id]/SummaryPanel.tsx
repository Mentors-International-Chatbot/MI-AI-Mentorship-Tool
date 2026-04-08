'use client';

import { useMemo, useState } from 'react';
import { useDashboardLang } from '../../DashboardLangContext';

type SummaryFlags = {
  risks: string[];
  achievements: string[];
  recommendedAction: string;
  overallHealth: 'green' | 'yellow' | 'red';
};

type SummaryMetrics = {
  messageCount: number;
  lessonsCompleted: number;
  avgConfusion: number;
  avgFrustration: number;
  currentLesson: number;
  activeFlagCount: number;
};

export type SerializedSummary = {
  id: string;
  weekStartDate: string;
  content: string;
  flags: SummaryFlags | null;
  metrics: SummaryMetrics | null;
  createdAt: string;
};

const HEALTH_DOT: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-400',
  red: 'bg-red-500',
};

export function SummaryPanel({
  socioId,
  summaries: initialSummaries,
}: {
  socioId: string;
  summaries: SerializedSummary[];
}) {
  const { lang, t } = useDashboardLang();
  const [summaries, setSummaries] = useState<SerializedSummary[]>(initialSummaries);
  const [expandedId, setExpandedId] = useState<string | null>(initialSummaries[0]?.id ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sortedSummaries = useMemo(
    () => [...summaries].sort((a, b) => +new Date(b.weekStartDate) - +new Date(a.weekStartDate)),
    [summaries],
  );

  function formatWeek(iso: string): string {
    const d = new Date(iso);
    const locale = lang === 'pt' ? 'pt-BR' : lang === 'en' ? 'en-US' : 'es-CO';
    return d.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  async function refreshSummaries() {
    const res = await fetch(`/api/dashboard/socios/${socioId}/summaries`);
    const data = (await res.json()) as { summaries?: SerializedSummary[]; error?: string };
    if (!res.ok) {
      throw new Error(data.error || t.summaryGenerateErrorGeneric);
    }

    const next = data.summaries ?? [];
    setSummaries(next);
    setExpandedId((prev) => {
      if (next.length === 0) return null;
      if (prev && next.some((s) => s.id === prev)) return prev;
      return next[0].id;
    });
  }

  async function handleGenerate() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/dashboard/socios/${socioId}/summary/generate`, {
        method: 'POST',
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        if (data.error === 'NO_MESSAGES_THIS_WEEK') {
          throw new Error(t.summaryGenerateErrorNoMessages);
        }
        throw new Error(t.summaryGenerateErrorGeneric);
      }
      await refreshSummaries();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.summaryGenerateErrorGeneric);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">{t.weeklySummariesTitle}</h3>
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={loading}
          className="px-3 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? t.summaryGenerating : t.summaryGenerate}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}

      {sortedSummaries.length === 0 ? (
        <p className="text-sm text-gray-400">{t.summaryNone}</p>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto">
          {sortedSummaries.map((summary) => {
            const health = summary.flags?.overallHealth ?? 'yellow';
            const isExpanded = expandedId === summary.id;

            return (
              <div key={summary.id} className="border rounded-lg">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : summary.id)}
                  className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${HEALTH_DOT[health]}`} />
                    <span className="text-sm font-medium text-gray-800 truncate">
                      {formatWeek(summary.weekStartDate)}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500 shrink-0 ml-2">
                    {isExpanded ? t.summaryHide : t.summaryShow}
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t">
                    <div className="flex flex-wrap items-center justify-end gap-2 mb-2">
                      <button
                        type="button"
                        onClick={() => void handleGenerate()}
                        disabled={loading}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                      >
                        {loading ? t.summaryGenerating : t.summaryRegenerate}
                      </button>
                    </div>

                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{summary.content}</p>

                    {summary.flags?.achievements?.length ? (
                      <div className="mt-2">
                        <p className="text-sm font-medium text-gray-800">{t.summaryAchievements}</p>
                        <ul className="text-sm text-gray-700 list-disc ml-5">
                          {summary.flags.achievements.map((item, idx) => (
                            <li key={`${summary.id}-a-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {summary.flags?.risks?.length ? (
                      <div className="mt-2">
                        <p className="text-sm font-medium text-gray-800">{t.summaryRisks}</p>
                        <ul className="text-sm text-gray-700 list-disc ml-5">
                          {summary.flags.risks.map((item, idx) => (
                            <li key={`${summary.id}-r-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {summary.flags?.recommendedAction ? (
                      <p className="mt-2 text-sm text-gray-700">
                        {t.summaryRecommendedAction}: {summary.flags.recommendedAction}
                      </p>
                    ) : null}

                    {summary.metrics ? (
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
                        <span>
                          {t.summaryMetricMessages}: {summary.metrics.messageCount}
                        </span>
                        <span>
                          {t.summaryMetricLessons}: {summary.metrics.lessonsCompleted}
                        </span>
                        <span>
                          {t.summaryMetricConfusion}: {summary.metrics.avgConfusion}
                        </span>
                        <span>
                          {t.summaryMetricFrustration}: {summary.metrics.avgFrustration}
                        </span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
