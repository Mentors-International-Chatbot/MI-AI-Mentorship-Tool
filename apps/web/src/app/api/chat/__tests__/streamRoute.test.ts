/**
 * The NDJSON contract /api/chat streams
 * ═══════════════════════════════════════════════════════════════════════════
 * The client parses this by hand — a reader, a line buffer, a switch on the
 * frame's single key — so the wire format is a real interface, not an
 * implementation detail. Three things about it have to hold, and each one is a
 * bug the client cannot recover from on its own:
 *
 *   - `done` carries the same payload the non-streaming path returns as its
 *     whole body, including messages[] with the REAL DB id. A provisional
 *     bubble is replaced from it; a missing id leaves the client holding a
 *     message it cannot later reconcile with history.
 *   - the streamed text is a PREFIX of done.response, never equal to it. The
 *     handler appends after generation. A client that appended `done` onto
 *     what it streamed would show the tail twice.
 *   - streaming is opt-in. Default stays JSON, and every rejection resolves
 *     with a real status code before a stream can open.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHandle = vi.hoisted(() => vi.fn());
const mockVerify = vi.hoisted(() => vi.fn());
const mockGetSocio = vi.hoisted(() => vi.fn());

vi.mock('@/lib/messaging/handler', () => ({ handleIncomingMessage: mockHandle }));
vi.mock('@/lib/auth/session', () => ({ verifySession: mockVerify }));
vi.mock('@/lib/repo', () => ({ repo: { getSocio: mockGetSocio } }));

import { POST } from '../route';
import { InteractionMode } from '@/lib/ai/prompts';

const REPLY = 'Muy bien, Ana. Anota tus gastos.';
const APPENDED = REPLY + '\n\nQue te parecio esta leccion?';

const noMarkers = {
  cleanText: '', flags: [], lessonsCompleted: [], escalations: [], financials: [], milestones: [],
};

function post(body: unknown): Request {
  return new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Reads an NDJSON body into parsed frames. */
async function readFrames(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/**
 * Stands in for the handler: emits deltas, then resolves with a reply that is
 * LONGER than what it streamed — the escalation/feedback append the plan calls
 * out, which is what makes replace-not-append the client's only safe move.
 */
function handlerStreaming(deltas: string[], finalText = APPENDED) {
  return async (input: { onToken?: (d: string) => void }) => {
    for (const d of deltas) input.onToken?.(d);
    return {
      responseText: finalText,
      mode: InteractionMode.LESSON_DELIVERY,
      markers: noMarkers,
      socioId: 'socio-1',
      isNewSocio: false,
      messages: [{
        id: 'msg-real-db-id',
        role: 'assistant',
        content: finalText,
        senderType: 'ai',
        createdAt: new Date('2026-08-10T12:00:00.000Z'),
        metadata: null,
      }],
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockResolvedValue({ userId: `u-${Math.random()}`, role: 'socio', name: 'Ana' });
  mockGetSocio.mockResolvedValue({ id: 'socio-1', aiPaused: false });
  mockHandle.mockImplementation(handlerStreaming(['Muy bien, ', 'Ana.']));
});

describe('streaming opt-in', () => {
  it('streams NDJSON only when the request asks for it', async () => {
    const res = await POST(post({ message: 'ya vendi', stream: true }) as never);

    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson');
  });

  it('returns ordinary JSON by default', async () => {
    const res = await POST(post({ message: 'ya vendi' }) as never);

    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = await res.json();
    expect(body.response).toBe(APPENDED);
    expect(body.messages[0].id).toBe('msg-real-db-id');
  });
});

describe('the wire format', () => {
  it('sends token frames followed by exactly one terminal done frame', async () => {
    const res = await POST(post({ message: 'ya vendi', stream: true }) as never);
    const frames = await readFrames(res);

    const tokens = frames.filter((f) => 't' in f);
    const dones = frames.filter((f) => 'done' in f);

    expect(tokens.map((f) => f.t)).toEqual(['Muy bien, ', 'Ana.']);
    expect(dones).toHaveLength(1);
    // Terminal means terminal: nothing follows it.
    expect(frames[frames.length - 1]).toBe(dones[0]);
  });

  it('carries the real DB id in done, so the client can reconcile later', async () => {
    const res = await POST(post({ message: 'ya vendi', stream: true }) as never);
    const frames = await readFrames(res);
    const done = frames.find((f) => 'done' in f)!.done as Record<string, unknown>;

    expect(done.response).toBe(APPENDED);
    expect(done.mode).toBe(InteractionMode.LESSON_DELIVERY);
    expect(done.socioId).toBe('socio-1');
    expect(done.isError).toBe(false);
    expect((done.messages as { id: string }[])[0].id).toBe('msg-real-db-id');
  });

  it('streams a strict prefix of the final text, never the whole of it', async () => {
    const res = await POST(post({ message: 'ya vendi', stream: true }) as never);
    const frames = await readFrames(res);

    const streamed = frames.filter((f) => 't' in f).map((f) => f.t).join('');
    const done = frames.find((f) => 'done' in f)!.done as { response: string };

    expect(done.response.startsWith(streamed)).toBe(true);
    expect(streamed).not.toBe(done.response);
  });

  it('closes without a done frame when generation throws', async () => {
    // No status code left to send, so absence of `done` is the error signal
    // and the client refetches history.
    mockHandle.mockRejectedValue(new Error('db down'));

    const res = await POST(post({ message: 'ya vendi', stream: true }) as never);
    const frames = await readFrames(res);

    expect(res.status).toBe(200);
    expect(frames.filter((f) => 'done' in f)).toHaveLength(0);
  });
});

describe('rejections resolve before any stream opens', () => {
  it('401s an unauthenticated streaming request as JSON', async () => {
    mockVerify.mockResolvedValue(null);

    const res = await POST(post({ message: 'hola', stream: true }) as never);

    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('400s a streaming request with no message as JSON', async () => {
    const res = await POST(post({ stream: true }) as never);

    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(mockHandle).not.toHaveBeenCalled();
  });
});

describe('the dedup cache', () => {
  it('is bypassed for streaming, so a repeat really regenerates', async () => {
    // The cache stores a finished payload. A stream is not a value you can
    // hand to a second caller, so it must not participate at all.
    mockVerify.mockResolvedValue({ userId: 'u-dedup-stream', role: 'socio', name: 'Ana' });

    await readFrames(await POST(post({ message: 'igual', stream: true }) as never));
    await readFrames(await POST(post({ message: 'igual', stream: true }) as never));

    expect(mockHandle).toHaveBeenCalledTimes(2);
  });

  it('still short-circuits a repeated non-streaming request', async () => {
    mockVerify.mockResolvedValue({ userId: 'u-dedup-json', role: 'socio', name: 'Ana' });

    await POST(post({ message: 'igual' }) as never);
    await POST(post({ message: 'igual' }) as never);

    expect(mockHandle).toHaveBeenCalledTimes(1);
  });

  it('never returns a cached AI reply after the learner is paused', async () => {
    mockVerify.mockResolvedValue({ userId: 'u-paused-cache', role: 'socio', name: 'Ana' });

    const first = await POST(post({ message: 'igual' }) as never);
    expect((await first.json()).response).toBe(APPENDED);

    mockGetSocio.mockResolvedValue({ id: 'socio-1', aiPaused: true });
    mockHandle.mockResolvedValueOnce({
      responseText: '',
      mode: InteractionMode.LESSON_DELIVERY,
      markers: noMarkers,
      socioId: 'socio-1',
      isNewSocio: false,
      messages: [],
    });
    const paused = await POST(post({ message: 'igual' }) as never);

    expect(mockHandle).toHaveBeenCalledTimes(2);
    expect((await paused.json()).response).toBe('');
  });

  it('does not let a streamed turn poison the cache for a later plain one', async () => {
    mockVerify.mockResolvedValue({ userId: 'u-mixed', role: 'socio', name: 'Ana' });

    await readFrames(await POST(post({ message: 'igual', stream: true }) as never));
    const res = await POST(post({ message: 'igual' }) as never);

    expect(mockHandle).toHaveBeenCalledTimes(2);
    expect((await res.json()).response).toBe(APPENDED);
  });
});
