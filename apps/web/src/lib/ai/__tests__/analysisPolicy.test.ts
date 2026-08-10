/**
 * Analysis policy — what a turn is worth spending on
 * ═══════════════════════════════════════════════════════════════════════════
 * Three LLM passes hang off a conversational turn besides the reply. Before
 * this policy, sensing had a triviality gate and the other two had nothing, so
 * "ok" cost a sentiment call and a context-extraction call that between them
 * could only ever return "neutral" and "{}".
 *
 * The cases below are the ones that motivated the module, written as the input
 * that used to be expensive rather than as a walk of the table.
 */
import { describe, it, expect } from 'vitest';
import { InteractionMode } from '@/lib/ai/prompts/types';
import { resolveAnalysisPolicy } from '../analysisPolicy';

const substantive = 'I raised my prices last week and three regular customers stopped coming';

describe('resolveAnalysisPolicy', () => {
  it('spends nothing on an acknowledgment, whatever the mode', () => {
    for (const message of ['ok', 'listo', 'sí', 'siguiente', 'obrigado']) {
      expect(
        resolveAnalysisPolicy({ mode: InteractionMode.LESSON_DELIVERY, message }),
        message,
      ).toEqual({ sensing: false, sentiment: false, contextExtraction: false });
    }
  });

  it('spends everything on a substantive freeform turn', () => {
    expect(
      resolveAnalysisPolicy({ mode: InteractionMode.FREEFORM_QUESTION, message: substantive }),
    ).toEqual({ sensing: true, sentiment: true, contextExtraction: true });
  });

  it('spends nothing on LESSON_START, where the AI is the one talking', () => {
    // The learner's message advanced a lesson; the reply is curriculum. There
    // is no comprehension signal in "empezar" and no business fact either.
    expect(
      resolveAnalysisPolicy({ mode: InteractionMode.LESSON_START, message: substantive }),
    ).toEqual({ sensing: false, sentiment: false, contextExtraction: false });
  });

  it('spends nothing on a reminder nudge', () => {
    expect(
      resolveAnalysisPolicy({ mode: InteractionMode.REMINDER, message: substantive }),
    ).toEqual({ sensing: false, sentiment: false, contextExtraction: false });
  });

  it('senses and scores a reteach but does not mine it for facts', () => {
    // Someone who did not understand is restating the lesson, not describing
    // their business — but their frustration is exactly what we want to catch.
    expect(
      resolveAnalysisPolicy({ mode: InteractionMode.RETEACH, message: substantive }),
    ).toEqual({ sensing: true, sentiment: true, contextExtraction: false });
  });

  it('leaves the assessment path to run its own sensing', () => {
    // ai/assessment/ senses with TrivialityMode 'assessment', where a terse
    // answer is the thing being graded. Chat-path sensing would double-score it
    // against the wrong rule.
    expect(
      resolveAnalysisPolicy({ mode: InteractionMode.GATED_ASSESSMENT, message: substantive }),
    ).toEqual({ sensing: false, sentiment: false, contextExtraction: false });
  });

  it('still catches distress in a substantive lesson-delivery turn', () => {
    // The regression that would matter most: gating must not stop a socio in
    // trouble from being flagged mid-lesson.
    const p = resolveAnalysisPolicy({
      mode: InteractionMode.LESSON_DELIVERY,
      message: 'no entiendo nada de esto y ya quiero renunciar, estoy perdiendo dinero',
    });
    expect(p.sentiment).toBe(true);
    expect(p.sensing).toBe(true);
  });
});
