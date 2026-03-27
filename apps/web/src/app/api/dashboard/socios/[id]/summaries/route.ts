import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifySession } from '@/lib/auth/session';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'mentor' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: socioId } = await params;

  const summaries = await prisma.summary.findMany({
    where: { socioId },
    orderBy: { weekStartDate: 'desc' },
    take: 8,
  });

  return NextResponse.json({
    summaries: summaries.map((s) => ({
      ...s,
      weekStartDate: s.weekStartDate.toISOString(),
      createdAt: s.createdAt.toISOString(),
    })),
  });
}
