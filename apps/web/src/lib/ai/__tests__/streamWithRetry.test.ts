/**
 * Retrying a stream is not the same operation as retrying an invoke
 * ═══════════════════════════════════════════════════════════════════════════
 * `invokeWithRetry` can re-run a failed attempt for free, because nobody has
 * seen the first one. `streamWithRetry` cannot: once a token has been handed
 * to the client, a retry appends a SECOND, differently-worded generation onto
 * text the learner is already reading. The message corrupts in place.
 *
 * So the rule is "retry only while nothing has been emitted", and the thing
 * worth pinning is the gate itself — that emission, not merely the arrival of
 * a chunk, is what closes the door. The two come apart in practice: the
 * sanitizer holds anything that could still change, so a stream can receive
 * several chunks and have emitted nothing at all. A test that only checked
 * "did a chunk arrive" would pass while the real gate was wrong.
 *
 * These are unit-level on purpose. The dropped-consumer case is integration
 * and lives with the handler; this file catches the gating logic before it is
 * tangled up with a route.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import { AIMessageChunk } from '@langchain/core/messages';
import { sanitizeForDelivery } from '@/lib/ai/sanitizer';
import { stripMarkers } from '@/lib/ai/prompts/markers';
import { contentToText, invokeStyledPlayerResponse, streamWithRetry } from '@/lib/ai/service';

/** A chunk to yield, or an error to throw at that point in the stream. */
type Step = string | AIMessageChunk | Error;

/**
 * A chat whose `.stream()` replays one scripted attempt per call. Extra calls
 * past the end of the script are a test bug, not a silent success.
 */
function scriptedChat(attempts: Step[][]) {
  let calls = 0;
  const chat = {
    async stream() {
      const script = attempts[calls];
      calls++;
      if (!script) throw new Error(`unscripted stream attempt #${calls}`);
      return (async function* () {
        for (const step of script) {
          if (step instanceof Error) throw step;
          yield typeof step === 'string' ? new AIMessageChunk({ content: step }) : step;
        }
      })();
    },
  };
  return { chat, attemptCount: () => calls };
}

/** Collects what a run emitted, and how the trace callbacks fired. */
function harness() {
  const emitted: string[] = [];
  const markFirstToken = vi.fn();
  return {
    emitted,
    markFirstToken,
    onToken: (d: string) => emitted.push(d),
    text: () => emitted.join(''),
  };
}

const NO_MESSAGES: [] = [];

describe('invokeStyledPlayerResponse — the delivery contract', () => {
  it('rejects an invalid fourth rewrite instead of delivering it unchecked', async () => {
    const chat = { invoke: vi.fn().mockResolvedValue({ content: 'One? Two? [END]' }) };

    await expect(invokeStyledPlayerResponse(chat, NO_MESSAGES, {
      maxSentences: 3,
      maxOutputTokens: 240,
      markdown: 'none',
      maxQuestions: 1,
      expanded: { maxSentences: 6, maxOutputTokens: 480 },
    }, false)).rejects.toThrow('Player response style contract failed after 4 repairs');

    expect(chat.invoke).toHaveBeenCalledTimes(5);
  });
});

describe('streamWithRetry — the happy path', () => {
  it('emits the same text the non-streaming path would have delivered', async () => {
    // Split so that a marker straddles a chunk boundary, which is the case
    // that makes emit-as-you-go hard: `[LESSON` must never reach the learner.
    const raw = 'Muy bien, Ana. Ya vendiste tu primer producto.[LESSON_COMPLETE:3] Sigamos.';
    const { chat } = scriptedChat([['Muy bien, Ana. Ya vendiste tu ', 'primer producto.[LESSON', '_COMPLETE:3] Sigamos.']]);
    const h = harness();

    const result = await streamWithRetry(chat, NO_MESSAGES, h.onToken, h.markFirstToken);

    expect(h.text()).toBe(sanitizeForDelivery(stripMarkers(raw)));
    expect(h.text()).not.toContain('[LESSON');
    // The accumulated message is what invokeTraced measures and what the
    // caller parses markers out of, so it keeps the markers.
    expect(contentToText(result.content)).toBe(raw);
  });

  it('stamps TTFT once, on the first chunk with content', async () => {
    const { chat } = scriptedChat([['Hola', ' Ana', '.']]);
    const h = harness();

    await streamWithRetry(chat, NO_MESSAGES, h.onToken, h.markFirstToken);

    expect(h.markFirstToken).toHaveBeenCalledTimes(3);
  });

  it('does not treat the usage-only terminator as a token', async () => {
    // OpenRouter closes an anthropic/* stream with a chunk carrying usage and
    // an empty content. It must not stamp TTFT, and its usage has to survive
    // concat — that is where invokeTraced reads real input-token counts from.
    const usageChunk = new AIMessageChunk({
      content: '',
      usage_metadata: { input_tokens: 33, output_tokens: 50, total_tokens: 83 },
    });
    const { chat } = scriptedChat([[usageChunk, 'Hola.', usageChunk]]);
    const h = harness();

    const result = await streamWithRetry(chat, NO_MESSAGES, h.onToken, h.markFirstToken);

    expect(h.markFirstToken).toHaveBeenCalledTimes(1);
    expect(h.text()).toBe('Hola.');
    expect(result.usage_metadata?.input_tokens).toBe(66);
  });
});

describe('streamWithRetry — the retry gate', () => {
  it('retries a stream that died before anything was emitted', async () => {
    // `[LESSON` is held by the sanitizer: an unmatched `[` could still become
    // a marker. So a chunk genuinely arrived and TTFT was stamped, yet the
    // client has seen nothing — the door is still open.
    const { chat, attemptCount } = scriptedChat([
      ['[LESSON', new Error('upstream 502')],
      ['Hola de nuevo.'],
    ]);
    const h = harness();

    const result = await streamWithRetry(chat, NO_MESSAGES, h.onToken, h.markFirstToken);

    expect(attemptCount()).toBe(2);
    // Only the second attempt's text, with no trace of the abandoned one.
    expect(h.text()).toBe('Hola de nuevo.');
    expect(h.text()).not.toContain('[LESSON');
    expect(contentToText(result.content)).toBe('Hola de nuevo.');
  }, 10000);

  it('propagates instead of retrying once a token has reached the client', async () => {
    const { chat, attemptCount } = scriptedChat([
      ['Hola, para vender mas ', new Error('upstream 502')],
      ['una respuesta completamente distinta'],
    ]);
    const h = harness();

    await expect(
      streamWithRetry(chat, NO_MESSAGES, h.onToken, h.markFirstToken),
    ).rejects.toThrow('upstream 502');

    // The second script was never reached. Had it been, the learner would be
    // reading the first attempt with the second one appended to it.
    expect(attemptCount()).toBe(1);
    expect(h.text()).toBe('Hola, para vender mas');
    expect(h.text()).not.toContain('distinta');
  });

  it('does not retry a stream that failed before yielding anything, more than once', async () => {
    const { chat, attemptCount } = scriptedChat([
      [new Error('upstream 502')],
      [new Error('upstream 502 again')],
    ]);
    const h = harness();

    await expect(
      streamWithRetry(chat, NO_MESSAGES, h.onToken, h.markFirstToken),
    ).rejects.toThrow('upstream 502 again');

    expect(attemptCount()).toBe(2);
    expect(h.emitted).toEqual([]);
  }, 10000);
});

describe('streamWithRetry — a consumer that dies', () => {
  it('finishes the generation when the consumer throws on every delta', async () => {
    // Enqueueing onto a closed ReadableStream controller raises, so this is
    // what a learner closing the tab mid-reply actually does to us. The reply
    // still has to be produced: the handler stores it, and they get it back
    // on reload. Delivery is best-effort; the DB write is not.
    const { chat } = scriptedChat([['Muy bien, ', 'Ana.']]);
    const dead = vi.fn(() => { throw new Error('controller is closed'); });
    const markFirstToken = vi.fn();

    const result = await streamWithRetry(chat, NO_MESSAGES, dead, markFirstToken);

    expect(dead).toHaveBeenCalled();
    expect(contentToText(result.content)).toBe('Muy bien, Ana.');
  });

  it('does not retry after a consumer error, having no idea what landed', async () => {
    // The bytes may well have reached the client before it threw. Retrying on
    // that guess is how the learner ends up reading two different replies
    // spliced together.
    const { chat, attemptCount } = scriptedChat([
      ['Muy bien, ', new Error('upstream 502')],
      ['otra respuesta distinta'],
    ]);
    const dead = vi.fn(() => { throw new Error('controller is closed'); });

    await expect(
      streamWithRetry(chat, NO_MESSAGES, dead, vi.fn()),
    ).rejects.toThrow('upstream 502');

    expect(attemptCount()).toBe(1);
  });
});

describe('contentToText', () => {
  // Shared by both paths now, so its behaviour is worth stating outright
  // rather than leaving implied by whichever caller happens to exercise it.
  it('passes a string through untouched', () => {
    expect(contentToText('Hola, Ana.')).toBe('Hola, Ana.');
    expect(contentToText('')).toBe('');
  });

  it('serializes ContentBlock[] rather than dropping it', () => {
    // Not a pretty result, but it is the pre-existing behaviour of the
    // non-streaming path, and both paths must agree on it — otherwise a
    // streamed reply and a stored reply would differ for the same output.
    expect(contentToText([{ type: 'text', text: 'hola' }])).toBe('[{"type":"text","text":"hola"}]');
  });
});
