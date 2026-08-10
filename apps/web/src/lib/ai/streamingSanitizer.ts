/**
 * Emitting a reply while it is still being written
 * ═══════════════════════════════════════════════════════════════════════════
 * Streaming the model's tokens straight to the learner is not an option: what
 * reaches them is `sanitizeForDelivery(parseMarkers(raw).cleanText)`, and both
 * of those are whole-document transforms. `sanitizeLists` folds a bullet group
 * into one sentence and cannot know the group has ended until a non-list line
 * arrives; `parseMarkers` strips `[MILESTONE:first-sale]`, which is invisible
 * mid-token as `[MILE`. Emitting first and correcting later means the message
 * visibly reflows the instant generation finishes — worse than waiting for it.
 *
 * So this emits only text it will never need to take back.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * Everything from the first point that could still change is HELD. That point
 * is the earliest of:
 *
 *   - an unmatched `[`          — might become a marker
 *   - an unclosed ``` fence     — its contents get unwrapped once closed
 *   - the last incomplete line  — headers, bullets and numbering are line-scoped
 *   - a trailing list line      — the group may continue on the next line
 *   - a trailing newline run    — `\n{3,}` collapses, so a run can still grow
 *
 * Everything before that point is finalized: no later token can alter how it
 * renders. It is run through the real pipeline and the delta against what has
 * already been emitted is handed out.
 *
 * ── Why this is correct rather than approximately correct ─────────────────
 * The pipeline is applied to the whole finalized prefix every time, not to each
 * chunk in isolation, so transforms that span chunk boundaries still see their
 * full input. Because the prefix only grows and every held construct is
 * excluded from it, `sanitize(prefix)` is itself prefix-stable — which is what
 * makes "emit the delta" sound. `streamingSanitizer.test.ts` pins the property
 * that matters: for any chunk split, the concatenated output equals the batch
 * result exactly.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { sanitizeForDelivery } from '@/lib/ai/sanitizer';
import { stripMarkers, maskMarkers } from '@/lib/ai/prompts/markers';

/** Lines the list sanitizer would absorb into a group. */
const LIST_LINE_RE = /^\s*(?:[-*]\s+|\d+\.\s+)/;

/**
 * A partial line that could still turn into a header, bullet or numbered item
 * once one more character arrives. `-` is a bullet-in-waiting; `-x` never is.
 */
const AMBIGUOUS_LINE_START_RE = /^\s*(?:[-*]\s*|#{1,6}\s*|\d+\.?\s*)$/;

/** Start of the last unclosed inline-code or fenced-code region, or -1. */
function openCodeFrom(raw: string): number {
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith('```', i)) {
      const close = raw.indexOf('```', i + 3);
      if (close === -1) return i;
      i = close + 3;
    } else if (raw[i] === '`') {
      const close = raw.indexOf('`', i + 1);
      if (close === -1) return i;
      // Adjacent backticks are not inline code — INLINE_CODE_RE requires
      // content between them. A bare `` is a fence two thirds of the way
      // typed, so it stays open rather than pairing with itself.
      if (close === i + 1) return i;
      i = close + 1;
    } else {
      i++;
    }
  }
  return -1;
}

/**
 * Start of the earliest still-open emphasis run, or -1.
 *
 * Runs are matched by LENGTH, not merely counted: `**muy importante*` has two
 * runs but the `**` is still open, because a single `*` cannot close it. Simple
 * parity said "balanced" and let the raw asterisks reach the learner.
 */
function openEmphasisFrom(raw: string): number {
  const stack: { ch: string; len: number; idx: number }[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch !== '*' && ch !== '_') { i++; continue; }

    let j = i;
    while (j < raw.length && raw[j] === ch) j++;
    const len = j - i;

    const top = stack[stack.length - 1];
    if (top && top.ch === ch && top.len === len) stack.pop();
    else stack.push({ ch, len, idx: i });

    i = j;
  }
  return stack.length > 0 ? stack[0].idx : -1;
}

/** Start of the contiguous list group ending at `lineStart`, or `lineStart`. */
function listGroupStart(raw: string, lineStart: number): number {
  let start = lineStart;
  while (start > 0) {
    const prevStart = raw.lastIndexOf('\n', start - 2) + 1;
    if (!LIST_LINE_RE.test(raw.slice(prevStart, start - 1))) break;
    start = prevStart;
  }
  return start;
}

/**
 * Index from which nothing can be trusted yet. Everything before it is final.
 *
 * Deliberately NOT "hold the whole incomplete line": a reply with no newlines
 * at all — which is most of them, since the prompt asks for a few sentences —
 * would then stream nothing whatsoever, and the feature would be decorative.
 * Once a line is known not to be a header or a list item, its prose streams a
 * character at a time like anything else.
 */
function holdFrom(raw: string): number {
  const candidates: number[] = [raw.length];

  // Structural detection runs over a copy with complete markers blanked out,
  // positions preserved. Without this, `[LESSON_COMPLETE:2]` reads as an open
  // italic because of its underscore, and the hold point lands inside a marker
  // that would then be emitted verbatim.
  const masked = maskMarkers(raw);

  // An unmatched '[' could still become a marker.
  const lastOpen = raw.lastIndexOf('[');
  if (lastOpen !== -1 && raw.indexOf(']', lastOpen) === -1) candidates.push(lastOpen);

  // Unclosed code, and any trailing backtick run that could still grow into a
  // fence. '``' is literal today and part of '```' one character later.
  const openCode = openCodeFrom(masked);
  if (openCode !== -1) candidates.push(openCode);

  // Unclosed emphasis.
  const openEmphasis = openEmphasisFrom(masked);
  if (openEmphasis !== -1) candidates.push(openEmphasis);

  // The final line, when it is still line-shaped rather than prose.
  const lastLineStart = raw.lastIndexOf('\n') + 1;
  const lastLine = raw.slice(lastLineStart);
  if (lastLineStart < raw.length) {
    if (AMBIGUOUS_LINE_START_RE.test(lastLine) || LIST_LINE_RE.test(lastLine)) {
      // A list item joins its neighbours, so the whole group is still in play —
      // including when the final line is only a bare `-` so far, which is a
      // bullet one character from now.
      candidates.push(listGroupStart(raw, lastLineStart));
    } else if (/^\s*#/.test(lastLine)) {
      candidates.push(lastLineStart);
    }
  }

  // A trailing newline run can still grow into one that collapses, and the
  // completed line above it may be a list item whose group continues.
  let end = raw.length;
  while (end > 0 && raw[end - 1] === '\n') end--;
  if (end < raw.length) {
    candidates.push(end);
    const prevStart = raw.lastIndexOf('\n', end - 1) + 1;
    if (LIST_LINE_RE.test(raw.slice(prevStart, end))) {
      candidates.push(listGroupStart(raw, prevStart));
    }
  }

  return Math.min(...candidates);
}

/** The delivery pipeline, applied to a finalized prefix. */
function sanitizeStable(raw: string): string {
  // Safe despite the pipeline's trailing trim: `holdFrom` never finalizes past
  // a trailing newline run, so a finalized prefix always ends on a
  // non-whitespace character and the trim has nothing to take. The leading trim
  // is stable by construction, since nothing is ever prepended.
  return sanitizeForDelivery(stripMarkers(raw));
}

export interface StreamingSanitizer {
  /** Feeds a raw model chunk. Returns text safe to show, possibly empty. */
  push(chunk: string): string;
  /** Flushes whatever is left. Returns the final delta. */
  end(): string;
  /** Everything the model produced, unmodified. For markers and persistence. */
  raw(): string;
  /** Everything emitted so far. Equals `sanitizeForDelivery` output at `end()`. */
  emitted(): string;
}

export function createStreamingSanitizer(): StreamingSanitizer {
  let raw = '';
  let emitted = '';

  function flushTo(index: number): string {
    const finalized = raw.slice(0, index);
    const full = sanitizeStable(finalized);
    if (!full.startsWith(emitted)) {
      // Defensive: a transform that is not prefix-stable would corrupt the
      // message. Emitting nothing here means `end()` still delivers the correct
      // full text, so the learner sees a late reply rather than a wrong one.
      return '';
    }
    const delta = full.slice(emitted.length);
    emitted = full;
    return delta;
  }

  return {
    push(chunk: string): string {
      raw += chunk;
      return flushTo(holdFrom(raw));
    },
    end(): string {
      // The real pipeline, on the complete text. This is the authoritative
      // result; everything streamed before it was a prefix of exactly this.
      const full = sanitizeForDelivery(stripMarkers(raw));
      // On the impossible branch, emit nothing and let the caller's final
      // payload replace the text outright. Emitting `full` here would append it
      // to a partial message and show the reply twice.
      const delta = full.startsWith(emitted) ? full.slice(emitted.length) : '';
      emitted = full;
      return delta;
    },
    raw: () => raw,
    emitted: () => emitted,
  };
}
