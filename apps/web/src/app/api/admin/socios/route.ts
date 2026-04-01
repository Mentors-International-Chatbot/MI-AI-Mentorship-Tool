import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const status = params.get('status');
  const search = params.get('search');
  const mentorId = params.get('mentorId');
  const activeWithin = params.get('activeWithin'); // e.g. "7d"
  const flagLevel = params.get('flagLevel'); // "RED" or "YELLOW"
  const completedLesson = params.get('completedLesson'); // lesson number
  const lessonNumber = params.get('lessonNumber'); // lesson number
  const sortBy = params.get('sortBy'); // "messagesThisWeek"
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize') ?? 50)));

  const where: Prisma.SocioWhereInput = {};

  if (status) {
    where.status = status as Prisma.SocioWhereInput['status'];
  }
  if (mentorId) {
    where.mentorId = mentorId === 'unassigned' ? null : mentorId;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { businessName: { contains: search, mode: 'insensitive' } },
      { businessDescription: { contains: search, mode: 'insensitive' } },
      { externalId: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (activeWithin) {
    const days = parseInt(activeWithin.replace('d', ''), 10);
    if (!isNaN(days)) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      where.progress = { lastInteractionAt: { gte: since } };
    }
  }
  if (flagLevel) {
    where.flags = { some: { level: flagLevel, resolved: false } };
  }
  if (completedLesson) {
    const num = parseInt(completedLesson, 10);
    if (!isNaN(num)) {
      where.lessonProgress = {
        some: { lessonNumber: num, completedAt: { not: null } },
      };
    }
  }
  if (lessonNumber) {
    const num = parseInt(lessonNumber, 10);
    if (!isNaN(num)) {
      where.lessonProgress = {
        some: { lessonNumber: num },
      };
    }
  }

  // For messagesThisWeek sort, we need a raw approach
  if (sortBy === 'messagesThisWeek') {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const socios = await prisma.socio.findMany({
      where,
      include: {
        progress: true,
        flags: { where: { resolved: false } },
        mentor: { select: { id: true, name: true } },
        _count: {
          select: {
            messages: { where: { createdAt: { gte: weekAgo }, role: 'user' } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Sort by message count descending
    socios.sort((a, b) => (b._count?.messages ?? 0) - (a._count?.messages ?? 0));

    const paginated = socios.slice((page - 1) * pageSize, page * pageSize);
    return NextResponse.json({
      socios: paginated,
      total: socios.length,
      page,
      pageSize,
      totalPages: Math.ceil(socios.length / pageSize),
    });
  }

  const [socios, total] = await Promise.all([
    prisma.socio.findMany({
      where,
      include: {
        progress: true,
        flags: { where: { resolved: false } },
        mentor: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.socio.count({ where }),
  ]);

  return NextResponse.json({
    socios,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { socioId, mentorId } = body as { socioId: string; mentorId: string | null };

  if (!socioId) {
    return NextResponse.json({ error: 'socioId required' }, { status: 400 });
  }

  const updated = await prisma.socio.update({
    where: { id: socioId },
    data: { mentorId },
  });

  await prisma.auditLog.create({
    data: {
      actorId: 'admin',
      action: 'assigned_mentor',
      targetType: 'socio',
      targetId: socioId,
      metadata: { mentorId },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest) {
  const { socioId } = (await request.json()) as { socioId?: string };

  if (!socioId) {
    return NextResponse.json({ error: 'socioId required' }, { status: 400 });
  }

  // Delete all related records first (no cascade in schema)
  await prisma.$transaction([
    prisma.messageSentiment.deleteMany({ where: { socioId } }),
    prisma.message.deleteMany({ where: { socioId } }),
    prisma.socioFlag.deleteMany({ where: { socioId } }),
    prisma.lessonProgress.deleteMany({ where: { socioId } }),
    prisma.socioProgress.deleteMany({ where: { socioId } }),
    prisma.summary.deleteMany({ where: { socioId } }),
    prisma.financialSnapshot.deleteMany({ where: { socioId } }),
    prisma.socio.delete({ where: { id: socioId } }),
  ]);

  await prisma.auditLog.create({
    data: {
      actorId: 'admin',
      action: 'deleted_socio',
      targetType: 'socio',
      targetId: socioId,
    },
  });

  return NextResponse.json({ success: true });
}
