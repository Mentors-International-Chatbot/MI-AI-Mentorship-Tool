import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { requireSystemAdmin, requireCourseConfigurer } from '@/lib/auth/adminGuard';
import { activeFlagWhere } from '@/lib/flags/active';
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { anchorMentorProfile } from '@/lib/tenancy/mentorAnchor';
import { resolveAdminScope } from '@/lib/auth/adminScope';
import type { Prisma } from '@prisma/client';

export async function GET() {
  // D.2: readable by admin (every mentor) and course_lead (mentors anchored
  // to their own organization only). Writes below stay requireSystemAdmin-only.
  const auth = await requireCourseConfigurer();
  if (!auth.authorized) return auth.response;

  const scope = await resolveAdminScope(auth.session);
  if (scope.kind === 'none') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // A course lead sees only mentors anchored (via MentorProfile) to their own
  // org. An unanchored mentor has no organizationId to compare against, so it
  // correctly never appears in a course lead's roster — only admin's
  // unrestricted `where: {}` sees unanchored mentors at all.
  const where: Prisma.MentorWhereInput =
    scope.kind === 'course_admin' ? { mentorProfile: { organizationId: scope.organizationId } } : {};

  const mentors = await prisma.mentor.findMany({
    where,
    include: {
      // A.3: archived socios excluded from the mentor roster's caseload count
      _count: { select: { socios: { where: { archivedAt: null } } } },
    },
    orderBy: { name: 'asc' },
  });

  // Enrich with aggregate metrics
  const enriched = await Promise.all(
    mentors.map(async (m) => {
      const socioIds = await prisma.socio.findMany({
        // A.3: archived socios excluded from mentor aggregate stats
        where: { mentorId: m.id, archivedAt: null },
        select: { id: true },
      });
      const ids = socioIds.map((s) => s.id);

      const unresolvedFlags = ids.length > 0
        ? await prisma.socioFlag.count({
            where: { socioId: { in: ids }, ...activeFlagWhere() },
          })
        : 0;

      const avgProgress = ids.length > 0
        ? await prisma.socioProgress.aggregate({
            where: { socioId: { in: ids } },
            _avg: { currentLessonNumber: true },
          })
        : null;

      return {
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        createdAt: m.createdAt,
        socioCount: m._count.socios,
        unresolvedFlags,
        avgLessonNumber: avgProgress?._avg?.currentLessonNumber ?? null,
      };
    }),
  );

  return NextResponse.json(enriched);
}

export async function POST(request: NextRequest) {
  const auth = await requireSystemAdmin();
  if (!auth.authorized) return auth.response;

  const body = await request.json();
  const { name, email, role, password } = body as {
    name: string;
    email: string;
    role?: string;
    password?: string;
  };

  if (!name || !email) {
    return NextResponse.json({ error: 'name and email required' }, { status: 400 });
  }

  const data: { name: string; email: string; role: string; passwordHash?: string } = {
    name,
    email,
    role: role ?? 'mentor',
  };

  if (password) {
    data.passwordHash = await hashPassword(password);
  }

  const mentor = await prisma.mentor.create({ data });

  // An admin in a known tenant deliberately creating a mentor IS the org
  // signal — stronger than inferring one from their (currently empty) caseload,
  // which is why it outranks the other signals in resolveMentorOrg.
  //
  // The creating admin may themselves be unanchored (3 of 14 mentors are), in
  // which case there is no signal to pass on and the new mentor stays
  // unanchored until their first socio assignment. Correct, and logged.
  const adminOrganizationId = await tenantPrismaRepo
    .getOrganizationIdByMentorId(auth.session.userId)
    .catch(() => null);

  await anchorMentorProfile({
    mentorId: mentor.id,
    trigger: 'admin_create_mentor',
    explicitOrganizationId: adminOrganizationId,
  });

  return NextResponse.json(mentor, { status: 201 });
}

const BATCH_DELETE_MAX = 100;

export async function DELETE(request: NextRequest) {
  const auth = await requireSystemAdmin();
  if (!auth.authorized) return auth.response;

  const body = (await request.json()) as { id?: string; ids?: string[] };

  if (body.ids && Array.isArray(body.ids)) {
    const ids = [...new Set(body.ids.filter((x): x is string => Boolean(x)))].slice(0, BATCH_DELETE_MAX);
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 });
    }

    await prisma.socio.updateMany({
      where: { mentorId: { in: ids } },
      data: { mentorId: null },
    });

    await prisma.mentor.deleteMany({ where: { id: { in: ids } } });

    await prisma.auditLog.create({
      data: {
        actorId: 'admin',
        action: 'deleted_mentor_batch',
        targetType: 'mentor',
        targetId: null,
        metadata: { mentorIds: ids, count: ids.length },
      },
    });

    return NextResponse.json({ success: true, deleted: ids.length });
  }

  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: 'id or ids required' }, { status: 400 });
  }

  // Unassign any socios linked to this mentor first
  await prisma.socio.updateMany({
    where: { mentorId: id },
    data: { mentorId: null },
  });

  await prisma.mentor.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      actorId: 'admin',
      action: 'deleted_mentor',
      targetType: 'mentor',
      targetId: id,
    },
  });

  return NextResponse.json({ success: true });
}
