import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifySession } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const session = await verifySession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const level = searchParams.get('level') || undefined;
  const category = searchParams.get('category') || undefined;
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  const logs = await prisma.systemLog.findMany({
    where: {
      ...(level ? { level } : {}),
      ...(category ? { category } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(1, limit), 200),
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
