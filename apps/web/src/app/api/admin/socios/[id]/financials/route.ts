import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const snapshots = await prisma.financialSnapshot.findMany({
    where: { socioId: id },
    orderBy: { weekStartDate: 'asc' },
    take: 52,
  });

  return NextResponse.json(
    snapshots.map((s) => ({
      id: s.id,
      weekStartDate: s.weekStartDate,
      revenue: s.revenue,
      netProfit: s.netProfit,
      costs: s.revenue - s.netProfit,
      source: s.source,
      createdAt: s.createdAt,
    })),
  );
}
