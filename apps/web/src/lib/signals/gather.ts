/**
 * Fetches the raw material the positive-signal derivations read.
 * ═══════════════════════════════════════════════════════════════════════════
 * Kept separate from `positive.ts` so the derivations stay pure and testable
 * without a database. This module is the only part of the signal layer that
 * touches the repo.
 *
 * Windowed at the fetch boundary where the source supports it: sentiments are
 * asked for by `since`, so the widest window any derivation uses bounds the
 * query rather than the derivation filtering a full history in memory.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { repo, tenantRepo } from '@/lib/repo';
import type { TenantContext } from '@/lib/repo/tenantContext';
import { SUSTAINED_POSITIVE_WINDOW_DAYS, type PositiveSignalSource } from './positive';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Assembles one {@link PositiveSignalSource} per socio.
 *
 * Fan-out is per socio and concurrent. That is fine at a mentor's caseload —
 * tens of socios, four small queries each — but it is a fan-out, so this
 * belongs on a mentor-scoped page and not on an org-wide one without batching.
 *
 * @param ctx - Tenant context; assessment sessions are org-scoped
 * @param socioIds - Socios in scope for the viewing mentor
 * @param now - Injected so the sentiment window matches the derivation's
 */
export async function gatherPositiveSignalSources(
  ctx: TenantContext,
  socioIds: readonly string[],
  now: Date = new Date(),
): Promise<PositiveSignalSource[]> {
  const sentimentSince = new Date(now.getTime() - SUSTAINED_POSITIVE_WINDOW_DAYS * MS_PER_DAY);

  return Promise.all(
    socioIds.map(async (socioId) => {
      const [assessmentSessions, lessonProgress, userMessageDates, sentiments] = await Promise.all([
        tenantRepo.getAssessmentSessionsForSocio(ctx, socioId),
        repo.getLessonProgressAll(socioId),
        repo.getUserMessageDates(socioId),
        repo.getSentimentsBySocio(socioId, sentimentSince),
      ]);

      return {
        socioId,
        assessmentSessions: assessmentSessions.map((s) => ({
          lessonKey: s.lessonKey,
          attemptNumber: s.attemptNumber,
          passedAt: s.passedAt,
        })),
        lessonProgress: lessonProgress.map((p) => ({
          lessonNumber: p.lessonNumber,
          completedAt: p.completedAt,
        })),
        userMessageDates,
        sentiments: sentiments.map((s) => ({
          sentiment: s.sentiment,
          createdAt: s.createdAt,
        })),
      };
    }),
  );
}
