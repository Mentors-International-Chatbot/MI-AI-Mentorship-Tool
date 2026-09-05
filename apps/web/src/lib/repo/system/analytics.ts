/**
 * `repo/system/` — the designated home for reads that are genuinely cross-
 * org by nature, not a tenant slice of one. D6/D.4: this is meant to be the
 * only path across org lines, sitting behind `requireSystemAdmin` the same
 * way the tenant-scoped repo sits behind `TenantContext`. First tenant of
 * this namespace, moved out of the route handler it used to live in
 * (`/api/admin/analytics`) without changing its shape or behavior.
 * ═══════════════════════════════════════════════════════════════════════════
 * Every query below is unfiltered by organizationId on purpose — this is the
 * platform-wide rollup, not a per-org one. A per-org version would be a
 * different method (and belongs in the tenant-scoped repo, not here), never
 * a parameter on this one — see D6's "never loosens TenantContext."
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from '@/lib/db';
import { activeFlagWhere } from '@/lib/flags/active';

export type SystemAnalytics = {
  sociosByStatus: { status: string; count: number }[];
  totalSocios: number;
  lessonFunnel: { lessonNumber: number; completedCount: number }[];
  avgUnderstandingByLesson: { lessonNumber: number; avgUnderstanding: number }[];
  activeThisWeek: number;
  activeLastWeek: number;
  flagCounts: { level: string; count: number }[];
  messagesThisWeek: number;
  totalMessages: number;
  avgMessagesPerSocio: number;
  activeSocioCount: number;
  /**
   * "Unanchored" means no ParticipantProfile (socio) or no MentorProfile
   * (mentor) — the tenancy anchor every org-scoped query filters on. A
   * legitimate state (anchoring waits for a real org signal), but invisible
   * by construction otherwise: the socio simply doesn't appear on a
   * dashboard, the mentor simply sees an empty roster. This is the plan's
   * "unanchored-records tile" — the one thing that makes a climbing count
   * visible instead of silent until someone asks where a learner went.
   */
  tenancy: {
    unanchoredSocios: number;
    unanchoredMentors: number;
    whatsappUnanchored: number;
  };
  financialSummary: { weekStartDate: Date; totalRevenue: number; totalNetProfit: number; socioCount: number }[];
};

export async function getSystemAnalytics(): Promise<SystemAnalytics> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);

  const [
    sociosByStatus,
    totalSocios,
    lessonFunnel,
    avgUnderstandingByLesson,
    activeThisWeek,
    activeLastWeek,
    flagCounts,
    messagesThisWeek,
    totalMessages,
    financialWeeks,
  ] = await Promise.all([
    // Socios by onboarding status. A.3: archived excluded — an archived
    // socio's status stays whatever it was (archival is a separate concern),
    // so without this an archived test account inflates its status bucket.
    prisma.socio.groupBy({
      by: ['status'],
      where: { archivedAt: null },
      _count: { id: true },
    }),

    prisma.socio.count({ where: { archivedAt: null } }), // A.3

    // Lesson completion funnel: how many socios completed each lesson.
    // A.3: relation filter, since this table has no archivedAt of its own.
    prisma.lessonProgress.groupBy({
      by: ['lessonNumber'],
      where: { completedAt: { not: null }, socio: { archivedAt: null } },
      _count: { id: true },
      orderBy: { lessonNumber: 'asc' },
    }),

    // Average understanding score by lesson. A.3: see lessonFunnel above.
    prisma.lessonProgress.groupBy({
      by: ['lessonNumber'],
      where: { understanding: { not: null }, socio: { archivedAt: null } },
      _avg: { understanding: true },
      orderBy: { lessonNumber: 'asc' },
    }),

    // Active socios this week (had interaction)
    prisma.socioProgress.count({
      where: { lastInteractionAt: { gte: weekAgo } },
    }),

    // Active socios last week
    prisma.socioProgress.count({
      where: {
        lastInteractionAt: { gte: twoWeeksAgo, lt: weekAgo },
      },
    }),

    // Flag counts by level (unresolved). A.3: an archived test account's
    // stray flag must not count toward the live triage dashboard.
    prisma.socioFlag.groupBy({
      by: ['level'],
      where: { ...activeFlagWhere(), socio: { archivedAt: null } },
      _count: { id: true },
    }),

    // Messages sent this week
    prisma.message.count({
      where: { createdAt: { gte: weekAgo } },
    }),

    // Total messages
    prisma.message.count(),

    // Financial snapshots — last 12 weeks, grouped by week
    prisma.financialSnapshot.groupBy({
      by: ['weekStartDate'],
      where: { weekStartDate: { gte: twelveWeeksAgo } },
      _sum: { revenue: true, netProfit: true },
      _count: { id: true },
      orderBy: { weekStartDate: 'asc' },
    }),
  ]);

  const [unanchoredSocios, unanchoredMentors, whatsappUnanchored] = await Promise.all([
    prisma.socio.count({ where: { participantProfile: null } }),
    prisma.mentor.count({ where: { mentorProfile: null } }),
    prisma.socio.count({ where: { participantProfile: null, channelType: 'whatsapp' } }),
  ]);

  // Compute avg messages per socio per week. A.3: archived excluded from the
  // roster-size denominator, or 3 dormant test accounts understate everyone
  // else's engagement.
  const activeSocioCount = await prisma.socio.count({ where: { status: 'ACTIVE', archivedAt: null } });
  const avgMessagesPerSocio = activeSocioCount > 0
    ? Math.round((messagesThisWeek / activeSocioCount) * 10) / 10
    : 0;

  return {
    sociosByStatus: sociosByStatus.map((s) => ({
      status: s.status,
      count: s._count.id,
    })),
    totalSocios,
    lessonFunnel: lessonFunnel.map((l) => ({
      lessonNumber: l.lessonNumber,
      completedCount: l._count.id,
    })),
    avgUnderstandingByLesson: avgUnderstandingByLesson.map((l) => ({
      lessonNumber: l.lessonNumber,
      avgUnderstanding: Math.round((l._avg.understanding ?? 0) * 10) / 10,
    })),
    activeThisWeek,
    activeLastWeek,
    flagCounts: flagCounts.map((f) => ({
      level: f.level,
      count: f._count.id,
    })),
    messagesThisWeek,
    totalMessages,
    avgMessagesPerSocio,
    activeSocioCount,
    tenancy: {
      unanchoredSocios,
      unanchoredMentors,
      whatsappUnanchored,
    },
    financialSummary: financialWeeks.map((w) => ({
      weekStartDate: w.weekStartDate,
      totalRevenue: w._sum.revenue ?? 0,
      totalNetProfit: w._sum.netProfit ?? 0,
      socioCount: w._count.id,
    })),
  };
}
