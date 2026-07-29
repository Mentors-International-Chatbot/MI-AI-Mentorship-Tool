'use client';

import { useDashboardLang } from '../../DashboardLangContext';

export type AssessmentScoreRow = {
  id: string;
  lessonKey: string;
  status: string;
  attemptNumber: number;
  passed: boolean;
  /** Gating dimension score, when the session recorded one. */
  score: number | null;
  completedAt: string | null;
};

export type AssessmentScoresPanelProps = {
  title: string;
  rows: AssessmentScoreRow[];
};

/**
 * Per-lesson gate results. Course-agnostic: reads whatever assessment sessions
 * the course produced, with no assumption about how many lessons are gated or
 * which dimension gates them.
 */
export function AssessmentScoresPanel({ title, rows }: AssessmentScoresPanelProps) {
  const { t } = useDashboardLang();

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-gray-900 mb-3">{title}</h3>
        <p className="text-sm text-gray-400">{t.assessmentScoresEmpty}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold text-gray-900 mb-3">{title}</h3>
      <ul className="space-y-2">
        {rows.map((row) => {
          const stateLabel = row.passed
            ? t.assessmentPassed
            : row.status === 'completed'
              ? t.assessmentNotPassed
              : t.assessmentInProgress;
          const stateClass = row.passed
            ? 'bg-green-100 text-green-800'
            : row.status === 'completed'
              ? 'bg-red-100 text-red-800'
              : 'bg-gray-100 text-gray-600';

          return (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 border-b border-gray-100 pb-2 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-sm text-gray-900 truncate">{row.lessonKey}</p>
                {row.attemptNumber > 1 && (
                  <p className="text-xs text-gray-400">
                    {t.assessmentAttempts(row.attemptNumber)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {row.score != null && (
                  <span className="text-sm font-medium text-gray-900">{row.score}</span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded-full ${stateClass}`}>
                  {stateLabel}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
