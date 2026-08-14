/**
 * invokeTraced — tracing must be invisible to the call site
 * ----------------------------------------------------------------------------
 * Every existing call site wraps its .invoke() in a try/catch that degrades
 * gracefully (defaults, prior state, fallback copy). The wrapper is only
 * allowed to observe: it returns the result untouched, re-throws the original
 * error object, and swallows its own write failures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

const mockPrisma = vi.hoisted(() => ({
  aiInvocation: {
    create: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

// Import AFTER mocking
import { invokeTraced, hashPrompt } from '../invokeTraced';

const SYSTEM_PROMPT = 'You are a grader. Output JSON only.';

const BASE = {
  operation: 'sensing' as const,
  model: 'anthropic/claude-haiku-4.5',
  promptVersion: { sensing: 'v1' },
  systemPrompt: SYSTEM_PROMPT,
};

function lastRow() {
  return mockPrisma.aiInvocation.create.mock.calls.at(-1)![0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.aiInvocation.create.mockResolvedValue({ id: 'trace-1' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  delete process.env.AI_TRACE;
});

afterEach(() => {
  delete process.env.AI_TRACE;
  vi.restoreAllMocks();
});

describe('invokeTraced — success path', () => {
  it('returns the invoke result unchanged', async () => {
    const result = { content: 'hello', extra: 42 };
    const returned = await invokeTraced({ ...BASE, invoke: async () => result });
    expect(returned).toBe(result);
  });

  it('writes one row marked success', async () => {
    await invokeTraced({ ...BASE, invoke: async () => ({ content: 'hello' }) });
    expect(mockPrisma.aiInvocation.create).toHaveBeenCalledTimes(1);
    expect(lastRow().success).toBe(true);
    expect(lastRow().errorMessage).toBeNull();
  });

  it('records operation, model, mode and prompt version', async () => {
    await invokeTraced({
      ...BASE,
      mode: 'RETEACH',
      invoke: async () => ({ content: 'hello' }),
    });
    const row = lastRow();
    expect(row.operation).toBe('sensing');
    expect(row.model).toBe('anthropic/claude-haiku-4.5');
    expect(row.mode).toBe('RETEACH');
    expect(row.promptVersion).toEqual({ sensing: 'v1' });
  });

  it('records structured context and provider finish reason', async () => {
    await invokeTraced({
      ...BASE,
      context: { surface: 'player', programVersionId: 'pv-1', intent: 'expand', parentIntent: 'question' },
      invoke: async () => ({ content: 'hello', response_metadata: { finish_reason: 'stop' } }),
    });
    expect(lastRow().context).toEqual({ surface: 'player', programVersionId: 'pv-1', intent: 'expand', parentIntent: 'question' });
    expect(lastRow().finishReason).toBe('stop');
  });

  it('keeps the unstyled MI lesson-delivery row on the legacy one-row shape', async () => {
    await invokeTraced({
      ...BASE,
      operation: 'lesson_delivery',
      mode: 'LESSON_DELIVERY',
      socioId: 'mi-socio',
      invoke: async () => ({ content: 'MI reply' }),
    });

    expect(mockPrisma.aiInvocation.create).toHaveBeenCalledTimes(1);
    const row = lastRow();
    expect(row.context).toBeUndefined();
    expect(Object.keys(row).sort()).toEqual([
      'assessmentSessionId',
      'context',
      'errorMessage',
      'finishReason',
      'latencyMs',
      'mode',
      'model',
      'operation',
      'organizationId',
      'promptHash',
      'promptText',
      'promptTokensApprox',
      'promptVersion',
      'responseLength',
      'socioId',
      'success',
      'ttftMs',
    ]);
  });

  it('reports an unknown finish reason as null', async () => {
    await invokeTraced({ ...BASE, invoke: async () => ({ content: 'hello' }) });
    expect(lastRow().finishReason).toBeNull();
  });

  it('nulls the optional identifiers when not supplied', async () => {
    await invokeTraced({ ...BASE, invoke: async () => ({ content: 'x' }) });
    const row = lastRow();
    expect(row.socioId).toBeNull();
    expect(row.organizationId).toBeNull();
    expect(row.assessmentSessionId).toBeNull();
    expect(row.mode).toBeNull();
  });

  it('records the identifiers it is given', async () => {
    await invokeTraced({
      ...BASE,
      socioId: 'socio-1',
      organizationId: 'org-1',
      assessmentSessionId: 'sess-1',
      invoke: async () => ({ content: 'x' }),
    });
    const row = lastRow();
    expect(row.socioId).toBe('socio-1');
    expect(row.organizationId).toBe('org-1');
    expect(row.assessmentSessionId).toBe('sess-1');
  });

  it('stores responseLength from string content', async () => {
    await invokeTraced({ ...BASE, invoke: async () => ({ content: 'abcde' }) });
    expect(lastRow().responseLength).toBe(5);
  });

  it('stringifies non-string content for responseLength', async () => {
    await invokeTraced({ ...BASE, invoke: async () => ({ content: [{ text: 'hi' }] }) });
    expect(lastRow().responseLength).toBe(JSON.stringify([{ text: 'hi' }]).length);
  });

  it('records a non-negative latency', async () => {
    await invokeTraced({ ...BASE, invoke: async () => ({ content: 'x' }) });
    expect(lastRow().latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('invokeTraced — prompt hashing and AI_TRACE', () => {
  it('hashes the system prompt with sha256', async () => {
    await invokeTraced({ ...BASE, invoke: async () => ({ content: 'x' }) });
    const expected = createHash('sha256').update(SYSTEM_PROMPT).digest('hex');
    expect(lastRow().promptHash).toBe(expected);
    expect(hashPrompt(SYSTEM_PROMPT)).toBe(expected);
  });

  it('leaves promptText null by default', async () => {
    await invokeTraced({ ...BASE, invoke: async () => ({ content: 'x' }) });
    expect(lastRow().promptText).toBeNull();
  });

  it('leaves promptText null for any AI_TRACE value other than "full"', async () => {
    process.env.AI_TRACE = 'on';
    await invokeTraced({ ...BASE, invoke: async () => ({ content: 'x' }) });
    expect(lastRow().promptText).toBeNull();
  });

  it('stores promptText when AI_TRACE=full', async () => {
    process.env.AI_TRACE = 'full';
    await invokeTraced({ ...BASE, invoke: async () => ({ content: 'x' }) });
    expect(lastRow().promptText).toBe(SYSTEM_PROMPT);
  });

  it('stores promptText on the failure row too when AI_TRACE=full', async () => {
    process.env.AI_TRACE = 'full';
    await expect(
      invokeTraced({ ...BASE, invoke: async () => { throw new Error('boom'); } }),
    ).rejects.toThrow('boom');
    expect(lastRow().promptText).toBe(SYSTEM_PROMPT);
  });
});

describe('invokeTraced — token estimate', () => {
  it('falls back to chars / 4 when the response carries no usage', async () => {
    await invokeTraced({ ...BASE, invoke: async () => ({ content: 'x' }) });
    expect(lastRow().promptTokensApprox).toBe(Math.ceil(SYSTEM_PROMPT.length / 4));
  });

  it('prefers a real prompt-token count from usage_metadata', async () => {
    await invokeTraced({
      ...BASE,
      invoke: async () => ({ content: 'x', usage_metadata: { input_tokens: 123 } }),
    });
    expect(lastRow().promptTokensApprox).toBe(123);
  });

  it('prefers a real prompt-token count from response_metadata.tokenUsage', async () => {
    await invokeTraced({
      ...BASE,
      invoke: async () => ({ content: 'x', response_metadata: { tokenUsage: { promptTokens: 77 } } }),
    });
    expect(lastRow().promptTokensApprox).toBe(77);
  });
});

describe('invokeTraced — failure path', () => {
  it('re-throws the original error object', async () => {
    const original = new Error('LLM exploded');
    let caught: unknown;
    try {
      await invokeTraced({ ...BASE, invoke: async () => { throw original; } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(original);
  });

  it('writes a failure row with the error message', async () => {
    await expect(
      invokeTraced({ ...BASE, invoke: async () => { throw new Error('Sensing timeout'); } }),
    ).rejects.toThrow('Sensing timeout');

    const row = lastRow();
    expect(row.success).toBe(false);
    expect(row.errorMessage).toBe('Sensing timeout');
    expect(row.responseLength).toBeNull();
  });

  it('stringifies a non-Error throw', async () => {
    await expect(
      invokeTraced({ ...BASE, invoke: async () => { throw 'plain string'; } }),
    ).rejects.toBe('plain string');
    expect(lastRow().errorMessage).toBe('plain string');
  });
});

describe('invokeTraced — trace writes never break the caller', () => {
  it('still returns the result when the trace write fails', async () => {
    mockPrisma.aiInvocation.create.mockRejectedValue(new Error('db down'));
    const result = { content: 'hello' };
    await expect(invokeTraced({ ...BASE, invoke: async () => result })).resolves.toBe(result);
  });

  it('still re-throws the original LLM error when the trace write fails', async () => {
    mockPrisma.aiInvocation.create.mockRejectedValue(new Error('db down'));
    const original = new Error('LLM exploded');
    await expect(
      invokeTraced({ ...BASE, invoke: async () => { throw original; } }),
    ).rejects.toBe(original);
  });
});
