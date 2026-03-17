import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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
  const { name, email, role } = body as { name: string; email: string; role?: string };

  if (!name || !email) {
    return NextResponse.json({ error: 'name and email required' }, { status: 400 });
  }

  const mentor = await prisma.mentor.create({
    data: { name, email, role: role ?? 'mentor' },
  });

  return NextResponse.json(mentor, { status: 201 });
}
