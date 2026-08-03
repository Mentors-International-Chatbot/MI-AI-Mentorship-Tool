'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatHealthReason } from '@/lib/health/format';
import type { CourseSummary } from '@/lib/journey-package/course-summaries';
import type { DashboardStrings } from '@/lib/i18n/dashboard';
import type { SupportedLanguage } from '@/lib/i18n/languages';
import { useDashboardLang } from '../DashboardLangContext';
import {
  courseAlertPills,
  matchesFilters,
  UNASSIGNED_COURSE_KEY,
  type CourseFilter,
  type CourseRollup,
  type HealthFilter,
  type SocioRow,
} from './courseRollup';

const STATUS_DOT: Record<string, string> = {
  RED: 'bg-red-500',
  YELLOW: 'bg-yellow-400',
  GREEN: 'bg-green-500',
};

const PILL_STYLE: Record<'red' | 'yellow', { pill: string; dot: string }> = {
  red: { pill: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
  yellow: { pill: 'bg-yellow-50 text-yellow-800', dot: 'bg-yellow-400' },
};

function localeFor(lang: SupportedLanguage): string {
  return lang === 'pt' ? 'pt-BR' : lang === 'en' ? 'en-US' : 'es-CO';
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * Relative time in the viewer's language via Intl, so this needs no entry in
 * the string table and stays correct for languages added later.
 */
function formatRelative(iso: string | null, lang: SupportedLanguage, t: DashboardStrings): string {
  if (!iso) return t.never;
  const elapsed = Date.now() - new Date(iso).getTime();
  const rtf = new Intl.RelativeTimeFormat(localeFor(lang), { numeric: 'auto' });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= ms) return rtf.format(-Math.round(elapsed / ms), unit);
  }
  return rtf.format(0, 'minute');
}

function filterButtonClass(active: boolean): string {
  return `px-3 py-1 rounded text-sm border ${
    active
      ? 'bg-[#1B2A4A] text-white border-[#1B2A4A]'
      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
  }`;
}

/** Stable identity for a rollup: its slug, or the unassigned sentinel. */
function rollupKey(rollup: CourseRollup): string {
  return rollup.collectionKey ?? UNASSIGNED_COURSE_KEY;
}

function rollupLabel(rollup: CourseRollup, t: DashboardStrings): string {
  if (rollup.collectionKey === null) return t.courseUnassigned;
  // An unresolved collection has no name; its key is more honest than a dash.
  return rollup.displayName ?? rollup.collectionKey;
}

function CourseCard({
  rollup,
  selected,
  onSelect,
}: {
  rollup: CourseRollup;
  selected: boolean;
  onSelect: () => void;
}) {
  const { lang, t } = useDashboardLang();
  const percent =
    rollup.lessonCount > 0
      ? Math.min(100, Math.round((rollup.averageLesson / rollup.lessonCount) * 100))
      : 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`text-left bg-white rounded-lg shadow p-4 border transition-colors ${
        selected ? 'border-[#1B2A4A] ring-2 ring-[#1B2A4A]/30' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="font-semibold text-gray-900 truncate" title={rollupLabel(rollup, t)}>
        {rollupLabel(rollup, t)}
      </div>
      <div className="mt-1 text-sm text-gray-500">
        {t.courseParticipants(rollup.participantCount)}
      </div>

      <div className="mt-3 text-xs text-gray-600">
        {rollup.lessonCount > 0
          ? t.courseAvgProgress(rollup.averageLesson, rollup.lessonCount)
          : t.courseAvgProgressNoTotal(rollup.averageLesson)}
      </div>
      <div className="mt-1 h-1 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full bg-[#1B2A4A]" style={{ width: `${percent}%` }} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        {courseAlertPills(rollup).map(({ severity, count }) => (
          <span
            key={severity}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${PILL_STYLE[severity].pill}`}
            title={
              severity === 'red'
                ? t.healthReasonRedAlerts(count)
                : t.healthReasonYellowAlerts(count)
            }
          >
            <span className={`w-2 h-2 rounded-full ${PILL_STYLE[severity].dot}`} />
            {count}
          </span>
        ))}
      </div>

      <div className="mt-3 text-xs text-gray-400">
        {t.courseLastActivity}: {formatRelative(rollup.lastInteractionAt, lang, t)}
      </div>
    </button>
  );
}

export function SocioListTable({
  rows,
  rollups,
  courses,
}: {
  rows: SocioRow[];
  rollups: CourseRollup[];
  courses: CourseSummary[];
}) {
  const { lang, t } = useDashboardLang();
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('ALL');
  const [courseFilter, setCourseFilter] = useState<CourseFilter>('ALL');

  const courseByKey = useMemo(
    () => new Map(courses.map((c) => [c.collectionKey, c])),
    [courses],
  );

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesFilters(row, healthFilter, courseFilter)),
    [rows, healthFilter, courseFilter],
  );

  const FILTER_LABELS: Record<HealthFilter, string> = {
    ALL: t.filterAll,
    RED: t.filterRed,
    YELLOW: t.filterYellow,
    GREEN: t.filterGreen,
  };

  function toggleCourse(key: string) {
    setCourseFilter((current) => (current === key ? 'ALL' : key));
  }

  function formatDate(iso: string | null): string {
    if (!iso) return t.never;
    const d = new Date(iso);
    return d.toLocaleDateString(localeFor(lang), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  /** Course cell: the course's name, or a dash when the socio has no course. */
  function courseCell(row: SocioRow): string {
    if (!row.curriculumCollectionKey) return '—';
    return courseByKey.get(row.curriculumCollectionKey)?.displayName ?? row.curriculumCollectionKey;
  }

  /** "4 / 28" where the course length is known, otherwise the bare lesson number. */
  function lessonCell(row: SocioRow): string {
    const lessonCount = row.curriculumCollectionKey
      ? courseByKey.get(row.curriculumCollectionKey)?.lessonCount ?? 0
      : 0;
    return lessonCount > 0 ? `${row.currentLesson} / ${lessonCount}` : `${row.currentLesson}`;
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        {t.noActiveSocios}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
        {rollups.map((rollup) => (
          <CourseCard
            key={rollupKey(rollup)}
            rollup={rollup}
            selected={courseFilter === rollupKey(rollup)}
            onSelect={() => toggleCourse(rollupKey(rollup))}
          />
        ))}
        {/* Not a feature — a statement that adding a course is configuration. */}
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-4 flex items-center justify-center text-center text-sm text-gray-400">
          {t.coursePlaceholder}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['ALL', 'RED', 'YELLOW', 'GREEN'] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setHealthFilter(status)}
            className={filterButtonClass(healthFilter === status)}
          >
            {FILTER_LABELS[status]}
          </button>
        ))}

        <span className="w-px h-6 bg-gray-200 mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={() => setCourseFilter('ALL')}
          className={filterButtonClass(courseFilter === 'ALL')}
        >
          {t.courseFilterAll}
        </button>
        {rollups.map((rollup) => (
          <button
            key={rollupKey(rollup)}
            type="button"
            onClick={() => toggleCourse(rollupKey(rollup))}
            className={filterButtonClass(courseFilter === rollupKey(rollup))}
          >
            {rollupLabel(rollup, t)}
          </button>
        ))}
      </div>

      {filteredRows.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          {t.noSociosWithStatus(FILTER_LABELS[healthFilter])}
        </div>
      ) : null}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.thStatus}</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.thName}</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.thChannel}</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.thCourse}</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.thLesson}</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.thLastInteraction}</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {filteredRows.map((row) => (
            <tr key={row.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-3 h-3 rounded-full ${STATUS_DOT[row.health.status]}`} />
                  <span className="text-xs text-gray-500">
                    {row.health.reasons[0] ? formatHealthReason(row.health.reasons[0], t) : ''}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <Link href={`/dashboard/socios/${row.id}`} className="text-[#1B2A4A] font-medium hover:underline">
                  {row.name || t.noName}
                </Link>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                {row.channelType}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {courseCell(row)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {lessonCell(row)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {formatDate(row.lastInteractionAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
