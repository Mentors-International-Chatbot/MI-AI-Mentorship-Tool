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
import type { DashboardPanel, LocalizedString } from '@/lib/journey-package/journey-package.schema';
import type { AssessmentScoreRow } from './AssessmentScoresPanel';
import type { DimensionTrendPoint } from './DimensionTrendPanel';
import type { RevenueChartPoint } from './RevenueChart';

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
