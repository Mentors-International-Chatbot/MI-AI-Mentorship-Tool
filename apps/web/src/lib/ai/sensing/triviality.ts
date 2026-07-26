/**
 * Trivial-message detection for the sensing pass
 * ═══════════════════════════════════════════════════════════════════════════
 * Sensing is a ~2s LLM call. Running it on "ok" or "sí" costs a round trip and
 * returns no signal - worse, the old behaviour fed neutral defaults into the
 * EMA, actively diluting real state. When a message is trivial we skip the call
 * entirely and carry the prior dimension state forward unchanged.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Acknowledgment tokens that carry no comprehension signal on their own.
 * Spanish included - the pilot runs in Colombian Spanish.
 */
export const ACKNOWLEDGMENT_TOKENS: ReadonlySet<string> = new Set([
  // English
  'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'ok', 'okay', 'k', 'sure',
  'continue', 'next', 'go', 'got it', 'gotit', 'thanks', 'thank you', 'ty',
  'done', 'right', 'cool', 'nice', 'great', 'understood',
  // Spanish
  'si', 'sí', 'claro', 'vale', 'dale', 'listo', 'bueno', 'ya', 'dele',
  'siguiente', 'continuar', 'sigue', 'gracias', 'entendido', 'entiendo',
  'perfecto', 'genial', 'de acuerdo', 'esta bien', 'está bien',
  // Portuguese (third supported language)
  'sim', 'nao', 'não', 'certo', 'beleza', 'proximo', 'próximo', 'obrigado',
]);

/** Below this word count a message is treated as too thin to sense. */
const MIN_SUBSTANTIVE_WORDS = 4;

/**
 * Normalizes for token matching: lowercase, strip surrounding punctuation and
 * emoji-ish trailing characters, collapse whitespace.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.!?¡¿,;:'"()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(normalized: string): number {
  if (normalized.length === 0) return 0;
  return normalized.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export type TrivialityMode =
  /** Main lesson chat: short messages carry no signal worth 2s of latency. */
  | 'chat'
  /**
   * Assessment: the student's message IS the thing being graded, so a short
   * answer may still be their real explanation. Only bare acknowledgments and
   * empty input are skipped here.
   */
  | 'assessment';

/**
 * True when the message is unlikely to carry any sensing signal.
 *
 * `chat` mode skips on either rule (short OR acknowledgment).
 * `assessment` mode skips only on the acknowledgment rule, so a terse but real
 * explanation ("spread on separate slices") is still graded.
 */
export function isTrivialMessage(text: string, mode: TrivialityMode = 'chat'): boolean {
  const normalized = normalize(text);

  // Empty or near-empty is always trivial.
  if (normalized.length < 3) return true;

  if (ACKNOWLEDGMENT_TOKENS.has(normalized)) return true;

  if (mode === 'chat' && wordCount(normalized) < MIN_SUBSTANTIVE_WORDS) return true;

  return false;
}
