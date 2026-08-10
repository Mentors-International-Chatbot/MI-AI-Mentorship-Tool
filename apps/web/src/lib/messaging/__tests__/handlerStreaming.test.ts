/**
 * A dropped reader must not cost the learner their turn
 * ═══════════════════════════════════════════════════════════════════════════
 * Streaming introduces a party that can vanish mid-request: the client. A
 * learner on a Colombian mobile connection closing the tab, walking into a
 * dead zone, or reloading the page is the ordinary case, not the edge case.
 *
 * The contract the handler owes them is that the stream is a TAP on the
 * output, never the driver of it. Whatever they would have had by waiting,
 * they have anyway — the assistant message stored, progression advanced —
 * recoverable through /api/chat/history and /api/chat/poll on reload.
 *
 * Today that holds because nothing in the write path consults the consumer.
 * It is pinned here because it is easy to break by accident and invisible when
 * broken: the learner sees a reply appear, then lose it on refresh, and
 * nothing in the logs says why.
 *
 * The disconnect is modelled as `onToken` THROWING, which is what actually
 * happens — enqueueing onto a closed ReadableStream controller raises. A test
 * where the consumer merely ignores its deltas would prove much less.
 *
 * generateAIResponse is mocked here, so the stand-in swallows that throw the
 * way the real `emit` in service.ts does. That is modelling the boundary, not
 * excusing it: streamWithRetry.test.ts pins the swallow itself, and this file
 * pins that nothing downstream of it consults the consumer.
 * ═══════════════════════════════════════════════════════════════════════════
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
const mockSentiment = vi.hoisted(() => vi.fn(async () => {}));
const mockExtract = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/lib/repo', () => ({ repo: mockRepo }));
vi.mock('@/lib/ai/service', () => ({ generateAIResponse: mockGenerate }));
vi.mock('@/lib/sentiment/pipeline', () => ({ persistSentimentAndFlag: mockSentiment }));
vi.mock('@/lib/ai/contextExtractor', () => ({ extractAndStoreContext: mockExtract }));
vi.mock('@/lib/lessons/db-lesson-service', () => ({
  hasLessonData: vi.fn(() => false),
  preloadCollection: vi.fn(async () => {}),
  getLessonCount: vi.fn(() => 3),
}));
vi.mock('@/lib/config/service', () => ({ getConfigNumber: vi.fn(async () => 5) }));

import { handleIncomingMessage } from '../handler';
import { InteractionMode } from '@/lib/ai/prompts';

const REPLY = 'Muy bien, Ana. El siguiente paso es anotar tus gastos.';

const channel = { sendMessage: vi.fn(async () => {}), getChannelType: () => 'web' as const };

const noMarkers = {
  cleanText: '', flags: [], lessonsCompleted: [], escalations: [], financials: [], milestones: [],
};

/**
 * Stands in for generateAIResponse, feeding the handler's onToken the way a
 * real stream would before resolving with the finished reply.
 */
function generateStreaming(deltas: string[]) {
  return async (
    _socio: unknown,
    _message: string,
    _collectionKey: string,
    _override: unknown,
    onToken?: (delta: string) => void,
  ) => {
    for (const d of deltas) {
      // service.ts treats delivery as best-effort; a dead consumer never
      // surfaces to the caller as a generation failure.
      try {
        onToken?.(d);
      } catch {
        /* the real emit() logs and carries on */
      }
    }
    return {
      text: REPLY,
      markers: noMarkers,
      mode: InteractionMode.LESSON_DELIVERY,
      determineModeResult: { progress: { currentLessonNumber: 1 } },
      analysisPolicy: { sensing: true, sentiment: true, contextExtraction: true },
      // Scored by the merged sensing pass; the handler only persists it, and
      // it skips the write entirely when this is absent.
      sentiment: { sentiment: 'positive', confusion: 1, frustration: 0, urgency: 0, topics: [] },
    };
  };
}

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
});

async function runTurn(onToken?: (delta: string) => void) {
  return handleIncomingMessage({
    externalId: 'ext-1', channelType: 'web', message: 'ya vendi', channel, onToken,
  });
}

/** The state a learner is entitled to regardless of what their socket did. */
function expectTurnFullyPersisted() {
  const roles = mockRepo.addMessage.mock.calls.map((c) => c[0].role);
  expect(roles).toEqual(['user', 'assistant']);

  const assistant = mockRepo.addMessage.mock.calls.find((c) => c[0].role === 'assistant')![0];
  expect(assistant.content).toBe(REPLY);

  // LESSON_DELIVERY with no completion marker advances the pointer.
  expect(mockRepo.advanceMessage).toHaveBeenCalledWith('socio-1');
  expect(mockRepo.upsertLessonProgress).toHaveBeenCalledWith('socio-1', 1, null, false);
}

describe('a client that drops mid-stream', () => {
  it('leaves exactly the DB state a client that stayed would have left', async () => {
    // Baseline: the same turn with a reader that behaves.
    mockGenerate.mockImplementation(generateStreaming(['Muy bien, ', 'Ana.']));
    await runTurn(vi.fn());
    const healthy = mockRepo.addMessage.mock.calls.map((c) => [c[0].role, c[0].content]);

    vi.clearAllMocks();
    mockRepo.addMessage.mockImplementation(async (d: Record<string, unknown>) => ({
      id: 'msg-new', createdAt: new Date(), ...d,
    }));
    mockRepo.getSocioProgress.mockResolvedValue({ currentLessonNumber: 1, currentMessageIndex: 1 });
    mockRepo.getSocio.mockResolvedValue({
      id: 'socio-1', channelType: 'web', externalId: 'ext-1', language: 'es',
      status: 'ACTIVE', aiPaused: false, curriculumCollectionKey: 'pbj',
      createdAt: new Date(), updatedAt: new Date(),
    });

    // Now the reader dies on its very first delta.
    const dead = vi.fn(() => { throw new Error('controller is closed'); });
    mockGenerate.mockImplementation(generateStreaming(['Muy bien, ', 'Ana.']));

    const r = await runTurn(dead);

    expect(dead).toHaveBeenCalled();
    expect(r.responseText).toBe(REPLY);
    expect(r.isError).toBeUndefined();
    expectTurnFullyPersisted();
    expect(mockRepo.addMessage.mock.calls.map((c) => [c[0].role, c[0].content])).toEqual(healthy);
  });

  it('still runs the post-response analysis passes', async () => {
    // These are what populate sentiment and socio context. A learner whose
    // connection dropped is exactly the one worth having a flag raised for.
    mockGenerate.mockImplementation(generateStreaming(['Muy bien.']));

    await runTurn(vi.fn(() => { throw new Error('controller is closed'); }));

    expect(mockSentiment).toHaveBeenCalled();
    expect(mockExtract).toHaveBeenCalled();
  });

  it('returns the full reply, not the prefix the client managed to read', async () => {
    // The client gets deltas; the caller gets the authoritative text. Stage 4's
    // `done` payload is built from this, which is why the client replaces
    // rather than appends.
    const received: string[] = [];
    mockGenerate.mockImplementation(generateStreaming(['Muy bien, ', 'Ana.']));

    const r = await runTurn((d) => { received.push(d); });

    expect(received.join('')).not.toBe(r.responseText);
    expect(r.responseText).toBe(REPLY);
  });
});

describe('opting out of streaming', () => {
  it('passes no onToken through when the caller did not ask for one', async () => {
    mockGenerate.mockImplementation(generateStreaming([]));

    await runTurn();

    expect(mockGenerate.mock.calls[0][4]).toBeUndefined();
    expectTurnFullyPersisted();
  });

  it('never streams a system-initiated turn', async () => {
    // Nobody is holding a connection open for a turn they did not ask for.
    mockGenerate.mockImplementation(generateStreaming([]));
    mockRepo.getLastAssistantMessageAt.mockResolvedValue(new Date('2026-08-09T10:00:00.000Z'));

    await handleIncomingMessage({
      externalId: 'ext-1', channelType: 'web', message: '(instruction)', channel,
      onToken: vi.fn(),
      systemInitiated: {
        kind: 'gate_resolved',
        sessionId: 'sess-1',
        suppressIfAssistantSpokeAfter: new Date('2026-08-09T10:05:00.000Z'),
      },
    });

    expect(mockGenerate.mock.calls[0][4]).toBeUndefined();
  });
});
