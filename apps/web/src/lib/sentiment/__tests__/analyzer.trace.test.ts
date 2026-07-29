/**
 * analyzeSentiment — failure behavior is unchanged by tracing
 * ----------------------------------------------------------------------------
 * This is the least obvious failure path of the five traced call sites: it
 * swallows the LLM error and returns DEFAULT_RESULT rather than propagating.
 * The trace wrapper re-throws into that same catch, so the contract holds — and
 * a trace row is written either way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  aiInvocation: { create: vi.fn() },
}));
const mockChat = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/ai/prompts/loadPrompt', () => ({
  loadActivePrompt: vi.fn(async (_category: string, fallback: string) => fallback),
}));
vi.mock('@/lib/ai/openrouter', () => ({
  createOpenRouterChat: vi.fn(() => mockChat),
  resolveOpenRouterModel: vi.fn(() => 'anthropic/claude-haiku-4.5'),
}));

// Import AFTER mocking
import { analyzeSentiment } from '../analyzer';

const DEFAULT_RESULT = {
  confusion: 0,
  frustration: 0,
  urgency: 0,
  sentiment: 'neutral',
  topics: ['other'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.aiInvocation.create.mockResolvedValue({ id: 'trace-1' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('analyzeSentiment with tracing', () => {
  it('returns the defaults when the LLM call throws', async () => {
    mockChat.invoke.mockRejectedValue(new Error('upstream 502'));
    await expect(analyzeSentiment('estoy perdido')).resolves.toEqual(DEFAULT_RESULT);
  });

  it('writes a failure trace row for that same call', async () => {
    mockChat.invoke.mockRejectedValue(new Error('upstream 502'));
    await analyzeSentiment('estoy perdido');

    const row = mockPrisma.aiInvocation.create.mock.calls.at(-1)![0].data;
    expect(row.operation).toBe('sentiment');
    expect(row.success).toBe(false);
    expect(row.errorMessage).toBe('upstream 502');
  });

  it('still returns the defaults when both the LLM and the trace write fail', async () => {
    mockChat.invoke.mockRejectedValue(new Error('upstream 502'));
    mockPrisma.aiInvocation.create.mockRejectedValue(new Error('db down'));
    await expect(analyzeSentiment('estoy perdido')).resolves.toEqual(DEFAULT_RESULT);
  });

  it('returns the defaults on unparseable output, as before', async () => {
    mockChat.invoke.mockResolvedValue({ content: 'not json at all' });
    await expect(analyzeSentiment('hola')).resolves.toEqual(DEFAULT_RESULT);
  });

  it('parses a valid response and traces it as a success', async () => {
    mockChat.invoke.mockResolvedValue({
      content: '{"confusion": 7, "frustration": 3, "urgency": 1, "sentiment": "negative", "topics": ["learning"]}',
    });

    const result = await analyzeSentiment('no entiendo nada', 'socio-1');
    expect(result).toEqual({
      confusion: 7,
      frustration: 3,
      urgency: 1,
      sentiment: 'negative',
      topics: ['learning'],
    });

    const row = mockPrisma.aiInvocation.create.mock.calls.at(-1)![0].data;
    expect(row.success).toBe(true);
    expect(row.socioId).toBe('socio-1');
    expect(row.promptVersion).toEqual({ sentiment: 'v1' });
  });
});
