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

const TOTAL_LESSONS = 28;

export function LessonProgressPanel({ lessonProgress }: { lessonProgress: SerializedLessonProgress[] }) {
  const { t } = useDashboardLang();
  const progressMap = new Map(lessonProgress.map(lp => [lp.lessonNumber, lp]));

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold text-gray-900 mb-3">{t.lessonProgressTitle}</h3>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: TOTAL_LESSONS }, (_, i) => {
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
