/**
 * Marker parsing
 * ═══════════════════════════════════════════════════════════════════════════
 * Markers are the AI's only channel for writing structured facts back into the
 * system, and every one of them is stripped before the learner sees the reply.
 * Two failure modes matter and neither is loud: a marker that fails to parse
 * silently loses the fact, and a marker that fails to strip leaks bracket
 * syntax into a WhatsApp message.
 *
 * `[MILESTONE:key]` is the newest and the only one carrying a signal that the
 * learner DID something rather than was taught it, so its key regex is
 * deliberately narrow — a hallucinated free-text key must not become a row.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { parseMarkers } from '../markers';

describe('parseMarkers', () => {
  it('returns empty collections for text with no markers', () => {
    const r = parseMarkers('Just a normal reply.');
    expect(r).toEqual({
      cleanText: 'Just a normal reply.',
      flags: [],
      lessonsCompleted: [],
      escalations: [],
      financials: [],
      milestones: [],
    });
  });

  it('extracts a milestone and strips it from the delivered text', () => {
    const r = parseMarkers('Great work! [MILESTONE:assemble-the-sandwich]');
    expect(r.milestones).toEqual(['assemble-the-sandwich']);
    expect(r.cleanText).toBe('Great work!');
  });

  it('extracts several milestones from one reply', () => {
    const r = parseMarkers('[MILESTONE:one] and [MILESTONE:two-b] done');
    expect(r.milestones).toEqual(['one', 'two-b']);
  });

  it('ignores a key the package regex would never produce', () => {
    // The key comes out of model output. Anything that is not
    // lowercase/digits/hyphens is a hallucination, and creating a progress row
    // for it would put a key in the table that no course defines.
    const r = parseMarkers(
      '[MILESTONE:Made The Sandwich] [MILESTONE:UPPER] [MILESTONE:] [MILESTONE:-leading]',
    );
    expect(r.milestones).toEqual([]);
  });

  it('does not confuse a milestone with the other markers', () => {
    const r = parseMarkers(
      'Nice. [LESSON_COMPLETE:3] [MILESTONE:delivered] [FLAG:YELLOW|unsure] ' +
        '[FINANCIAL:revenue=100,netProfit=20] [ESCALATE|needs a human]',
    );
    expect(r.milestones).toEqual(['delivered']);
    expect(r.lessonsCompleted).toEqual([3]);
    expect(r.flags).toEqual([{ level: 'YELLOW', reason: 'unsure' }]);
    expect(r.financials).toEqual([{ revenue: 100, netProfit: 20 }]);
    expect(r.escalations).toEqual(['needs a human']);
    expect(r.cleanText).toBe('Nice.');
  });

  it('leaves no bracket syntax in the text sent to the learner', () => {
    const r = parseMarkers('Done! [MILESTONE:x] [LESSON_COMPLETE:1] Keep going.');
    expect(r.cleanText).not.toMatch(/[[\]]/);
  });
});
