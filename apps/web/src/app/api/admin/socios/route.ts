import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const status = params.get('status');
  const search = params.get('search');
  const mentorId = params.get('mentorId');
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
      { externalId: { contains: search, mode: 'insensitive' } },
    ];
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
