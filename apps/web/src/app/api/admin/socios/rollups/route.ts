/**
 * GET /api/admin/socios/rollups
 * ═══════════════════════════════════════════════════════════════════════════
 * Per-course rollups for the admin overview.
 *
 * Accepts the same filters as the socios list and deliberately ignores `page`
 * and `pageSize`: the cards describe the whole filtered program, not the fifty
 * rows the table happens to have loaded. Computing them from the page would
 * look correct today at 43 socios and silently become per-page later.
 *
 * Three queries regardless of how many socios match — the socios, their
 * progress, and a grouped count of their unresolved flags — assembled in
 * memory and handed to the same `buildCourseRollups` the mentor dashboard
 * uses, so both surfaces share one definition and one set of tests.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  buildCourseRollups,
  type CourseRollupInput,
} from '@/app/dashboard/learners/courseRollup';
import { getCourseSummaries } from '@/lib/journey-package/course-summaries';
import { buildSocioWhere } from '../filters';
import { requireSystemAdmin } from '@/lib/auth/adminGuard';
import { activeFlagWhere } from '@/lib/flags/active';

export async function GET(request: NextRequest) {
  const auth = await requireSystemAdmin();
  if (!auth.authorized) return auth.response;

  const where = buildSocioWhere(request.nextUrl.searchParams);

  const socios = await prisma.socio.findMany({
    where,
    select: { id: true, curriculumCollectionKey: true },
  });

  if (socios.length === 0) {
    return NextResponse.json({ rollups: [], courses: [] });
  }

  const socioIds = socios.map((s) => s.id);

  const [progress, flagCounts] = await Promise.all([
    prisma.socioProgress.findMany({
      where: { socioId: { in: socioIds } },
      select: { socioId: true, currentLessonNumber: true, lastInteractionAt: true },
    }),
    prisma.socioFlag.groupBy({
      by: ['socioId', 'level'],
      where: { socioId: { in: socioIds }, ...activeFlagWhere() },
      _count: { _all: true },
    }),
  ]);

  const progressBySocio = new Map(progress.map((p) => [p.socioId, p]));
  const redBySocio = new Map<string, number>();
  const yellowBySocio = new Map<string, number>();
  for (const group of flagCounts) {
    const target = group.level === 'RED' ? redBySocio : group.level === 'YELLOW' ? yellowBySocio : null;
    target?.set(group.socioId, group._count._all);
  }

  const rows: CourseRollupInput[] = socios.map((socio) => {
    const p = progressBySocio.get(socio.id);
    return {
      curriculumCollectionKey: socio.curriculumCollectionKey ?? null,
      // A socio with no progress row has not started; lesson 0 keeps them in
      // the participant count without inflating the course average.
      currentLesson: p?.currentLessonNumber ?? 0,
      lastInteractionAt: p?.lastInteractionAt?.toISOString() ?? null,
      unresolvedRed: redBySocio.get(socio.id) ?? 0,
      unresolvedYellow: yellowBySocio.get(socio.id) ?? 0,
    };
  });

  // Cross-tenant on purpose: this is the platform admin's overview, matching
  // the unscoped socio list it annotates.
  const courses = await getCourseSummaries(
    rows.map((r) => r.curriculumCollectionKey).filter((k): k is string => k !== null),
  );

  return NextResponse.json({ rollups: buildCourseRollups(rows, courses), courses });
}
