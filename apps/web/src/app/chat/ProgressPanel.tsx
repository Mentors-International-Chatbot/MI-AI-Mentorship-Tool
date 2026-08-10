'use client';

/**
 * The learner's position, on screen
 * ═══════════════════════════════════════════════════════════════════════════
 * Sidebar on wide viewports, collapsible strip in the header on narrow ones.
 * Same component and same data for both — only the chrome differs, so the two
 * cannot drift.
 *
 * Every label comes from PROGRESS_STRINGS; every value comes from the learner's
 * own course. The project section is omitted entirely when the course declares
 * no outcome, rather than rendered empty: a heading with nothing under it reads
 * as something broken rather than something absent.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { useState } from 'react';
import { PROGRESS_STRINGS, type SupportedLanguage } from '@/lib/i18n/languages';
import type { ChatProgress, GateStatus } from '@/lib/chat/progress';

function GateChip({ status, language }: { status: GateStatus; language: SupportedLanguage }) {
  const t = PROGRESS_STRINGS[language] ?? PROGRESS_STRINGS['en'];

  const label =
    status === 'passed' ? t.gatePassed
    : status === 'not_passed' ? t.gateNotPassed
    : t.gateNotReached;

  // Not-passed is deliberately amber rather than red. The learner can retake,
  // and a red badge on their own progress panel reads as a verdict.
  const tone =
    status === 'passed'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
      : status === 'not_passed'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

export function ProgressContent({
  progress,
  language,
}: {
  progress: ChatProgress;
  language: SupportedLanguage;
}) {
  const t = PROGRESS_STRINGS[language] ?? PROGRESS_STRINGS['en'];
  const { lesson, position, gate, project } = progress;

  const pct = lesson.total > 0
    ? Math.min(100, Math.round((lesson.current / lesson.total) * 100))
    : 0;

  return (
    <div className="space-y-5 text-sm">
      <section>
        {progress.courseName && (
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 truncate mb-1">
            {progress.courseName}
          </p>
        )}
        <p className="text-zinc-900 dark:text-zinc-100 font-medium">
          {t.lessonOf(lesson.current, lesson.total)}
        </p>

        <div
          className="mt-2 h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden"
          role="progressbar"
          aria-valuenow={lesson.current}
          aria-valuemin={0}
          aria-valuemax={lesson.total}
          aria-label={t.lessonOf(lesson.current, lesson.total)}
        >
          <div
            className="h-full rounded-full bg-emerald-600 transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        {position && (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t.partOf(position.part, position.total)}
          </p>
        )}
      </section>

      {gate && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1.5">
            {t.gateHeading}
          </h3>
          <GateChip status={gate} language={language} />
        </section>
      )}

      {project && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1.5">
            {t.projectHeading}
          </h3>
          <p className="text-zinc-800 dark:text-zinc-200 mb-2">{project.title}</p>
          <ul className="space-y-1.5">
            {project.milestones.map((m) => (
              <li key={m.key} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    m.done ? 'bg-emerald-600' : 'bg-zinc-300 dark:bg-zinc-700'
                  }`}
                />
                <span
                  className={`text-xs leading-snug ${
                    m.done
                      ? 'text-zinc-500 dark:text-zinc-400 line-through'
                      : 'text-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  {m.name}
                  <span className="sr-only">
                    {' '}
                    — {m.done ? t.milestoneDone : t.milestonePending}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Wide viewports: a persistent column beside the conversation. */
export function ProgressSidebar({
  progress,
  language,
}: {
  progress: ChatProgress | null;
  language: SupportedLanguage;
}) {
  if (!progress) return null;
  const t = PROGRESS_STRINGS[language] ?? PROGRESS_STRINGS['en'];

  return (
    <aside className="hidden lg:flex w-72 shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800 px-5 py-6 overflow-y-auto">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-4">
        {t.heading}
      </h2>
      <ProgressContent progress={progress} language={language} />
    </aside>
  );
}

/** Narrow viewports: a disclosure under the header, collapsed by default. */
export function ProgressStrip({
  progress,
  language,
}: {
  progress: ChatProgress | null;
  language: SupportedLanguage;
}) {
  const [open, setOpen] = useState(false);
  if (!progress) return null;

  const t = PROGRESS_STRINGS[language] ?? PROGRESS_STRINGS['en'];
  const { lesson } = progress;
  const pct = lesson.total > 0
    ? Math.min(100, Math.round((lesson.current / lesson.total) * 100))
    : 0;

  return (
    <div className="lg:hidden border-b border-zinc-200 dark:border-zinc-800 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t.toggleLabel}
        className="w-full flex items-center gap-3 px-4 py-2 text-left"
      >
        <span className="text-xs text-zinc-600 dark:text-zinc-300 shrink-0">
          {t.lessonOf(lesson.current, lesson.total)}
        </span>
        <span className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <span
            className="block h-full rounded-full bg-emerald-600 transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </span>
        <span aria-hidden="true" className="text-zinc-400 text-xs">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          <ProgressContent progress={progress} language={language} />
        </div>
      )}
    </div>
  );
}
