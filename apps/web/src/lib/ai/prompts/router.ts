import { Socio } from '@/lib/repo/types';
import {
  InteractionMode,
  SocioProgress,
  RouterResult,
  CheckinState,
  ReteachState,
  MentorSession,
} from './types';

// ─── Mode Router ────────────────────────────────────────────────────
// Inspects the socio's state and returns the correct InteractionMode.
// Key principle: your code decides the mode, not the AI.
//
// Future: the progress/checkin/reteach/mentor lookups will come from
// the database. For now, we default to FREEFORM_QUESTION since the
// lesson and check-in infrastructure isn't built yet.

export async function determineMode(
  socio: Socio,
  progress?: SocioProgress,
  _options?: {
    activeCheckin?: CheckinState;
    activeReteach?: ReteachState;
    activeMentorSession?: MentorSession;
  },
): Promise<RouterResult> {
  const options = _options ?? {};

  // 1. Mentor session takes highest priority
  if (options.activeMentorSession) {
    return {
      mode: InteractionMode.MENTOR_HANDOFF,
      mentor: options.activeMentorSession,
    };
  }

  // 2. Active reteach session
  if (options.activeReteach) {
    return {
      mode: InteractionMode.RETEACH,
      reteach: options.activeReteach,
    };
  }

  // 3. Active check-in
  if (options.activeCheckin) {
    return {
      mode: InteractionMode.CHECKIN,
      checkin: options.activeCheckin,
    };
  }

  // 4. No progress tracking yet → default to freeform
  // Future: check if there's an active lesson delivery, reminder, etc.
  return {
    mode: InteractionMode.FREEFORM_QUESTION,
  };
}

// ─── Score Parser ───────────────────────────────────────────────────
// Parses Spanish-aware numeric scores from socio responses.
// Handles: "7", "7/10", "siete", "ocho de diez", etc.

const SPANISH_NUMBERS: Record<string, number> = {
  uno: 1, una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

export function parseScore(text: string): number | null {
  const cleaned = text.trim().toLowerCase();

  // "7/10" or "7 de 10"
  const slashMatch = cleaned.match(/(\d{1,2})\s*(?:\/|de)\s*10/);
  if (slashMatch) {
    const n = parseInt(slashMatch[1], 10);
    if (n >= 1 && n <= 10) return n;
  }

  // Plain number: "7"
  const numMatch = cleaned.match(/^(\d{1,2})$/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= 10) return n;
  }

  // Spanish word: "siete"
  for (const [word, value] of Object.entries(SPANISH_NUMBERS)) {
    if (cleaned.includes(word)) return value;
  }

  return null;
}
