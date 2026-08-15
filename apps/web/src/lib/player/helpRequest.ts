/**
 * "Request help from a human" — the learner-initiated flag
 * ═══════════════════════════════════════════════════════════════════════════
 * Every other flag in this system is an inference. Sentiment scores cross a
 * threshold, a model emits an `[ESCALATE]` marker, progress stalls — something
 * decides, on a learner's behalf, that they might be struggling. This is the
 * one path where the learner says it themselves, and that provenance is the
 * whole point: it is not noisier than a sentiment score, it is categorically
 * more reliable than one, and the mentor surface treats it accordingly.
 *
 * Three things follow from that and are load-bearing:
 *
 *   1. `source: 'learner_request'` and `reasonCode: 'help.requested'` are new
 *      rather than reused. `escalation.requested` is the closest existing code
 *      but means something different — the *model* judged that chat prose
 *      amounted to asking for a mentor. Collapsing the two would make "did a
 *      human actually press the button" unanswerable after the fact.
 *
 *   2. Dedup is the rate limit. A learner hammering the button must not create
 *      ten cards, but the presses are still signal, so repeats land on
 *      `occurrenceCount` / `lastOccurredAt` instead of being dropped. Those two
 *      columns shipped with the flag lifecycle and had no writer until now.
 *
 *   3. Context is captured at press time. Which lesson, which block, which
 *      project — none of it is recoverable afterwards, because the learner will
 *      have moved on by the time a mentor opens the card.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { repo } from "@/lib/repo";
import type { FlagReasonParams, SocioFlag } from "@/lib/repo/types";
import { getCurrentLearnerProject } from "./learnerProject";
import { PlayerError, type PlayerAccess } from "./service";

/**
 * The learner's message is optional and unvalidated beyond length.
 *
 * Submitting an empty box is a complete request — "I need help" is fully
 * expressed by the press itself, and demanding a sentence from someone who is
 * already stuck is the wrong tax to levy. The max is applied by the caller
 * using the course's configured cap.
 */
export const helpRequestPostSchema = z.object({
  message: z.string().trim().max(4_000).optional(),
  lessonKey: z.string().trim().min(1).max(200).optional(),
  blockId: z.string().trim().min(1).max(200).optional(),
});

export type HelpRequestBody = z.infer<typeof helpRequestPostSchema>;

export type HelpRequestResult =
  /** A new flag was written and is now on the mentor surface. */
  | { status: "created"; flagId: string; occurrenceCount: number }
  /** One was already open; this press bumped its occurrence count instead. */
  | { status: "already_open"; flagId: string; occurrenceCount: number };

/**
 * The open learner-requested flag for this learner in this course, if any.
 *
 * Pure over a flag list so the dedup rule is testable without a database. The
 * caller passes `repo.getActiveFlags`, which has already applied
 * `activeFlagWhere` — so "active" here means exactly what it means everywhere
 * else, including the subtlety that ACKNOWLEDGED still counts and an expired
 * snooze does not. A mentor who acknowledged a request but has not resolved it
 * should not receive a second card when the learner presses again.
 *
 * `SocioFlag` has no course column, so the course lives in `reasonParams` and
 * this match is how "per learner per course" is expressed. A legacy row with no
 * `collectionKey` cannot be attributed to a course and so never matches — it
 * will not block a new request.
 */
export function findOpenHelpRequest(
  activeFlags: readonly SocioFlag[],
  collectionKey: string,
): SocioFlag | null {
  return activeFlags.find((flag) => {
    if (flag.reasonCode !== "help.requested") return false;
    const params = flag.reasonParams as FlagReasonParams | null;
    return params?.collectionKey === collectionKey;
  }) ?? null;
}

/**
 * Fallback `reason` text.
 *
 * The rendered mentor-facing line comes from `reasonCode` through the dashboard
 * i18n table, so this column is only read by legacy surfaces that predate
 * reason codes. Same posture as the sentiment pipeline's `fallbackReason`.
 */
function fallbackReason(message: string | undefined, lessonKey: string | undefined): string {
  const where = lessonKey ? ` (${lessonKey})` : "";
  return message
    ? `Learner requested human help${where}: ${message}`
    : `Learner requested human help${where}`;
}

/**
 * Raises — or re-registers — this learner's request to talk to a human.
 *
 * Never throws for the duplicate case: pressing twice is a thing learners do,
 * not an error, and the caller turns `already_open` into reassurance rather
 * than a failure.
 */
export async function requestHelp(
  access: PlayerAccess,
  body: HelpRequestBody,
  now: Date = new Date(),
): Promise<HelpRequestResult> {
  const config = access.config.helpRequest;
  if (!config?.enabled) {
    throw new PlayerError(
      404,
      "help_request_not_configured",
      "This course does not offer help requests",
    );
  }

  const message = body.message?.slice(0, config.maxMessageLength).trim() || undefined;

  // Dedup before doing any other work. The project lookup below is a second
  // query and there is no reason to pay for it on a repeat press.
  const active = await repo.getActiveFlags(access.socioId);
  const open = findOpenHelpRequest(active, access.collectionKey);
  if (open) {
    const bumped = await repo.recordFlagOccurrence(open.id, now);
    return {
      status: "already_open",
      flagId: bumped.id,
      occurrenceCount: bumped.occurrenceCount,
    };
  }

  // Best-effort: a learner in a course with no project selection has none, and
  // a failure to read one must not cost them their request for help.
  let projectTitle: string | undefined;
  try {
    projectTitle = (await getCurrentLearnerProject(access))?.title ?? undefined;
  } catch (error) {
    console.warn("[HelpRequest] project title lookup failed; continuing without it", error);
  }

  const reasonParams: FlagReasonParams = {
    collectionKey: access.collectionKey,
    ...(message ? { requestReason: message } : {}),
    ...(body.lessonKey ? { lessonKey: body.lessonKey } : {}),
    ...(body.blockId ? { blockId: body.blockId } : {}),
    ...(projectTitle ? { projectTitle } : {}),
  };

  const flag = await repo.createFlag({
    socioId: access.socioId,
    // RED: a person asked for a person. Zone assignment routes it away from the
    // inferred-signal zones regardless, so this level does not put them in
    // "Needs you now" — it is what health and the legacy flag surfaces read.
    level: "RED",
    reason: fallbackReason(message, body.lessonKey),
    reasonCode: "help.requested",
    reasonParams,
    source: "learner_request",
  });

  return { status: "created", flagId: flag.id, occurrenceCount: flag.occurrenceCount };
}
