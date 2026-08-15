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
import { isFlagActive } from '@/lib/flags/active';
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
export type ZoneKey = 'asked_for_you' | 'needs_you_now' | 'watching' | 'good_news';

/**
 * The reason code written by the player's "request help from a human" button.
 *
 * Deliberately matched on `reasonCode` rather than `source`. `source` says who
 * wrote the row; this zone is about what the learner *did*, and a future
 * learner-initiated signal that is not a help request should not silently
 * inherit this zone's placement at the top of the page.
 */
export const HELP_REQUEST_REASON_CODE = 'help.requested';

/** The flag fields zone assignment actually reads. */
export type ZoneFlagInput = {
  level: string;
  resolved: boolean;
  status: string;
  snoozedUntil: Date | null;
  reason: string;
  createdAt: Date;
  /** Null on every flag written before reason codes existed. */
  reasonCode?: string | null;
  /** `SocioFlag.reasonParams`; read only for help-request context. */
  reasonParams?: Record<string, unknown> | null;
  /** Bumped on a repeat press rather than creating a second flag. */
  occurrenceCount?: number;
  lastOccurredAt?: Date | null;
};

export function isHelpRequest(flag: ZoneFlagInput): boolean {
  return flag.reasonCode === HELP_REQUEST_REASON_CODE;
}

/** One socio's worth of input. Structurally satisfied by the dashboard's rows. */
export type ZoneSocioInput = {
  socioId: string;
  name: string | null;
  curriculumCollectionKey: string | null;
  currentLesson: number;
  health: SocioHealth;
  flags: readonly ZoneFlagInput[];
  /** No mentor owns this learner. Only zone 0 reads it; see {@link HelpRequest}. */
  unassigned?: boolean;
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

/**
 * One learner who pressed the button, with what they said and where they were.
 *
 * Flat rather than a `ZoneSocio`, because this zone is not a health verdict.
 * Zones 1 and 2 answer "how worried should I be about this person", derived
 * from signals about them. This one answers "this person asked to talk to
 * you" — there is nothing to derive, so nothing here is computed.
 */
export type HelpRequest = {
  socioId: string;
  name: string | null;
  curriculumCollectionKey: string | null;
  /** The learner's own words. Null when they submitted the box empty. */
  message: string | null;
  lessonKey: string | null;
  blockId: string | null;
  projectTitle: string | null;
  askedAt: Date;
  /** >1 when they pressed again while the request was still open. */
  occurrenceCount: number;
  /** Newest press. Null when they have only asked once. */
  lastAskedAt: Date | null;
  /**
   * True when no mentor owns this learner.
   *
   * Learners provisioned through Canvas never get a `mentorId` — LTI
   * provisioning does not set one and nothing else does. Scoping this zone to
   * the viewer's own caseload would therefore drop their request silently,
   * which is the one outcome the button must not produce, having just told them
   * a human would follow up. So the zone reads org-wide and marks the ones that
   * are nobody's, rather than showing them to nobody.
   */
  unassigned: boolean;
};

export type AlertZones = {
  askedForYou: HelpRequest[];
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
 *
 * Help requests are excluded before either test. They are RED — a person asking
 * for a person is not a low-priority event — but they are self-reported, and
 * the zone they belong in is the one above these two. Leaving them in here
 * would put a learner whose only signal is "I pressed the button" into a panel
 * headed by inferred sentiment, which is exactly the competition for attention
 * this split exists to prevent. A learner with a help request *and* real
 * inferred signals still appears in both zones, matching the deliberate zone-3
 * overlap: suppressing one to keep the panels disjoint would hide a true fact.
 */
export function assignZone(
  flags: readonly ZoneFlagInput[],
  now: Date = new Date(),
): 'needs_you_now' | 'watching' | null {
  const active = flags.filter((f) => isFlagActive(f, now) && !isHelpRequest(f));
  if (active.some((f) => f.level === 'RED')) return 'needs_you_now';
  if (active.some((f) => f.level === 'YELLOW')) return 'watching';
  return null;
}

function readString(params: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = params?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Extracts the open help requests from a set of socios.
 *
 * Newest first — unlike zones 1 and 2, which sort by most recent *signal*, this
 * sorts by when the person asked. Someone who has been waiting since Tuesday
 * outranks someone who asked this morning, so the tiebreak is deliberately the
 * original ask and not the most recent re-press.
 */
export function collectHelpRequests(
  socios: readonly ZoneSocioInput[],
  now: Date = new Date(),
): HelpRequest[] {
  const requests: HelpRequest[] = [];

  for (const input of socios) {
    for (const flag of input.flags) {
      if (!isHelpRequest(flag) || !isFlagActive(flag, now)) continue;
      const params = flag.reasonParams ?? null;
      requests.push({
        socioId: input.socioId,
        name: input.name,
        curriculumCollectionKey: input.curriculumCollectionKey,
        message: readString(params, 'requestReason'),
        lessonKey: readString(params, 'lessonKey'),
        blockId: readString(params, 'blockId'),
        projectTitle: readString(params, 'projectTitle'),
        askedAt: flag.createdAt,
        occurrenceCount: flag.occurrenceCount ?? 1,
        lastAskedAt: flag.lastOccurredAt ?? null,
        unassigned: input.unassigned ?? false,
      });
    }
  }

  return requests.sort((a, b) => a.askedAt.getTime() - b.askedAt.getTime());
}

function toZoneSocio(input: ZoneSocioInput): ZoneSocio {
  // Same exclusion as `assignZone`, for the same reason and necessarily in
  // step with it: a help request must not inflate "Ana — 14 signals" when it is
  // already its own card in the zone above.
  const unresolved = [...input.flags]
    .filter((f) => isFlagActive(f) && !isHelpRequest(f))
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
 * call. Zone 0 overlaps for the same reason.
 *
 * `helpSocios` is a separate argument rather than a filter over `socios`
 * because the two have different scopes on purpose — zones 1-3 are the viewing
 * mentor's caseload, zone 0 is the whole organization, so that an unassigned
 * learner's request reaches somebody. Passing the same list twice is valid and
 * is what a deployment with every learner assigned would do.
 */
export function buildAlertZones(
  socios: readonly ZoneSocioInput[],
  positives: readonly PositiveSignal[],
  helpSocios: readonly ZoneSocioInput[] = socios,
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

  return {
    askedForYou: collectHelpRequests(helpSocios),
    needsYouNow,
    watching,
    goodNews: [...positives],
  };
}
