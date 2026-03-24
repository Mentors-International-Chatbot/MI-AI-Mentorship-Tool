import { ParsedMarkers } from './types';

// ─── Marker Parser ──────────────────────────────────────────────────
// Strips [FLAG:RED|reason], [LESSON_COMPLETE:3], and [ESCALATE|reason]
// markers from AI responses before sending to WhatsApp, and returns
// structured data for the backend to process.
// One API call does double duty — no second call needed for analysis.

const FLAG_PATTERN = /\[FLAG:(RED|YELLOW)\|([^\]]+)\]/g;
const LESSON_COMPLETE_PATTERN = /\[LESSON_COMPLETE:(\d+)\]/g;
const ESCALATE_PATTERN = /\[ESCALATE\|([^\]]+)\]/g;
const FINANCIAL_PATTERN = /\[FINANCIAL:revenue=(-?\d+(?:\.\d+)?),netProfit=(-?\d+(?:\.\d+)?)\]/g;

export function parseMarkers(aiResponse: string): ParsedMarkers {
  const flags: ParsedMarkers['flags'] = [];
  const lessonsCompleted: number[] = [];
  const escalations: string[] = [];
  const financials: ParsedMarkers['financials'] = [];

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

  // Strip all markers from the text sent to the socio
  const cleanText = aiResponse
    .replace(FLAG_PATTERN, '')
    .replace(LESSON_COMPLETE_PATTERN, '')
    .replace(ESCALATE_PATTERN, '')
    .replace(FINANCIAL_PATTERN, '')
    .trim();

  return { cleanText, flags, lessonsCompleted, escalations, financials };
}
