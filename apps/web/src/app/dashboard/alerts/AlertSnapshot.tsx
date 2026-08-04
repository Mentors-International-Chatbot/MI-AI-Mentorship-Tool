import Link from 'next/link';
import type { DashboardStrings } from '@/lib/i18n/dashboard';
import { formatHealthReason } from '@/lib/health';
import {
  formatPositiveSignal,
  positiveSignalIcon,
  type AlertZones,
  type ZoneSocio,
} from '@/lib/signals';
import { TakeOverButton } from './TakeOverButton';

/** Course chrome for one socio, resolved per course rather than per page. */
export type AlertSnapshotSocio = {
  courseName: string | null;
  /** 0 when the collection could not be resolved, or the socio has no course. */
  lessonCount: number;
  /** From CourseMeta.terminology — "socio", "partner", "student". */
  participantNoun: string | null;
};

/** Server component: no state, and the only interactive control is its own island. */
export function AlertSnapshot({
  zones,
  decorations,
  socioNames,
  t,
}: {
  zones: AlertZones;
  decorations: Record<string, AlertSnapshotSocio>;
  socioNames: Record<string, string | null>;
  t: DashboardStrings;
}) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CountTile label={t.tileNeedsYouNow} count={zones.needsYouNow.length} role="danger" />
        <CountTile label={t.tileWatching} count={zones.watching.length} role="warning" />
        <CountTile label={t.tileGoodNews} count={zones.goodNews.length} role="success" />
      </div>

      <section>
        <ZoneHeading title={t.zoneNeedsYouNowTitle} count={zones.needsYouNow.length} role="danger" />
        {zones.needsYouNow.length === 0 ? (
          <EmptyState message={t.zoneNeedsYouNowEmpty} role="success" />
        ) : (
          <div className="space-y-4">
            {zones.needsYouNow.map((socio) => (
              <NeedsYouNowCard
                key={socio.socioId}
                socio={socio}
                decoration={decorations[socio.socioId]}
                t={t}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <ZoneHeading title={t.zoneWatchingTitle} count={zones.watching.length} role="warning" />
        {zones.watching.length === 0 ? (
          <EmptyState message={t.zoneWatchingEmpty} role="neutral" />
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {zones.watching.map((socio) => (
              <WatchingRow
                key={socio.socioId}
                socio={socio}
                decoration={decorations[socio.socioId]}
                t={t}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <ZoneHeading title={t.zoneGoodNewsTitle} count={zones.goodNews.length} role="success" />
        {zones.goodNews.length === 0 ? (
          <EmptyState message={t.zoneGoodNewsEmpty} role="neutral" />
        ) : (
          <ul className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
            {zones.goodNews.map((signal, i) => (
              <li
                key={`${signal.socioId}-${signal.kind}-${i}`}
                className="flex items-baseline gap-3 px-4 py-2.5 text-sm"
              >
                <span aria-hidden="true">{positiveSignalIcon(signal)}</span>
                <span className="font-medium text-gray-900">
                  {socioNames[signal.socioId] ?? t.noName}
                </span>
                <span className="text-gray-600">{formatPositiveSignal(signal, t)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

type Role = 'danger' | 'warning' | 'success' | 'neutral';

const TILE_ROLE: Record<Role, string> = {
  danger: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  neutral: 'border-gray-200 bg-gray-50 text-gray-700',
};

const DOT_ROLE: Record<Role, string> = {
  danger: 'bg-red-500',
  warning: 'bg-amber-500',
  success: 'bg-emerald-500',
  neutral: 'bg-gray-400',
};

function CountTile({ label, count, role }: { label: string; count: number; role: Role }) {
  return (
    <div className={`rounded-lg border p-4 ${TILE_ROLE[role]}`}>
      <div className="text-3xl font-bold tabular-nums">{count}</div>
      <div className="text-sm font-medium mt-0.5">{label}</div>
    </div>
  );
}

function ZoneHeading({ title, count, role }: { title: string; count: number; role: Role }) {
  return (
    <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
      <span className={`w-2.5 h-2.5 rounded-full ${DOT_ROLE[role]}`} aria-hidden="true" />
      {title}
      <span className="text-sm font-normal text-gray-500 tabular-nums">({count})</span>
    </h3>
  );
}

/**
 * An empty zone is information, not absence. A mentor with nothing red should
 * read "all clear", never a blank panel that looks like a failed load.
 */
function EmptyState({ message, role }: { message: string; role: Role }) {
  return (
    <div className={`rounded-lg border border-dashed p-6 text-sm ${TILE_ROLE[role]}`}>
      {message}
    </div>
  );
}

/** "Course · Lesson 3 of 28", degrading cleanly when either half is unknown. */
function courseLine(
  socio: ZoneSocio,
  decoration: AlertSnapshotSocio | undefined,
  t: DashboardStrings,
): string {
  const lessonCount = decoration?.lessonCount ?? 0;
  const lesson = lessonCount > 0
    ? t.signalsLessonProgress(socio.currentLesson, lessonCount)
    : t.signalsLessonProgressNoTotal(socio.currentLesson);
  const course = decoration?.courseName ?? t.signalsNoCourse;
  return `${course} · ${lesson}`;
}

function NeedsYouNowCard({
  socio,
  decoration,
  t,
}: {
  socio: ZoneSocio;
  decoration: AlertSnapshotSocio | undefined;
  t: DashboardStrings;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-semibold text-gray-900">{socio.name ?? t.noName}</span>
          {decoration?.participantNoun && (
            <span className="ml-2 text-xs text-gray-500">{decoration.participantNoun}</span>
          )}
        </div>
        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800 tabular-nums">
          {t.signalsCount(socio.signalCount)}
        </span>
      </div>

      <p className="mt-1 text-sm text-gray-600">{courseLine(socio, decoration, t)}</p>

      {/* Severity comes from the health service, not re-derived here. */}
      <ul className="mt-3 space-y-1 text-sm text-gray-800">
        {socio.health.reasons.map((reason, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-red-500" aria-hidden="true">•</span>
            {formatHealthReason(reason, t)}
          </li>
        ))}
      </ul>

      {/* Free text from the flag pipeline — data, rendered verbatim. */}
      {socio.flagReasons.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-gray-500">
          {socio.flagReasons.slice(0, 3).map((reason, i) => (
            <li key={i} className="line-clamp-2">{reason}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <TakeOverButton socioId={socio.socioId} label={t.actionTakeOverChat} />
        <Link
          href={`/dashboard/learners/${socio.socioId}`}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {t.actionReadTranscript}
        </Link>
      </div>
    </div>
  );
}

function WatchingRow({
  socio,
  decoration,
  t,
}: {
  socio: ZoneSocio;
  decoration: AlertSnapshotSocio | undefined;
  t: DashboardStrings;
}) {
  // One line, not a list: zone 2 is a scan, not a briefing.
  const summary = socio.health.reasons.length > 0
    ? formatHealthReason(socio.health.reasons[0], t)
    : t.signalsCount(socio.signalCount);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <span className="font-medium text-gray-900">{socio.name ?? t.noName}</span>
        <span className="ml-2 text-sm text-gray-600">{summary}</span>
        <span className="ml-2 text-xs text-gray-400">{courseLine(socio, decoration, t)}</span>
      </div>
      <Link
        href={`/dashboard/learners/${socio.socioId}`}
        className="shrink-0 rounded-md border border-amber-300 px-3 py-1 text-sm font-medium text-amber-800 hover:bg-amber-50 transition-colors"
      >
        {t.actionStepIn}
      </Link>
    </li>
  );
}
