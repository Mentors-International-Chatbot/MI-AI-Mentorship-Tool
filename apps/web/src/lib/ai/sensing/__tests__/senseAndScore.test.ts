/**
 * The merged analysis pass
 * ═══════════════════════════════════════════════════════════════════════════
 * Comprehension and emotion used to be two Haiku calls about the same
 * sentence, with `confusion` scored twice and no guarantee the two answers
 * agreed. This is one call returning both.
 *
 * The risk merging introduces is shared fate: one malformed response taking
 * out both signals where previously each had its own call. So the halves are
 * parsed independently, and that independence is what most of this file pins.
 *
 * Replaces `sentiment/__tests__/analyzer.trace.test.ts`, whose guarantees
 * (defaults on failure, a trace row either way, survival of a failed trace
 * write) are carried over rather than dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({ aiInvocation: { create: vi.fn() } }));
const mockChat = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/ai/prompts/loadPrompt', () => ({
  loadActivePrompt: vi.fn(async (_category: string, fallback: string) => fallback),
}));
vi.mock('@/lib/ai/openrouter', () => ({
  createOpenRouterChat: vi.fn(() => mockChat),
  resolveOpenRouterModel: vi.fn(() => 'anthropic/claude-haiku-4.5'),
}));

import { senseAndScore } from '../senseAndScore';

const SUBSTANTIVE = 'I raised my prices and three regular customers stopped coming';

const base = { incomingText: SUBSTANTIVE, priorState: {}, lessonContext: 'Pricing' };

function goodResponse() {
  return {
    content: JSON.stringify({
      dimensions: [
        { dimensionKey: 'comprehension', level: 6, confidence: 0.8, evidence: 'raised prices' },
        { dimensionKey: 'confusion', level: 3, confidence: 0.7, evidence: 'clear account' },
      ],
      sentiment: { confusion: 3, frustration: 6, urgency: 2, sentiment: 'negative', topics: ['finances'] },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.aiInvocation.create.mockResolvedValue({ id: 'trace-1' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('senseAndScore', () => {
  it('returns both signals from a single call', async () => {
    mockChat.invoke.mockResolvedValue(goodResponse());

    const r = await senseAndScore({ ...base, socioId: 'socio-1' });

    expect(mockChat.invoke).toHaveBeenCalledTimes(1);
    expect(r.dimensions).toHaveLength(2);
    expect(r.sentiment).toEqual({
      confusion: 3, frustration: 6, urgency: 2, sentiment: 'negative', topics: ['finances'],
    });
  });

  it('makes no call at all for a bare acknowledgement', async () => {
    const r = await senseAndScore({ ...base, incomingText: 'ok' });

    expect(mockChat.invoke).not.toHaveBeenCalled();
    expect(r.skipped).toBe(true);
    expect(r.dimensions).toEqual([]);
    expect(r.sentiment).toBeNull();
  });

  describe('the halves fail independently', () => {
    it('keeps the dimensions when the sentiment half is missing', async () => {
      mockChat.invoke.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [{ dimensionKey: 'comprehension', level: 7, confidence: 0.9, evidence: 'x' }],
        }),
      });

      const r = await senseAndScore(base);

      expect(r.dimensions).toHaveLength(1);
      expect(r.sentiment).toBeNull();
    });

    it('keeps the sentiment when the dimensions half is missing', async () => {
      // A distressed learner must still be flagged even if the EMA half was
      // unreadable — that is the signal with a person waiting behind it.
      mockChat.invoke.mockResolvedValue({
        content: JSON.stringify({
          sentiment: { confusion: 9, frustration: 9, urgency: 9, sentiment: 'distressed', topics: ['personal'] },
        }),
      });

      const r = await senseAndScore(base);

      expect(r.dimensions).toEqual([]);
      expect(r.sentiment?.sentiment).toBe('distressed');
    });
  });

  it('returns no dimensions rather than neutral ones on unparseable output', async () => {
    // Feeding 5/10 into the EMA would drag real state toward the middle — the
    // same dilution the triviality gate exists to prevent.
    mockChat.invoke.mockResolvedValue({ content: 'not json at all' });

    const r = await senseAndScore(base);

    expect(r.dimensions).toEqual([]);
    expect(r.sentiment).toBeNull();
  });

  it('swallows an upstream failure instead of blocking the reply', async () => {
    mockChat.invoke.mockRejectedValue(new Error('upstream 502'));

    await expect(senseAndScore(base)).resolves.toEqual({
      dimensions: [], sentiment: null, skipped: false,
    });
  });

  it('writes a failure trace row for that same call', async () => {
    mockChat.invoke.mockRejectedValue(new Error('upstream 502'));
    await senseAndScore(base);

    const row = mockPrisma.aiInvocation.create.mock.calls.at(-1)![0].data;
    expect(row.operation).toBe('sensing');
    expect(row.success).toBe(false);
    expect(row.errorMessage).toBe('upstream 502');
  });

  it('survives the trace write failing on top of the LLM failing', async () => {
    mockChat.invoke.mockRejectedValue(new Error('upstream 502'));
    mockPrisma.aiInvocation.create.mockRejectedValue(new Error('db down'));

    await expect(senseAndScore(base)).resolves.toEqual({
      dimensions: [], sentiment: null, skipped: false,
    });
  });

  it('traces a success against the socio', async () => {
    mockChat.invoke.mockResolvedValue(goodResponse());
    await senseAndScore({ ...base, socioId: 'socio-1' });

    const row = mockPrisma.aiInvocation.create.mock.calls.at(-1)![0].data;
    expect(row.success).toBe(true);
    expect(row.socioId).toBe('socio-1');
  });

  it('clamps values a model puts out of range', async () => {
    mockChat.invoke.mockResolvedValue({
      content: JSON.stringify({
        dimensions: [{ dimensionKey: 'comprehension', level: 99, confidence: 5, evidence: 'x' }],
        sentiment: { confusion: -4, frustration: 42, urgency: 3, sentiment: 'elated', topics: [] },
      }),
    });

    const r = await senseAndScore(base);

    expect(r.dimensions[0].level).toBe(10);
    expect(r.dimensions[0].confidence).toBe(1);
    expect(r.sentiment?.confusion).toBe(0);
    expect(r.sentiment?.frustration).toBe(10);
    // An unrecognised mood falls back rather than reaching the flag thresholds.
    expect(r.sentiment?.sentiment).toBe('neutral');
  });

  it('ignores dimension keys the system does not track', async () => {
    mockChat.invoke.mockResolvedValue({
      content: JSON.stringify({
        dimensions: [
          { dimensionKey: 'vibes', level: 8, confidence: 0.9, evidence: 'x' },
          { dimensionKey: 'comprehension', level: 6, confidence: 0.8, evidence: 'y' },
        ],
        sentiment: { confusion: 1, frustration: 1, urgency: 1, sentiment: 'neutral', topics: ['learning'] },
      }),
    });

    const r = await senseAndScore(base);

    expect(r.dimensions.map((d) => d.dimensionKey)).toEqual(['comprehension']);
  });
});
