'use client';

import { useMemo, useState } from 'react';

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
  const [summaries, setSummaries] = useState<SerializedSummary[]>(initialSummaries);
  const [expandedId, setExpandedId] = useState<string | null>(initialSummaries[0]?.id ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sortedSummaries = useMemo(
    () => [...summaries].sort((a, b) => +new Date(b.weekStartDate) - +new Date(a.weekStartDate)),
    [summaries],
  );

  async function refreshSummaries() {
    const res = await fetch(`/api/dashboard/socios/${socioId}/summaries`);
    const data = (await res.json()) as { summaries?: SerializedSummary[]; error?: string };
    if (!res.ok) {
      throw new Error(data.error || 'No se pudieron refrescar los resúmenes');
    }

    const next = data.summaries ?? [];
    setSummaries(next);
    if (next.length > 0 && !expandedId) {
      setExpandedId(next[0].id);
    }
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
        throw new Error(data.error || 'No se pudo generar el resumen');
      }
      await refreshSummaries();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el resumen');
    } finally {
      setLoading(false);
    }
  }

  function formatWeek(iso: string): string {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `Semana del ${day}/${month}/${year}`;
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">Resúmenes semanales</h3>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="px-3 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Generando...' : 'Generar resumen'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}

      {sortedSummaries.length === 0 ? (
        <p className="text-sm text-gray-400">Sin resúmenes aún.</p>
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
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${HEALTH_DOT[health]}`} />
                    <span className="text-sm font-medium text-gray-800">{formatWeek(summary.weekStartDate)}</span>
                  </div>
                  <span className="text-xs text-gray-500">{isExpanded ? 'Ocultar' : 'Ver'}</span>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{summary.content}</p>

                    {summary.flags?.achievements?.length ? (
                      <div className="mt-2">
                        <p className="text-sm font-medium text-gray-800">✅ Logros</p>
                        <ul className="text-sm text-gray-700 list-disc ml-5">
                          {summary.flags.achievements.map((item, idx) => (
                            <li key={`${summary.id}-a-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {summary.flags?.risks?.length ? (
                      <div className="mt-2">
                        <p className="text-sm font-medium text-gray-800">⚠️ Riesgos</p>
                        <ul className="text-sm text-gray-700 list-disc ml-5">
                          {summary.flags.risks.map((item, idx) => (
                            <li key={`${summary.id}-r-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {summary.flags?.recommendedAction ? (
                      <p className="mt-2 text-sm text-gray-700">
                        💡 Acción recomendada: {summary.flags.recommendedAction}
                      </p>
                    ) : null}

                    {summary.metrics ? (
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
                        <span>Mensajes: {summary.metrics.messageCount}</span>
                        <span>Lecciones: {summary.metrics.lessonsCompleted}</span>
                        <span>Confusión prom.: {summary.metrics.avgConfusion}</span>
                        <span>Frustración prom.: {summary.metrics.avgFrustration}</span>
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
