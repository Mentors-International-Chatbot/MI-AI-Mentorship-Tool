'use client';

import { useDashboardLang } from '../../DashboardLangContext';

type SerializedLessonProgress = {
  id: string;
  lessonNumber: number;
  understanding: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function LessonProgressPanel({
  lessonProgress,
  lessonCount,
}: {
  lessonProgress: SerializedLessonProgress[];
  /** Lessons in this course. Comes from the course's collection, not a constant. */
  lessonCount: number;
}) {
  const { t } = useDashboardLang();
  const progressMap = new Map(lessonProgress.map(lp => [lp.lessonNumber, lp]));

  // lessonCount === 0 is ambiguous: the course genuinely has no lessons, or the
  // collection lookup failed (unresolved tenant, missing collection). Recorded
  // progress disambiguates — if the socio has worked lessons, the course has
  // them. Fall back to the highest lesson touched so a resolution hiccup shows
  // a slightly-short grid rather than blanking the panel mid-conversation.
  const gridLength =
    lessonCount > 0
      ? lessonCount
      : lessonProgress.reduce((max, lp) => Math.max(max, lp.lessonNumber), 0);

  if (gridLength === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-gray-900 mb-3">{t.lessonProgressTitle}</h3>
        <p className="text-sm text-gray-400">{t.lessonProgressEmpty}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold text-gray-900 mb-3">{t.lessonProgressTitle}</h3>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: gridLength }, (_, i) => {
          const num = i + 1;
          const lp = progressMap.get(num);
          const completed = lp?.completedAt != null;
          const inProgress = lp != null && !completed;

          let dotColor = 'bg-gray-200';
          let title = `${num}: ${t.lessonPending}`;

          if (completed) {
            dotColor = 'bg-green-500';
            title = `${num}: ${t.lessonCompleted}`;
            if (lp.understanding != null) {
              title += ` (${lp.understanding}/10)`;
            }
          } else if (inProgress) {
            dotColor = 'bg-[#2DD4BF]';
            title = `${num}: ${t.lessonInProgress}`;
          }

          return (
            <div key={num} className="flex flex-col items-center" title={title}>
              <span className={`w-6 h-6 rounded-full ${dotColor} flex items-center justify-center text-xs font-medium ${completed ? 'text-white' : inProgress ? 'text-white' : 'text-gray-500'}`}>
                {num}
              </span>
              {completed && lp.understanding != null && (
                <span className="text-xs text-gray-500 mt-0.5">{lp.understanding}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
