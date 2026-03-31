import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyMentorOwnership } from '@/lib/auth/ownership';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: socioId } = await params;

  const auth = await verifyMentorOwnership(socioId);
  if (!auth.authorized) return auth.response;

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
