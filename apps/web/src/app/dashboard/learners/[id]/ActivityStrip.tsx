'use client';

import { useDashboardLang } from '../../DashboardLangContext';
import type { LessonActivity } from './blockActivity';

export function ActivityStrip({ lessons }: { lessons: LessonActivity[] }) {
  const { lang, t } = useDashboardLang();

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const locale = lang === 'pt' ? 'pt-BR' : lang === 'en' ? 'en-US' : 'es-CO';
    return d.toLocaleString(locale, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold text-gray-900 mb-3">{t.activityStripTitle}</h3>
      <div className="space-y-2">
        {lessons.map((lesson) => (
          <div key={lesson.lessonKey} className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-900">{lesson.lessonKey}</span>
            <span className="text-gray-500">
              {lesson.total != null
                ? t.activityStripBlocksCompleted(lesson.completed, lesson.total)
                : t.activityStripBlocksCompletedNoTotal(lesson.completed)}
              {' · '}
              {t.activityStripLastActive(formatTime(lesson.lastActivityAt))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
