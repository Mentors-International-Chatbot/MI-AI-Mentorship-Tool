/**
 * Per-turn gate-session loader
 * ═══════════════════════════════════════════════════════════════════════════
 * Two places read the same assessment sessions on the same turn, to ask two
 * different questions of them:
 *
 *   `router.checkGatePosition`        — may the learner progress past this gate?
 *   `stance.hasPassedCurrentLessonGates` — have they demonstrated knowledge?
 *
 * Those questions have deliberately different answers. A completed-but-failed
 * session clears progression (you do not get trapped forever by one bad
 * teach-back) but does not count as passing (`passedAt !== null` is the pass
 * fact). That distinction is load-bearing and documented at both call sites.
 *
 * What is NOT different is the rows. Before this loader each site issued its
 * own query per gate, so a lesson with two gates cost four round trips per turn
 * to fetch two result sets twice.
 *
 * The loader memoizes the in-flight promise rather than the resolved value, so
 * concurrent callers share one query too. It is deliberately scoped to a single
 * turn — construct one in the router, let it fall out of scope after. Caching
 * assessment sessions across turns would be wrong: passing a gate is exactly
 * the event the next turn needs to see.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { repo } from '@/lib/repo';
import type { AssessmentSession } from '@/lib/repo/tenantRepo.types';

/** Fetches a gate's sessions, at most once per turn per gate. */
export type GateSessionLoader = (
  lessonKey: string,
  blockId: string,
) => Promise<AssessmentSession[]>;

export function createGateSessionLoader(socioId: string): GateSessionLoader {
  const inFlight = new Map<string, Promise<AssessmentSession[]>>();

  return (lessonKey: string, blockId: string) => {
    const key = `${lessonKey}|${blockId}`;
    let pending = inFlight.get(key);
    if (!pending) {
      // The repo method is optional on the interface, and inMemoryRepo returns
      // an empty list. Treat an absent method as "no sessions", which is what
      // both call sites already did via `?.` plus a nullish fallback.
      pending = repo.getAssessmentSessionsForSocioLesson
        ? repo.getAssessmentSessionsForSocioLesson(socioId, lessonKey, blockId)
        : Promise.resolve([]);
      inFlight.set(key, pending);
    }
    return pending;
  };
}
