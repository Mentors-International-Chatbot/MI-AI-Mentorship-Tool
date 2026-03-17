import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: socioId } = await params;

  const summaries = await prisma.summary.findMany({
    where: { socioId },
    orderBy: { weekStartDate: 'desc' },
  });

  return NextResponse.json({ summaries });
}
