/**
 * The turn that follows a resolved gate
 * ═══════════════════════════════════════════════════════════════════════════
 * Two things have to hold, and they pull against each other:
 *
 *   the AI speaks without being asked   — the whole point
 *   it speaks at most once              — two turns back to back is worse than
 *                                         one arriving late
 *
 * The guard is a fact, not a lock: "has anything been said to this learner
 * since the gate resolved". That covers a retry (our own message moved the
 * timestamp) and the learner typing at the same moment (their reply moved it),
 * without a flag anyone has to remember to clear.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = vi.hoisted(() => ({
  getSocioById: vi.fn(),
  getLastAssistantMessageAt: vi.fn(),
}));

const mockHandle = vi.hoisted(() => vi.fn());

vi.mock('@/lib/repo', () => ({ repo: mockRepo }));
vi.mock('../handler', () => ({ handleIncomingMessage: mockHandle }));

import { runGateResolvedFollowUp } from '../gateFollowUp';

const RESOLVED_AT = new Date('2026-08-09T10:05:00.000Z');

function socio(over: Record<string, unknown> = {}) {
  return {
    id: 'socio-1',
    channelType: 'web',
    externalId: 'ext-1',
    language: 'es',
    status: 'ACTIVE',
    aiPaused: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.getSocioById.mockResolvedValue(socio());
  mockHandle.mockResolvedValue({ responseText: 'Bien hecho.', suppressed: false });
});

describe('runGateResolvedFollowUp', () => {
  it('starts a turn nobody asked for, keyed to the session', async () => {
    const posted = await runGateResolvedFollowUp({
      socioId: 'socio-1', sessionId: 'sess-1', passed: true, resolvedAt: RESOLVED_AT,
    });

    expect(posted).toBe(true);
    const arg = mockHandle.mock.calls[0][0];
    expect(arg.systemInitiated).toEqual({
      kind: 'gate_resolved',
      sessionId: 'sess-1',
      suppressIfAssistantSpokeAfter: RESOLVED_AT,
    });
  });

  it('tells the model to congratulate a pass', async () => {
    await runGateResolvedFollowUp({
      socioId: 'socio-1', sessionId: 'sess-1', passed: true, resolvedAt: RESOLVED_AT,
    });

    expect(mockHandle.mock.calls[0][0].message).toContain('APROBAR');
  });

  it('tells the model NOT to congratulate a failure', async () => {
    // The worst possible output for this feature is celebrating a failed
    // teach-back, so the instruction says so in the negative, explicitly.
    await runGateResolvedFollowUp({
      socioId: 'socio-1', sessionId: 'sess-1', passed: false, resolvedAt: RESOLVED_AT,
    });

    const instruction = mockHandle.mock.calls[0][0].message;
    expect(instruction).toContain('SIN aprobarla');
    expect(instruction).toContain('NO lo felicites');
  });

  it('writes the instruction in the learner\'s language', async () => {
    mockRepo.getSocioById.mockResolvedValue(socio({ language: 'en' }));
    await runGateResolvedFollowUp({
      socioId: 'socio-1', sessionId: 'sess-1', passed: true, resolvedAt: RESOLVED_AT,
    });

    expect(mockHandle.mock.calls[0][0].message).toContain('PASSED');
  });

  it('reports not-posted when the handler suppressed the turn', async () => {
    mockHandle.mockResolvedValue({ responseText: '', suppressed: true });

    const posted = await runGateResolvedFollowUp({
      socioId: 'socio-1', sessionId: 'sess-1', passed: true, resolvedAt: RESOLVED_AT,
    });

    expect(posted).toBe(false);
  });

  it('stays quiet for a socio whose AI is paused', async () => {
    mockRepo.getSocioById.mockResolvedValue(socio({ aiPaused: true }));

    const posted = await runGateResolvedFollowUp({
      socioId: 'socio-1', sessionId: 'sess-1', passed: true, resolvedAt: RESOLVED_AT,
    });

    expect(posted).toBe(false);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('never throws, because the learner already finished their assessment', async () => {
    // Scores are committed before this runs. Failing their completion request
    // over a missing nicety would turn a small gap into a broken flow.
    mockHandle.mockRejectedValue(new Error('openrouter down'));

    await expect(
      runGateResolvedFollowUp({
        socioId: 'socio-1', sessionId: 'sess-1', passed: true, resolvedAt: RESOLVED_AT,
      }),
    ).resolves.toBe(false);
  });

  it('does not invent a turn for a socio that no longer exists', async () => {
    mockRepo.getSocioById.mockResolvedValue(null);

    const posted = await runGateResolvedFollowUp({
      socioId: 'ghost', sessionId: 'sess-1', passed: true, resolvedAt: RESOLVED_AT,
    });

    expect(posted).toBe(false);
    expect(mockHandle).not.toHaveBeenCalled();
  });
});
