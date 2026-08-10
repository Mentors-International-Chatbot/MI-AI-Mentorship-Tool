/**
 * Streaming must not change what the learner ends up reading
 * ═══════════════════════════════════════════════════════════════════════════
 * The whole value of streaming is that the reply appears as it is written. The
 * whole risk is that it appears WRONG and then corrects itself: a bullet list
 * rendering line by line and then collapsing into one sentence, or the text
 * `[MILESTONE:first-sale]` flashing on screen before being stripped.
 *
 * So the property under test is exact equality, not approximate agreement:
 * for any way the model's output happens to be chunked, the concatenation of
 * everything emitted equals `sanitizeForDelivery(stripMarkers(raw))` — the same
 * string the non-streaming path stores and the same string WhatsApp receives.
 *
 * Chunk boundaries are the adversary here, so they are exhaustive rather than
 * sampled: every split point, plus per-character streaming, which is the worst
 * case and the one real token streams most resemble.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeForDelivery } from '@/lib/ai/sanitizer';
import { stripMarkers } from '@/lib/ai/prompts/markers';
import { createStreamingSanitizer } from '../streamingSanitizer';

/** Streams `text` in the given chunks and returns everything emitted. */
function streamInChunks(text: string, chunks: string[]): string {
  const s = createStreamingSanitizer();
  let out = '';
  for (const c of chunks) out += s.push(c);
  out += s.end();
  return out;
}

function splitEvery(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

/** The authoritative result the non-streaming path produces. */
function batch(text: string): string {
  return sanitizeForDelivery(stripMarkers(text));
}

const CASES: Record<string, string> = {
  plain: 'Hola Ana. Subiste los precios y funcionó.',
  withMarker: 'Bien hecho, Ana. [MILESTONE:first-sale] Sigamos.',
  markerAtEnd: 'Terminaste la lección.\n\n[LESSON_COMPLETE:2]',
  twoMarkers: 'Cuidado. [FLAG:RED|urgencia alta] Te ayudo. [ESCALATE|quiere mentor]',
  financial: 'Anotado. [FINANCIAL:revenue=1200.50,netProfit=300]',
  bulletList: 'Pasos:\n- comprar pan\n- untar\n- cerrar\n\nEso es todo.',
  numberedList: 'Haz esto:\n1. mide\n2. corta\n3. sirve\n\nListo.',
  bold: 'Esto es **muy importante** para ti.',
  italic: 'Esto es *clave* aquí.',
  header: '# Resumen\nTodo bien.',
  inlineCode: 'Escribe `siguiente` para continuar.',
  codeFence: 'Ejemplo:\n```js\nconst x = 1;\n```\nFin.',
  emDash: 'Precio — costo = ganancia.',
  blankRuns: 'Uno.\n\n\n\nDos.',
  bracketNotMarker: 'Usa el corchete [así] en tu nota.',
  listThenMarker: 'Pasos:\n- uno\n- dos\n\n[MILESTONE:first-sale]',
  trailingNewlines: 'Listo.\n\n',
  empty: '',

  // ── Each of these caught a real bug in the hold rule ──────────────────
  // A marker's own underscore read as an unclosed italic, dragging the safe
  // boundary into the middle of the marker so it was emitted verbatim.
  markerWithUnderscore: 'Bien.\n\n[LESSON_COMPLETE:2]',
  // `**x*` is two runs of `*` but the `**` is still open; parity called it
  // balanced and let the raw asterisks through.
  unevenEmphasisRuns: 'Esto es **muy importante** ya.',
  // A bare `` paired with itself as empty inline code, which INLINE_CODE_RE
  // does not accept — it is a fence two thirds typed.
  partialFence: 'Mira:\n```\nx\n```\nFin.',
  // A closing backtick must not be mistaken for a new opener.
  codeThenProse: 'Escribe `next` y sigue adelante.',
  // The trailing line is a bare `-`, a bullet one character from now, so the
  // group above it is still open.
  bulletMidType: 'Pasos:\n- uno\n- dos\n',
  emphasisInsideList: 'Pasos:\n- compra **pan**\n- unta\n\nFin.',
};

describe('createStreamingSanitizer', () => {
  describe('equals the batch result for every chunk boundary', () => {
    for (const [name, text] of Object.entries(CASES)) {
      it(name, () => {
        const expected = batch(text);

        // Per-character: the worst case, and closest to a real token stream.
        expect(streamInChunks(text, splitEvery(text, 1)), 'per-character').toBe(expected);

        // Every single split point.
        for (let i = 0; i <= text.length; i++) {
          const chunks = [text.slice(0, i), text.slice(i)];
          expect(streamInChunks(text, chunks), `split at ${i}`).toBe(expected);
        }

        // A few fixed chunk sizes, to catch anything specific to alignment.
        for (const size of [2, 3, 5, 7]) {
          expect(streamInChunks(text, splitEvery(text, size)), `size ${size}`).toBe(expected);
        }
      });
    }
  });

  it('never shows a marker, even mid-token', () => {
    // The failure that would be most obvious to a learner: seeing the raw
    // instruction the model emits for the backend.
    const text = 'Bien hecho. [MILESTONE:first-sale] Sigue así.';
    const s = createStreamingSanitizer();

    let seen = '';
    for (const ch of text) seen += s.push(ch);
    seen += s.end();

    expect(seen).not.toContain('[MILESTONE');
    expect(seen).not.toContain('first-sale');
  });

  it('holds a bullet group until it can know the group ended', () => {
    // Emitting "- comprar pan" and later replacing it with the joined sentence
    // is exactly the reflow this class exists to prevent.
    const s = createStreamingSanitizer();
    const early = s.push('Pasos:\n- comprar pan\n');

    expect(early).not.toContain('comprar pan');

    const rest = s.push('- untar\n\nFin.') + s.end();
    expect(early + rest).toBe(batch('Pasos:\n- comprar pan\n- untar\n\nFin.'));
  });

  it('holds an unclosed code fence rather than showing the backticks', () => {
    const s = createStreamingSanitizer();
    const early = s.push('Ejemplo:\n```js\nconst x = 1;\n');

    expect(early).not.toContain('```');

    const rest = s.push('```\nFin.') + s.end();
    expect(early + rest).toBe(batch('Ejemplo:\n```js\nconst x = 1;\n```\nFin.'));
  });

  it('emits progressively rather than saving everything for the end', () => {
    // A guard against the degenerate implementation that satisfies every
    // equality test above by streaming nothing at all.
    const text = 'Primera frase completa aquí. Segunda frase completa aquí. Tercera.';
    const s = createStreamingSanitizer();

    let beforeEnd = '';
    for (const ch of text) beforeEnd += s.push(ch);

    expect(beforeEnd.length).toBeGreaterThan(text.length / 2);
  });

  it('exposes the untouched raw text for marker extraction', () => {
    // Persistence still parses markers from the complete raw reply — doing it
    // per chunk would double-count one that straddles a boundary.
    const s = createStreamingSanitizer();
    s.push('Bien. [MILESTONE:first-');
    s.push('sale] Sigue.');
    s.end();

    expect(s.raw()).toBe('Bien. [MILESTONE:first-sale] Sigue.');
  });
});
