import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { verifySession } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const session = await verifySession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const rawType = searchParams.get('type');
  const logType =
    rawType === 'error' || rawType === 'operational' ? rawType : undefined;
  const level = searchParams.get('level') || undefined;
  const category = searchParams.get('category') || undefined;
  const rawLimit = parseInt(searchParams.get('limit') || '100', 10);
  const take = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 100), 100);

  const emptyFilter =
    (logType === 'error' && level != null && level !== 'error') ||
    (logType === 'operational' && level === 'error');

  const where: Prisma.SystemLogWhereInput = {};
  if (category) where.category = category;

  if (logType === 'error') {
    where.level = 'error';
  } else if (logType === 'operational') {
    if (level === 'info' || level === 'warn') {
      where.level = level;
    } else {
      where.level = { in: ['info', 'warn'] };
    }
  } else if (level) {
    where.level = level;
  }

  const logs = emptyFilter
    ? []
    : await prisma.systemLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
      });

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [errorCount, totalCount] = await Promise.all([
    prisma.systemLog.count({ where: { level: 'error', createdAt: { gte: dayAgo } } }),
    prisma.systemLog.count({ where: { createdAt: { gte: dayAgo } } }),
  ]);

  return NextResponse.json({
    logs,
    stats: { errorCount24h: errorCount, totalEvents24h: totalCount },
  });
}
