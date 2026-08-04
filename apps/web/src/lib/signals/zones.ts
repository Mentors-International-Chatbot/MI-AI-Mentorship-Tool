/**
 * Alert zones — group by person, not by signal
 * ═══════════════════════════════════════════════════════════════════════════
 * 43 unresolved red flags across the platform concentrate into 3 socios. That
 * is the insight the page exists to deliver: it is not 43 problems, it is three
 * people in trouble and forty signals about them. A flat list of flags hides
 * that completely, so everything here groups by socio first.
 *
 * Severity is not re-derived. `computeHealthFromData` already decides whether a
 * socio is RED or YELLOW and why; this module reads that verdict and sorts.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { SocioHealth } from '@/lib/health';
import type { PositiveSignal } from './positive';

/**
 * Zone 2 is "Watching", never "AI is handling".
 *
 * The AI is not handling anything here. It sees a one-turn-lagged
 * comprehension/confusion EMA via `buildDimensionContext` and nothing else —
 * `SocioFlag` has zero read paths in any prompt layer, and the sentiment
 * analyzer's output is written fire-and-forget with its return value discarded.
 * The flags that put a socio in this zone (urgency, distress, frustration,
 * `[FLAG]` markers) never reach the model generating the next turn, and the
 * dimension map carries no counterpart to any of them.
 *
 * Making the AI handle a first pass is a feature to build, not a label to
 * apply. Until that feature exists, this zone means a human is watching.
 */
export type ZoneKey = 'needs_you_now' | 'watching' | 'good_news';

/** The unresolved-flag fields zone assignment actually reads. */
export type ZoneFlagInput = {
  level: string;
  resolved: boolean;
  reason: string;
  createdAt: Date;
};

/** One socio's worth of input. Structurally satisfied by the dashboard's rows. */
export type ZoneSocioInput = {
  socioId: string;
  name: string | null;
  curriculumCollectionKey: string | null;
  currentLesson: number;
  health: SocioHealth;
  flags: readonly ZoneFlagInput[];
};

/** A socio card in zone 1 or zone 2. */
export type ZoneSocio = {
  socioId: string;
  name: string | null;
  curriculumCollectionKey: string | null;
  currentLesson: number;
  health: SocioHealth;
  /**
   * Unresolved flags for this socio. This is the number that makes triage
   * legible — "Ana — 14 signals" is the sentence that sells the page.
   */
  signalCount: number;
  unresolvedRed: number;
  unresolvedYellow: number;
  /**
   * Free text written by the flag pipeline at detection time, newest first.
   * Data rather than chrome — rendered verbatim, like a course name, and so not
   * routed through DASHBOARD_STRINGS.
   */
  flagReasons: string[];
  /** Newest unresolved flag, used for sorting. Null only if flags is empty. */
  mostRecentSignalAt: Date | null;
};

export type AlertZones = {
  needsYouNow: ZoneSocio[];
  watching: ZoneSocio[];
  goodNews: PositiveSignal[];
};

/**
 * Which of zones 1 and 2 a socio belongs to, or null for neither.
 *
 * Red wins outright: a socio with both an unresolved red and an unresolved
 * yellow flag appears in zone 1 only. Showing them twice would split a single
 * person's story across two panels and inflate both counts.
 */
export function assignZone(flags: readonly ZoneFlagInput[]): 'needs_you_now' | 'watching' | null {
  const unresolved = flags.filter((f) => !f.resolved);
  if (unresolved.some((f) => f.level === 'RED')) return 'needs_you_now';
  if (unresolved.some((f) => f.level === 'YELLOW')) return 'watching';
  return null;
}

function toZoneSocio(input: ZoneSocioInput): ZoneSocio {
  const unresolved = [...input.flags]
    .filter((f) => !f.resolved)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    socioId: input.socioId,
    name: input.name,
    curriculumCollectionKey: input.curriculumCollectionKey,
    currentLesson: input.currentLesson,
    health: input.health,
    signalCount: unresolved.length,
    unresolvedRed: unresolved.filter((f) => f.level === 'RED').length,
    unresolvedYellow: unresolved.filter((f) => f.level === 'YELLOW').length,
    flagReasons: unresolved.map((f) => f.reason),
    mostRecentSignalAt: unresolved[0]?.createdAt ?? null,
  };
}

/** Newest signal first; a socio with no timestamp sorts last. */
function byMostRecentSignal(a: ZoneSocio, b: ZoneSocio): number {
  const at = a.mostRecentSignalAt?.getTime() ?? -Infinity;
  const bt = b.mostRecentSignalAt?.getTime() ?? -Infinity;
  return bt - at;
}

/**
 * Splits socios into zones 1 and 2 and attaches the derived positives as zone 3.
 *
 * A socio can appear in zone 3 *and* in zone 1 or 2. That overlap is
 * deliberate: someone can pass a teach-back gate on the first try and still be
 * in crisis about something else, and suppressing the good news to keep the
 * zones disjoint would hide a true fact about a person a mentor is about to
 * call.
 */
export function buildAlertZones(
  socios: readonly ZoneSocioInput[],
  positives: readonly PositiveSignal[],
): AlertZones {
  const needsYouNow: ZoneSocio[] = [];
  const watching: ZoneSocio[] = [];

  for (const input of socios) {
    const zone = assignZone(input.flags);
    if (zone === 'needs_you_now') needsYouNow.push(toZoneSocio(input));
    else if (zone === 'watching') watching.push(toZoneSocio(input));
  }

  needsYouNow.sort(byMostRecentSignal);
  watching.sort(byMostRecentSignal);

  return { needsYouNow, watching, goodNews: [...positives] };
}
