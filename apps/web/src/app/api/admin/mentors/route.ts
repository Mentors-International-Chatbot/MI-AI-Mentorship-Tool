import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';

export async function GET() {
  const mentors = await prisma.mentor.findMany({
    include: {
      _count: { select: { socios: true } },
    },
    orderBy: { name: 'asc' },
  });

  // Enrich with aggregate metrics
  const enriched = await Promise.all(
    mentors.map(async (m) => {
      const socioIds = await prisma.socio.findMany({
        where: { mentorId: m.id },
        select: { id: true },
      });
      const ids = socioIds.map((s) => s.id);

      const unresolvedFlags = ids.length > 0
        ? await prisma.socioFlag.count({
            where: { socioId: { in: ids }, resolved: false },
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

  return NextResponse.json(mentor, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { id } = (await request.json()) as { id?: string };

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
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
