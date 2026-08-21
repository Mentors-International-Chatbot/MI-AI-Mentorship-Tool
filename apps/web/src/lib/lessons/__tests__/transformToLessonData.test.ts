/**
 * transformToLessonData — MI2024 transform-invariant guard
 * ----------------------------------------------------------------------------
 * MI2024 is the frozen chat surface. Platform Restructure Phase A, Stage 1
 * changes enrollment creation only — nothing in this file, and nothing about
 * `teach`/`teach_back` block handling, should be touched by it. This pins the
 * exact transform output for a lesson shaped like a real MI2024 lesson
 * (numbered key, teach blocks covering every role, one gated teach_back) so
 * any accidental change to this pure function's output is caught immediately.
 */
import { describe, it, expect } from 'vitest';
import { transformToLessonData } from '../db-lesson-service';
import type { PackageLesson } from '@/lib/journey-package/journey-package.schema';

const MI2024_SHAPED_LESSON: PackageLesson = {
  key: 'lesson-01',
  title: 'Bienvenida al negocio',
  category: 'fundamentos',
  keyConcepts: ['margen', 'costo fijo'],
  selfCheckQuestions: ['¿Qué es un costo fijo?'],
  exercise: 'Calcula tu margen actual',
  commitment: 'Registrar tus ventas de la semana',
  blocks: [
    { id: 'b1-scenario', order: 1, blockType: 'teach', role: 'scenario', content: 'Imagina que...' },
    { id: 'b2-explanation', order: 2, blockType: 'teach', role: 'explanation', content: 'El margen es...' },
    { id: 'b3-example', order: 3, blockType: 'teach', role: 'example', content: 'Por ejemplo...' },
    { id: 'b4-question', order: 4, blockType: 'teach', role: 'question', content: '¿Qué harías tú?' },
    { id: 'b5-deepening', order: 5, blockType: 'teach', role: 'deepening', content: 'Profundicemos...' },
    {
      id: 'b6-gated-teach-back',
      order: 6,
      blockType: 'teach_back',
      prompt: 'Explícame con tus palabras qué es el margen',
      evaluatesConcepts: ['margen'],
      dimensionKey: 'comprehension',
      delivery: 'gated_session',
      passingOverride: { threshold: 0.7, minTurns: 2 },
    },
  ],
};

describe('transformToLessonData — MI2024 shape (frozen surface)', () => {
  it('produces the exact same output shape it always has', () => {
    const result = transformToLessonData(MI2024_SHAPED_LESSON, 0);

    expect(result).toEqual({
      lessonNumber: 1,
      lessonKey: 'lesson-01',
      titleEs: 'Bienvenida al negocio',
      category: 'fundamentos',
      keyConcepts: ['margen', 'costo fijo'],
      selfCheckQuestions: ['¿Qué es un costo fijo?'],
      exercise: 'Calcula tu margen actual',
      commitment: 'Registrar tus ventas de la semana',
      messages: [
        { order: 1, type: 'escenario', contentEs: 'Imagina que...' },
        { order: 2, type: 'explicación', contentEs: 'El margen es...' },
        { order: 3, type: 'ejemplo', contentEs: 'Por ejemplo...' },
        { order: 4, type: 'pregunta', contentEs: '¿Qué harías tú?' },
        { order: 5, type: 'profundización', contentEs: 'Profundicemos...' },
      ],
      gates: [
        {
          blockId: 'b6-gated-teach-back',
          blockOrder: 6,
          afterMessageIndex: 4,
          prompt: 'Explícame con tus palabras qué es el margen',
          evaluatesConcepts: ['margen'],
          dimensionKey: 'comprehension',
          passingOverride: { threshold: 0.7, minTurns: 2 },
        },
      ],
    });
  });

  it('derives lessonNumber from a non-numbered key using the order index fallback', () => {
    const result = transformToLessonData({ ...MI2024_SHAPED_LESSON, key: 'assemble-the-sandwich' }, 2);
    expect(result.lessonNumber).toBe(3);
    expect(result.lessonKey).toBe('assemble-the-sandwich');
  });
});
