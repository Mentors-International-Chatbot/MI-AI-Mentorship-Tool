/**
 * Loads the data behind each configured dashboard panel.
 *
 * Only the declared panels are queried — a course that shows no revenue never
 * reads FinancialSnapshot, and a course with no trends never touches the metric
 * pipeline. Panels resolve independently so one failing data source degrades to
 * an empty panel instead of a blank page.
 */
import { repo } from '@/lib/repo';
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { createTenantContext, type TenantContext } from '@/lib/repo/tenantContext';
import { lessonSchema, type DashboardPanel, type LocalizedString, type ParsedLessonBlock } from '@/lib/journey-package/journey-package.schema';
import type { AssessmentScoreRow } from './AssessmentScoresPanel';
import type { DimensionTrendPoint } from './DimensionTrendPanel';
import type { RevenueChartPoint } from './RevenueChart';
import { buildActivityStrip, type ActivityStripData } from './blockActivity';
import { buildBlockAnswers, type AnsweredBlock } from './blockAnswers';

export type SerializedLessonProgress = {
  id: string;
  lessonNumber: number;
  understanding: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SerializedSummary = {
  id: string;
  weekStartDate: string;
  content: string;
  flags: {
    risks: string[];
    achievements: string[];
    recommendedAction: string;
    overallHealth: 'green' | 'yellow' | 'red';
  } | null;
  metrics: {
    messageCount: number;
    lessonsCompleted: number;
    avgConfusion: number;
    avgFrustration: number;
    currentLesson: number;
    activeFlagCount: number;
  } | null;
  createdAt: string;
};

export type ResolvedPanel =
  | { type: 'lesson_progress'; title?: LocalizedString; lessonProgress: SerializedLessonProgress[] }
  | { type: 'assessment_scores'; title?: LocalizedString; rows: AssessmentScoreRow[] }
  | { type: 'weekly_summary'; title?: LocalizedString; summaries: SerializedSummary[] }
  | { type: 'financial_snapshots'; title?: LocalizedString; points: RevenueChartPoint[] }
  | {
      type: 'dimension_trend';
      title?: LocalizedString;
      dimensionKey: string;
      /** MetricDefinition.name — the human label when the panel declares no title. */
      label: string;
      scale: { min: number; max: number };
      points: DimensionTrendPoint[];
    };

const DEFAULT_SCALE = { min: 0, max: 10 };

/** Observations for one dimension, across every enrollment this participant has. */
async function loadDimensionTrend(
  ctx: TenantContext,
  socioId: string,
  dimensionKey: string,
): Promise<{ label: string; scale: { min: number; max: number }; points: DimensionTrendPoint[] } | null> {
  const definition = await tenantPrismaRepo.getMetricDefinitionByKey(ctx, dimensionKey);
  if (!definition) return null;

  const participant = await tenantPrismaRepo.getParticipantBySocioId(ctx, socioId);
  if (!participant) return null;

  const enrollments = await tenantPrismaRepo.getEnrollmentsByParticipant(ctx, participant.id);
  if (enrollments.length === 0) return null;

  const perEnrollment = await Promise.all(
    enrollments.map((e) =>
      tenantPrismaRepo.getObservations(ctx, definition.id, { enrollmentId: e.id }),
    ),
  );

  const points = perEnrollment
    .flat()
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())
    .map((o) => ({
      id: o.id,
      value: o.value,
      observedAt: o.observedAt.toISOString(),
    }));

  const rawScale = definition.scale as { min?: number; max?: number } | null;
  const scale =
    typeof rawScale?.min === 'number' && typeof rawScale?.max === 'number'
      ? { min: rawScale.min, max: rawScale.max }
      : DEFAULT_SCALE;

  return { label: definition.name || dimensionKey, scale, points };
}

/** Gating-dimension score for a finished session, when one was recorded. */
function gatingScore(scores: unknown): number | null {
  if (!scores || typeof scores !== 'object') return null;
  const values = Object.values(scores as Record<string, unknown>).filter(
    (v): v is number => typeof v === 'number',
  );
  if (values.length === 0) return null;
  return values[0];
}

export async function loadPanelData(
  socioId: string,
  organizationId: string,
  panels: readonly DashboardPanel[],
): Promise<ResolvedPanel[]> {
  // Only built when a panel actually needs tenant-scoped data.
  let ctx: TenantContext | null = null;
  const needsTenantCtx = panels.some(
    (p) => p.type === 'dimension_trend' || p.type === 'assessment_scores',
  );
  if (needsTenantCtx) {
    ctx = createTenantContext(organizationId);
  }

  const resolved = await Promise.all(
    panels.map(async (panel): Promise<ResolvedPanel | null> => {
      try {
        switch (panel.type) {
          case 'lesson_progress': {
            const rows = await repo.getLessonProgressAll(socioId);
            return {
              type: 'lesson_progress',
              title: panel.title,
              lessonProgress: rows.map((lp) => ({
                ...lp,
                completedAt: lp.completedAt?.toISOString() ?? null,
                createdAt: lp.createdAt.toISOString(),
                updatedAt: lp.updatedAt.toISOString(),
              })),
            };
          }

          case 'assessment_scores': {
            if (!ctx) return null;
            const sessions = await tenantPrismaRepo.getAssessmentSessionsForSocio(ctx, socioId);
            const rows: AssessmentScoreRow[] = sessions
              .map((s) => ({
                id: s.id,
                lessonKey: s.lessonKey,
                status: String(s.status),
                attemptNumber: s.attemptNumber,
                passed: s.passedAt != null,
                score: gatingScore(s.scores),
                completedAt: s.completedAt?.toISOString() ?? null,
              }))
              .sort((a, b) => a.lessonKey.localeCompare(b.lessonKey));
            return { type: 'assessment_scores', title: panel.title, rows };
          }

          case 'weekly_summary': {
            const summaries = await repo.getSummaries(socioId, 8);
            return {
              type: 'weekly_summary',
              title: panel.title,
              summaries: summaries.map((s) => ({
                id: s.id,
                weekStartDate: s.weekStartDate.toISOString(),
                content: s.content,
                flags: s.flags as SerializedSummary['flags'],
                metrics: s.metrics as SerializedSummary['metrics'],
                createdAt: s.createdAt.toISOString(),
              })),
            };
          }

          case 'financial_snapshots': {
            const snapshots = await repo.getFinancialSnapshots(socioId, 20);
            return {
              type: 'financial_snapshots',
              title: panel.title,
              // Repo returns newest-first; the chart reads left-to-right in time.
              points: [...snapshots].reverse().map((f) => ({
                id: f.id,
                revenue: f.revenue,
                netProfit: f.netProfit,
                weekStartDate: f.weekStartDate.toISOString(),
              })),
            };
          }

          case 'dimension_trend': {
            if (!ctx) return null;
            const trend = await loadDimensionTrend(ctx, socioId, panel.dimensionKey);
            if (!trend) return null;
            return {
              type: 'dimension_trend',
              title: panel.title,
              dimensionKey: panel.dimensionKey,
              label: trend.label,
              scale: trend.scale,
              points: trend.points,
            };
          }
        }
      } catch {
        // A panel that cannot load its data is dropped, not fatal.
        return null;
      }
    }),
  );

  return resolved.filter((p): p is ResolvedPanel => p !== null);
}

/**
 * Block-activity strip: the read-only counterpart to `getMessages` for
 * player-surface courses, where most learner activity lands in BlockProgress
 * rather than a chat turn (see the mentor learner-detail activity strip).
 * Additive only — this never touches what gets persisted.
 *
 * Mirrors resolvePlayerAccess's tie-break (most recently enrolled ACTIVE
 * enrollment) rather than introducing a new one. A learner with two active
 * enrollments only gets one course's activity shown here; that's an accepted
 * simplification, not a data gap — see the ticket that added this panel.
 */
export async function loadActivityStrip(
  socioId: string,
  organizationId: string,
): Promise<ActivityStripData> {
  try {
    const ctx = createTenantContext(organizationId);

    const participant = await tenantPrismaRepo.getParticipantBySocioId(ctx, socioId);
    if (!participant) return null;

    const enrollments = await tenantPrismaRepo.getEnrollmentsByParticipant(ctx, participant.id);
    const enrollment = enrollments.find((e) => e.status === 'active' && e.collectionKey);
    if (!enrollment || !enrollment.collectionKey) return null;

    const rows = await tenantPrismaRepo.getBlockProgressForEnrollment(ctx, enrollment.id);
    if (rows.length === 0) return null;

    const lessonKeys = [...new Set(rows.map((r) => r.lessonKey))];
    const lessonTotals = new Map<string, number | null>();
    await Promise.all(
      lessonKeys.map(async (lessonKey) => {
        try {
          const version = await tenantPrismaRepo.getActiveLessonVersionBySlug(
            ctx,
            enrollment.collectionKey!,
            lessonKey,
          );
          const parsed = version ? lessonSchema.safeParse(version.body) : null;
          lessonTotals.set(lessonKey, parsed?.success ? parsed.data.blocks.length : null);
        } catch {
          lessonTotals.set(lessonKey, null);
        }
      }),
    );

    return buildActivityStrip(
      rows
        .filter((r): r is typeof r & { completedAt: Date } => r.completedAt !== null)
        .map((r) => ({ lessonKey: r.lessonKey, blockId: r.blockId, completedAt: r.completedAt })),
      lessonTotals,
    );
  } catch {
    // A panel that cannot load its data is dropped, not fatal.
    return null;
  }
}

/**
 * The learner's actual answers to quiz_checkpoint, drag_order, and
 * onboarding_survey blocks — the "written tests" a mentor could not see
 * before, since those three block types never post through `/api/chat` and
 * so never produce a `Message` row (see blockAnswers.ts's docblock).
 *
 * Same enrollment tie-break and same-lesson-content lookup as
 * `loadActivityStrip`, deliberately not merged with it: that one only ever
 * needs a block *count* per lesson, this one needs the full block bodies
 * (questions, items, correct answers) to render the answers meaningfully.
 */
export async function loadBlockAnswers(
  socioId: string,
  organizationId: string,
): Promise<AnsweredBlock[]> {
  try {
    const ctx = createTenantContext(organizationId);

    const participant = await tenantPrismaRepo.getParticipantBySocioId(ctx, socioId);
    if (!participant) return [];

    const enrollments = await tenantPrismaRepo.getEnrollmentsByParticipant(ctx, participant.id);
    const enrollment = enrollments.find((e) => e.status === 'active' && e.collectionKey);
    if (!enrollment || !enrollment.collectionKey) return [];

    const rows = await tenantPrismaRepo.getBlockProgressForEnrollment(ctx, enrollment.id);
    if (rows.length === 0) return [];

    const lessonKeys = [...new Set(rows.map((r) => r.lessonKey))];
    const blocksByKey = new Map<string, ParsedLessonBlock>();
    await Promise.all(
      lessonKeys.map(async (lessonKey) => {
        try {
          const version = await tenantPrismaRepo.getActiveLessonVersionBySlug(
            ctx,
            enrollment.collectionKey!,
            lessonKey,
          );
          const parsed = version ? lessonSchema.safeParse(version.body) : null;
          if (!parsed?.success) return;
          for (const block of parsed.data.blocks) blocksByKey.set(`${lessonKey}:${block.id}`, block);
        } catch {
          // Skip this lesson's content; its rows are simply dropped by
          // buildBlockAnswers below (no entry in blocksByKey).
        }
      }),
    );

    return buildBlockAnswers(
      rows
        .filter((r): r is typeof r & { completedAt: Date } => r.completedAt !== null)
        .map((r) => ({ lessonKey: r.lessonKey, blockId: r.blockId, response: r.response, completedAt: r.completedAt })),
      blocksByKey,
    );
  } catch {
    // A panel that cannot load its data is dropped, not fatal.
    return [];
  }
}
