// WhatsApp delivery sanitizer.
//
// Claude sometimes returns Markdown (bold/italic, bullets, headers, code fences).
// This sanitizer converts it into a safer "plain text" representation for WhatsApp.

const STRONG_RE = /(\*\*|__)(.*?)\1/g;

// Single emphasis: *text* or _text_
// - requires whitespace or start-of-string before the opening marker
// - avoids greedy capture across newlines
const ITALIC_RE = /(^|[\s])(\*|_)([^*\n_]+?)\2(?=$|[\s])/g;

const HEADER_RE = /^#{1,6}\s*(.+)$/gm;

const INLINE_CODE_RE = /`([^`]+)`/g;

// ```lang\n...\n```
const CODE_FENCE_RE = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;

const BULLET_RE = /^\s*[-*]\s+(.+?)\s*$/;
const NUMBERED_RE = /^\s*(\d+)\.\s+(.+?)\s*$/;

function ensureFinalPunctuation(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return trimmed;
  if (/[.!?]$/.test(trimmed)) return trimmed;
  return trimmed + '.';
}

function joinListItems(items: string[]): string {
  const cleaned = items.map((i) => i.trim()).filter(Boolean);
  if (cleaned.length === 0) return '';
  // Flowing text for WhatsApp: turn list into one sentence.
  const joined = cleaned.join(', ');
  return ensureFinalPunctuation(joined);
}

function sanitizeLists(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];

  let currentBullets: string[] = [];
  let currentNumbered: string[] = [];

  function flushBullets() {
    if (currentBullets.length > 0) {
      out.push(joinListItems(currentBullets));
      currentBullets = [];
    }
  }

  function flushNumbered() {
    if (currentNumbered.length > 0) {
      out.push(joinListItems(currentNumbered));
      currentNumbered = [];
    }
  }

  for (const line of lines) {
    const bulletMatch = BULLET_RE.exec(line);
    if (bulletMatch) {
      flushNumbered();
      currentBullets.push(bulletMatch[1]);
      continue;
    }

    const numberedMatch = NUMBERED_RE.exec(line);
    if (numberedMatch) {
      flushBullets();
      currentNumbered.push(numberedMatch[2]);
      continue;
    }

    // Non-list line: flush any pending list group.
    flushBullets();
    flushNumbered();
    out.push(line);
  }

  flushBullets();
  flushNumbered();

  return out.join('\n');
}

function normalizePlainText(text: string): string {
  return text
    // Normalize punctuation that renders inconsistently across player,
    // WhatsApp, and Canvas. A spaced replacement avoids the old "solid-you"
    // corruption caused by replacing an em dash with a bare hyphen.
    .replace(/[\u2014\u2013]/g, ', ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    // Learner-visible tutor replies are one flowing paragraph. This also
    // removes literal escaped newline sequences occasionally echoed by models.
    .replace(/\\[rn]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1');
}

export function sanitizeForDelivery(text: string): string {
  let out = text;

  // Remove triple-fenced code blocks while keeping the inner code.
  out = out.replace(CODE_FENCE_RE, (_m, inner: string) => inner.trimEnd());

  // Remove inline code backticks.
  out = out.replace(INLINE_CODE_RE, '$1');

  // Headers: keep only the text.
  out = out.replace(HEADER_RE, '$1');

  // Convert lists before emphasis stripping, so we don't accidentally mangle list markers.
  out = sanitizeLists(out);

  // Bold / italic markers.
  out = out.replace(STRONG_RE, '$2');
  out = out.replace(ITALIC_RE, (_m, pre: string, _marker: string, content: string) => `${pre}${content}`);

  out = normalizePlainText(out);

  return out.trim();
}
