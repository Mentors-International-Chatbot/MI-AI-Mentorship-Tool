'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatHealthReason } from '@/lib/health/format';
import type { CourseSummary } from '@/lib/journey-package/course-summaries';
import { useDashboardLang } from '../DashboardLangContext';
import { CourseCardGrid, localeFor, rollupKey, rollupLabel } from './CourseCardGrid';
import {
  matchesFilters,
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

function filterButtonClass(active: boolean): string {
  return `px-3 py-1 rounded text-sm border ${
    active
      ? 'bg-[#1B2A4A] text-white border-[#1B2A4A]'
      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
  }`;
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
      <CourseCardGrid
        rollups={rollups}
        selectedKey={courseFilter}
        onSelect={toggleCourse}
        t={t}
        lang={lang}
      />

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
