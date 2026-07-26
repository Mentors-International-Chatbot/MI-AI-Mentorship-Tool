/**
 * Gate Detection Tests
 * Tests that gated teach-back blocks are correctly extracted and detected.
 */

import { describe, it, expect } from 'vitest';
import type { PackageLesson } from '@/lib/journey-package/journey-package.schema';

// Helper to transform a lesson (mirroring db-lesson-service logic for testing)
function extractGates(lesson: PackageLesson) {
  const sortedBlocks = [...lesson.blocks].sort((a, b) => a.order - b.order);

  type LessonGate = {
    blockId: string;
    blockOrder: number;
    afterMessageIndex: number;
    prompt: string;
    evaluatesConcepts: string[];
    dimensionKey: string;
  };

  const gates: LessonGate[] = [];
  for (const block of sortedBlocks) {
    if (
      block.blockType === 'teach_back' &&
      'delivery' in block &&
      block.delivery === 'gated_session'
    ) {
      // Count teach blocks before this gate
      const teachBlocksBefore = sortedBlocks.filter(
        (b) => b.blockType === 'teach' && b.order < block.order
      ).length;

      gates.push({
        blockId: block.id,
        blockOrder: block.order,
        afterMessageIndex: teachBlocksBefore - 1,
        prompt: block.prompt,
        evaluatesConcepts: block.evaluatesConcepts || [],
        dimensionKey: block.dimensionKey, // Required in schema
      });
    }
  }

  return gates;
}

describe('Gate Detection', () => {
  it('extracts gated teach-back blocks from PB&J lesson', () => {
    // Minimal PB&J lesson structure
    const pbjLesson: PackageLesson = {
      key: 'assemble-the-sandwich',
      title: 'Assembling the Sandwich',
      category: 'Food Prep',
      keyConcepts: ['Steps must happen in a working order'],
      selfCheckQuestions: [],
      blocks: [
        { id: 'b1', order: 1, blockType: 'teach', role: 'scenario', content: 'Scenario content' },
        { id: 'b2', order: 2, blockType: 'teach', role: 'explanation', content: 'Explanation' },
        { id: 'b3', order: 3, blockType: 'teach', role: 'example', content: 'Example' },
        { id: 'b4', order: 4, blockType: 'teach', role: 'question', content: 'Question' },
        {
          id: 'b5-teach-back',
          order: 5,
          blockType: 'teach_back',
          prompt: 'In your own words, walk me through the steps.',
          evaluatesConcepts: ['Steps must happen in order'],
          dimensionKey: 'sequencing',
          // No delivery field = inline (not gated)
        },
        {
          id: 'b8-gated-teach-back',
          order: 8,
          blockType: 'teach_back',
          prompt: 'Explain how to make a PB&J from scratch.',
          evaluatesConcepts: ['Steps in order', 'Spreading separately'],
          dimensionKey: 'sequencing',
          delivery: 'gated_session',
        },
      ],
      exercise: 'Make a sandwich',
      commitment: 'Share with someone',
    };

    const gates = extractGates(pbjLesson);

    expect(gates).toHaveLength(1);
    expect(gates[0].blockId).toBe('b8-gated-teach-back');
    expect(gates[0].blockOrder).toBe(8);
    // There are 4 teach blocks (b1-b4, orders 1-4) before the gate at order 8
    expect(gates[0].afterMessageIndex).toBe(3); // 0-indexed: after message 3
    expect(gates[0].dimensionKey).toBe('sequencing');
    expect(gates[0].evaluatesConcepts).toHaveLength(2);
  });

  it('returns empty array when no gated blocks exist', () => {
    const lessonWithoutGates: PackageLesson = {
      key: 'simple-lesson',
      title: 'Simple Lesson',
      keyConcepts: [],
      selfCheckQuestions: [],
      blocks: [
        { id: 'b1', order: 1, blockType: 'teach', role: 'scenario', content: 'Content' },
        { id: 'b2', order: 2, blockType: 'teach', role: 'explanation', content: 'Content' },
        {
          id: 'b3-inline',
          order: 3,
          blockType: 'teach_back',
          prompt: 'Inline teach-back',
          evaluatesConcepts: [],
          dimensionKey: 'comprehension',
          // No delivery = inline
        },
      ],
    };

    const gates = extractGates(lessonWithoutGates);
    expect(gates).toHaveLength(0);
  });

  it('correctly calculates afterMessageIndex with multiple gates', () => {
    const lessonWithMultipleGates: PackageLesson = {
      key: 'multi-gate-lesson',
      title: 'Lesson with Multiple Gates',
      keyConcepts: [],
      selfCheckQuestions: [],
      blocks: [
        { id: 'b1', order: 1, blockType: 'teach', role: 'scenario', content: 'C1' },
        { id: 'b2', order: 2, blockType: 'teach', role: 'explanation', content: 'C2' },
        {
          id: 'gate-1',
          order: 3,
          blockType: 'teach_back',
          prompt: 'First gate',
          evaluatesConcepts: [],
          dimensionKey: 'comprehension',
          delivery: 'gated_session',
        },
        { id: 'b3', order: 4, blockType: 'teach', role: 'example', content: 'C3' },
        { id: 'b4', order: 5, blockType: 'teach', role: 'question', content: 'C4' },
        {
          id: 'gate-2',
          order: 6,
          blockType: 'teach_back',
          prompt: 'Second gate',
          evaluatesConcepts: [],
          dimensionKey: 'sequencing',
          delivery: 'gated_session',
        },
      ],
    };

    const gates = extractGates(lessonWithMultipleGates);

    expect(gates).toHaveLength(2);

    // First gate: 2 teach blocks before (b1, b2)
    expect(gates[0].blockId).toBe('gate-1');
    expect(gates[0].afterMessageIndex).toBe(1); // After message index 1 (messages 0, 1 = 2 messages)

    // Second gate: 4 teach blocks before (b1, b2, b3, b4)
    expect(gates[1].blockId).toBe('gate-2');
    expect(gates[1].afterMessageIndex).toBe(3); // After message index 3 (messages 0-3 = 4 messages)
  });

  it('handles gate at beginning of lesson (no teach blocks before)', () => {
    const lessonWithEarlyGate: PackageLesson = {
      key: 'early-gate-lesson',
      title: 'Lesson with Early Gate',
      keyConcepts: [],
      selfCheckQuestions: [],
      blocks: [
        {
          id: 'gate-1',
          order: 1,
          blockType: 'teach_back',
          prompt: 'Gate at start',
          evaluatesConcepts: [],
          dimensionKey: 'comprehension',
          delivery: 'gated_session',
        },
        { id: 'b1', order: 2, blockType: 'teach', role: 'scenario', content: 'C1' },
      ],
    };

    const gates = extractGates(lessonWithEarlyGate);

    expect(gates).toHaveLength(1);
    expect(gates[0].blockId).toBe('gate-1');
    // No teach blocks before, so afterMessageIndex = -1 (activates at index 0)
    expect(gates[0].afterMessageIndex).toBe(-1);
  });
});
