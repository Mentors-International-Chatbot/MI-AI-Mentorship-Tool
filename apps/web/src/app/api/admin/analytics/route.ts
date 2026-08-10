import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/adminGuard';
import { activeFlagWhere } from '@/lib/flags/active';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

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
    // Socios by onboarding status
    prisma.socio.groupBy({
      by: ['status'],
      _count: { id: true },
    }),

    prisma.socio.count(),

    // Lesson completion funnel: how many socios completed each lesson
    prisma.lessonProgress.groupBy({
      by: ['lessonNumber'],
      where: { completedAt: { not: null } },
      _count: { id: true },
      orderBy: { lessonNumber: 'asc' },
    }),

    // Average understanding score by lesson
    prisma.lessonProgress.groupBy({
      by: ['lessonNumber'],
      where: { understanding: { not: null } },
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

    // Flag counts by level (unresolved)
    prisma.socioFlag.groupBy({
      by: ['level'],
      where: activeFlagWhere(),
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

  // ── Unanchored counts ────────────────────────────────────────────────────
  // "Unanchored" means no ParticipantProfile (socio) or no MentorProfile
  // (mentor), which is the tenancy anchor every org-scoped query filters on.
  // It is a legitimate state — anchoring waits for a real org signal rather
  // than guessing a default org — but it is invisible by construction: the
  // socio simply does not appear on a dashboard, and the mentor simply sees an
  // empty roster. Neither surfaces an error.
  //
  // Surfacing the counts here is what makes it a state someone can see rather
  // than infer from a missing row. A number that climbs means anchoring stopped
  // happening, which is otherwise silent until someone asks where their learner
  // went. `whatsappUnanchored` is broken out because that path has no curriculum
  // signal at all today, so it is the one expected to grow.
  const [unanchoredSocios, unanchoredMentors, whatsappUnanchored] = await Promise.all([
    prisma.socio.count({ where: { participantProfile: null } }),
    prisma.mentor.count({ where: { mentorProfile: null } }),
    prisma.socio.count({ where: { participantProfile: null, channelType: 'whatsapp' } }),
  ]);

  // Compute avg messages per socio per week
  const activeSocioCount = await prisma.socio.count({ where: { status: 'ACTIVE' } });
  const avgMessagesPerSocio = activeSocioCount > 0
    ? Math.round((messagesThisWeek / activeSocioCount) * 10) / 10
    : 0;

  return NextResponse.json({
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
  });
}
