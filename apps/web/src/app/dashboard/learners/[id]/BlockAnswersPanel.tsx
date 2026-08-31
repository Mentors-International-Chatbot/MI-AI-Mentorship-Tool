'use client';

import { useDashboardLang } from '../../DashboardLangContext';
import type { AnsweredBlock } from './blockAnswers';

const BLOCK_TYPE_LABEL_KEY = {
  quiz_checkpoint: 'blockAnswersQuizLabel',
  drag_order: 'blockAnswersDragOrderLabel',
  onboarding_survey: 'blockAnswersSurveyLabel',
} as const;

export function BlockAnswersPanel({ blocks }: { blocks: AnsweredBlock[] }) {
  const { t } = useDashboardLang();

  if (blocks.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold text-gray-900 mb-3">{t.blockAnswersTitle}</h3>
      <div className="space-y-4">
        {blocks.map((block) => (
          <div key={`${block.lessonKey}:${block.blockId}`} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
              {t[BLOCK_TYPE_LABEL_KEY[block.blockType]]} · {block.lessonKey}
            </p>
            <ul className="space-y-1.5">
              {block.items.map((item, index) => (
                <li key={index} className="text-sm">
                  <p className="text-gray-900">{item.prompt}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-gray-500">{item.answer}</p>
                    {item.correct !== undefined && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                          item.correct ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {item.correct ? t.blockAnswersCorrect : t.blockAnswersIncorrect}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
