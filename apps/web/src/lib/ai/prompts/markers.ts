import { ParsedMarkers } from './types';

// ─── Marker Parser ──────────────────────────────────────────────────
// Strips [FLAG:RED|reason], [LESSON_COMPLETE:3], [MILESTONE:key] and [ESCALATE|reason]
// markers from AI responses before sending to WhatsApp, and returns
// structured data for the backend to process.
// One API call does double duty — no second call needed for analysis.

const FLAG_PATTERN = /\[FLAG:(RED|YELLOW)\|([^\]]+)\]/g;
const LESSON_COMPLETE_PATTERN = /\[LESSON_COMPLETE:(\d+)\]/g;
const ESCALATE_PATTERN = /\[ESCALATE\|([^\]]+)\]/g;
const FINANCIAL_PATTERN = /\[FINANCIAL:revenue=(-?\d+(?:\.\d+)?),netProfit=(-?\d+(?:\.\d+)?)\]/g;
// Milestone keys are the package's own `key` regex: lowercase, digits, hyphens.
// Kept narrow so a hallucinated free-text key cannot create a progress row.
const MILESTONE_PATTERN = /\[MILESTONE:([a-z0-9][a-z0-9-]*)\]/g;
// Providers sometimes echo drafting sentinels or malformed backend markers.
// Keep this prefix-scoped so ordinary bracketed domain terms such as [SKU]
// remain prose. Normalize chrome in the one existing marker boundary rather
// than introducing a player-only sanitizer or truncating the response.
const DRAFT_CHROME_PATTERN = /\[(?:(?:FLAG|LESSON|MILESTONE|ESCALATE|FINANCIAL|END|DRAFT|RESPONSE|ANSWER|FINAL|COMPLETE)[A-Z0-9_-]*)(?:[:|][^\]]+)?\]/g;

export function parseMarkers(aiResponse: string): ParsedMarkers {
  const flags: ParsedMarkers['flags'] = [];
  const lessonsCompleted: number[] = [];
  const escalations: string[] = [];
  const financials: ParsedMarkers['financials'] = [];
  const milestones: string[] = [];

  let match: RegExpExecArray | null;

  // Extract flags
  const flagRegex = new RegExp(FLAG_PATTERN.source, 'g');
  while ((match = flagRegex.exec(aiResponse)) !== null) {
    flags.push({
      level: match[1] as 'RED' | 'YELLOW',
      reason: match[2].trim(),
    });
  }

  // Extract lesson completions
  const lessonRegex = new RegExp(LESSON_COMPLETE_PATTERN.source, 'g');
  while ((match = lessonRegex.exec(aiResponse)) !== null) {
    lessonsCompleted.push(parseInt(match[1], 10));
  }

  // Extract escalations
  const escalateRegex = new RegExp(ESCALATE_PATTERN.source, 'g');
  while ((match = escalateRegex.exec(aiResponse)) !== null) {
    escalations.push(match[1].trim());
  }

  // Extract financials
  const financialRegex = new RegExp(FINANCIAL_PATTERN.source, 'g');
  while ((match = financialRegex.exec(aiResponse)) !== null) {
    financials.push({
      revenue: parseFloat(match[1]),
      netProfit: parseFloat(match[2]),
    });
  }

  // Extract milestones reached
  const milestoneRegex = new RegExp(MILESTONE_PATTERN.source, 'g');
  while ((match = milestoneRegex.exec(aiResponse)) !== null) {
    milestones.push(match[1]);
  }

  return {
    cleanText: stripMarkers(aiResponse),
    flags,
    lessonsCompleted,
    escalations,
    financials,
    milestones,
  };
}

/**
 * Removes every marker, leaving only what the socio should read.
 *
 * Split out of `parseMarkers` so the streaming path can strip markers from a
 * partial reply without also re-extracting flags and milestones from it —
 * those must be read once, from the complete text, or a marker straddling two
 * chunks would be counted twice or not at all.
 */
export function stripMarkers(text: string): string {
  return text
    .replace(FLAG_PATTERN, '')
    .replace(LESSON_COMPLETE_PATTERN, '')
    .replace(ESCALATE_PATTERN, '')
    .replace(FINANCIAL_PATTERN, '')
    .replace(MILESTONE_PATTERN, '')
    .replace(DRAFT_CHROME_PATTERN, '')
    .trim();
}

/**
 * Replaces every complete marker with spaces, preserving length and offsets.
 *
 * For the streaming path's structural scan only. Marker bodies are full of
 * characters that mean something in prose — `[LESSON_COMPLETE:2]` contains an
 * underscore, which reads as an unclosed italic and drags the safe-to-emit
 * boundary back into the middle of a marker. Blanking them keeps every index
 * aligned with the original text while making their contents inert.
 */
export function maskMarkers(text: string): string {
  const blank = (m: string) => ' '.repeat(m.length);
  return text
    .replace(FLAG_PATTERN, blank)
    .replace(LESSON_COMPLETE_PATTERN, blank)
    .replace(ESCALATE_PATTERN, blank)
    .replace(FINANCIAL_PATTERN, blank)
    .replace(MILESTONE_PATTERN, blank)
    .replace(DRAFT_CHROME_PATTERN, blank);
}
