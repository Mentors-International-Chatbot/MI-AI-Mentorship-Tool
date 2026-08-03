'use client';

/**
 * Per-course rollup cards.
 *
 * Shared by the mentor dashboard and the admin overview so the two never drift
 * apart visually. The strings arrive as a prop rather than from context because
 * the admin surface has no dashboard language provider — see the call site.
 */
import type { DashboardStrings } from '@/lib/i18n/dashboard';
import type { SupportedLanguage } from '@/lib/i18n/languages';
import { courseAlertPills, UNASSIGNED_COURSE_KEY, type CourseRollup } from './courseRollup';

const PILL_STYLE: Record<'red' | 'yellow', { pill: string; dot: string }> = {
  red: { pill: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
  yellow: { pill: 'bg-yellow-50 text-yellow-800', dot: 'bg-yellow-400' },
};

export function localeFor(lang: SupportedLanguage): string {
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
export function formatRelative(
  iso: string | null,
  lang: SupportedLanguage,
  t: DashboardStrings,
): string {
  if (!iso) return t.never;
  const elapsed = Date.now() - new Date(iso).getTime();
  const rtf = new Intl.RelativeTimeFormat(localeFor(lang), { numeric: 'auto' });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= ms) return rtf.format(-Math.round(elapsed / ms), unit);
  }
  return rtf.format(0, 'minute');
}

/** Stable identity for a rollup: its slug, or the unassigned sentinel. */
export function rollupKey(rollup: CourseRollup): string {
  return rollup.collectionKey ?? UNASSIGNED_COURSE_KEY;
}

export function rollupLabel(rollup: CourseRollup, t: DashboardStrings): string {
  if (rollup.collectionKey === null) return t.courseUnassigned;
  // An unresolved collection has no name; its key is more honest than a dash.
  return rollup.displayName ?? rollup.collectionKey;
}

function CourseCard({
  rollup,
  selected,
  onSelect,
  t,
  lang,
}: {
  rollup: CourseRollup;
  selected: boolean;
  onSelect: () => void;
  t: DashboardStrings;
  lang: SupportedLanguage;
}) {
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
        selected
          ? 'border-[#1B2A4A] ring-2 ring-[#1B2A4A]/30'
          : 'border-gray-200 hover:border-gray-300'
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

export function CourseCardGrid({
  rollups,
  selectedKey,
  onSelect,
  t,
  lang,
}: {
  rollups: CourseRollup[];
  /** 'ALL' when no course is selected. */
  selectedKey: string;
  onSelect: (key: string) => void;
  t: DashboardStrings;
  lang: SupportedLanguage;
}) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
      {rollups.map((rollup) => (
        <CourseCard
          key={rollupKey(rollup)}
          rollup={rollup}
          selected={selectedKey === rollupKey(rollup)}
          onSelect={() => onSelect(rollupKey(rollup))}
          t={t}
          lang={lang}
        />
      ))}
      {/* Not a feature — a statement that adding a course is configuration. */}
      <div className="rounded-lg border-2 border-dashed border-gray-300 p-4 flex items-center justify-center text-center text-sm text-gray-400">
        {t.coursePlaceholder}
      </div>
    </div>
  );
}
