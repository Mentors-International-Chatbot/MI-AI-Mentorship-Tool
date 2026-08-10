/**
 * System-initiated turns in the handler
 * ═══════════════════════════════════════════════════════════════════════════
 * A turn with no learner message behind it has to differ from a normal one in
 * exactly the ways that follow from that absence, and in no others:
 *
 *   - nothing of the learner's is persisted (there was no message)
 *   - the interaction clock is not touched (they did not interact)
 *   - sentiment and context extraction do not run (nothing to score or mine)
 *   - reminder counters are not reset (the AI speaking is not the learner
 *     breaking their silence)
 *
 * And it must NOT differ on progression: when the router routes it to
 * LESSON_DELIVERY it really does deliver a teaching message, so the pointer has
 * to move or the learner gets that message twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = vi.hoisted(() => ({
  getSocio: vi.fn(),
  addMessage: vi.fn(),
  touchInteraction: vi.fn(),
  getLastAssistantMessageAt: vi.fn(),
  advanceMessage: vi.fn(),
  getSocioProgress: vi.fn(),
  upsertLessonProgress: vi.fn(),
  resetReminders: vi.fn(),
  createFlag: vi.fn(),
}));

const mockGenerate = vi.hoisted(() => vi.fn());
// Both are fire-and-forget at the call site (`.catch(...)`), so they must
// resolve rather than return undefined.
const mockSentiment = vi.hoisted(() => vi.fn(async () => {}));
const mockExtract = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/lib/repo', () => ({ repo: mockRepo }));
vi.mock('@/lib/ai/service', () => ({ generateAIResponse: mockGenerate }));
vi.mock('@/lib/sentiment/pipeline', () => ({ analyzeSentimentAndFlag: mockSentiment }));
vi.mock('@/lib/ai/contextExtractor', () => ({ extractAndStoreContext: mockExtract }));
vi.mock('@/lib/lessons/db-lesson-service', () => ({
  hasLessonData: vi.fn(() => false),
  preloadCollection: vi.fn(async () => {}),
  getLessonCount: vi.fn(() => 3),
}));
vi.mock('@/lib/config/service', () => ({ getConfigNumber: vi.fn(async () => 5) }));

import { handleIncomingMessage } from '../handler';
import { InteractionMode } from '@/lib/ai/prompts';

const GATE_RESOLVED_AT = new Date('2026-08-09T10:05:00.000Z');
const BEFORE = new Date('2026-08-09T10:00:00.000Z');
const AFTER = new Date('2026-08-09T10:06:00.000Z');

const channel = { sendMessage: vi.fn(async () => {}), getChannelType: () => 'web' as const };

const systemInitiated = {
  kind: 'gate_resolved' as const,
  sessionId: 'sess-1',
  suppressIfAssistantSpokeAfter: GATE_RESOLVED_AT,
};

const noMarkers = {
  cleanText: '', flags: [], lessonsCompleted: [], escalations: [], financials: [], milestones: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.getSocio.mockResolvedValue({
    id: 'socio-1', channelType: 'web', externalId: 'ext-1', language: 'es',
    status: 'ACTIVE', aiPaused: false, curriculumCollectionKey: 'pbj',
    createdAt: new Date(), updatedAt: new Date(),
  });
  mockRepo.addMessage.mockImplementation(async (d: Record<string, unknown>) => ({
    id: 'msg-new', createdAt: new Date(), ...d,
  }));
  mockRepo.getSocioProgress.mockResolvedValue({ currentLessonNumber: 1, currentMessageIndex: 1 });
  mockRepo.getLastAssistantMessageAt.mockResolvedValue(BEFORE);
  mockGenerate.mockResolvedValue({
    text: 'Bien hecho, sigamos.',
    markers: noMarkers,
    mode: InteractionMode.FREEFORM_QUESTION,
    determineModeResult: { progress: { currentLessonNumber: 1 } },
    analysisPolicy: { sensing: true, sentiment: true, contextExtraction: true },
  });
});

async function runSystemTurn() {
  return handleIncomingMessage({
    externalId: 'ext-1',
    channelType: 'web',
    message: '(instruction)',
    channel,
    systemInitiated,
  });
}

describe('system-initiated turn', () => {
  it('posts the AI turn without inventing a learner message', async () => {
    const r = await runSystemTurn();

    expect(r.suppressed).toBeUndefined();
    expect(r.responseText).toBe('Bien hecho, sigamos.');

    const roles = mockRepo.addMessage.mock.calls.map((c) => c[0].role);
    expect(roles).toEqual(['assistant']);
    // The steering instruction must never be persisted.
    const contents = mockRepo.addMessage.mock.calls.map((c) => c[0].content);
    expect(contents).not.toContain('(instruction)');
  });

  it('tags the message so a volunteered turn is identifiable later', async () => {
    await runSystemTurn();

    expect(mockRepo.addMessage.mock.calls[0][0].metadata).toEqual({
      kind: 'gate_resolved',
      sessionId: 'sess-1',
    });
  });

  it('does not touch the interaction clock', async () => {
    await runSystemTurn();
    expect(mockRepo.touchInteraction).not.toHaveBeenCalled();
  });

  it('runs no sentiment or context extraction', async () => {
    await runSystemTurn();
    expect(mockSentiment).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('does not reset reminder counters', async () => {
    await runSystemTurn();
    expect(mockRepo.resetReminders).not.toHaveBeenCalled();
  });
});

describe('duplicate guard', () => {
  it('stays silent when the AI already spoke after the gate resolved', async () => {
    mockRepo.getLastAssistantMessageAt.mockResolvedValue(AFTER);

    const r = await runSystemTurn();

    expect(r.suppressed).toBe(true);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockRepo.addMessage).not.toHaveBeenCalled();
  });

  it('discards a turn if someone spoke while it was generating', async () => {
    // The race the late second check exists for: the learner types at the same
    // moment the gate resolves. One wasted generation, no double reply.
    mockRepo.getLastAssistantMessageAt
      .mockResolvedValueOnce(BEFORE)  // pre-check: clear
      .mockResolvedValueOnce(AFTER);  // post-generation: someone got there first

    const r = await runSystemTurn();

    expect(r.suppressed).toBe(true);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockRepo.addMessage).not.toHaveBeenCalled();
  });

  it('stays silent rather than risk double-messaging when the guard read fails', async () => {
    mockRepo.getLastAssistantMessageAt.mockRejectedValue(new Error('db down'));

    const r = await runSystemTurn();

    expect(r.suppressed).toBe(true);
    expect(mockRepo.addMessage).not.toHaveBeenCalled();
  });

  it('leaves ordinary learner turns entirely alone', async () => {
    const r = await handleIncomingMessage({
      externalId: 'ext-1', channelType: 'web', message: 'hola', channel,
    });

    expect(r.suppressed).toBeUndefined();
    expect(mockRepo.getLastAssistantMessageAt).not.toHaveBeenCalled();
    expect(mockRepo.touchInteraction).toHaveBeenCalled();
    const roles = mockRepo.addMessage.mock.calls.map((c) => c[0].role);
    expect(roles).toEqual(['user', 'assistant']);
  });
});
