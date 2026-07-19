import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { verifyMentorOwnership } from '@/lib/auth/ownership';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: socioId } = await params;

  const auth = await verifyMentorOwnership(socioId);
  if (!auth.authorized) return auth.response;

  const summaries = await repo.getSummaries(socioId, 8);

  return NextResponse.json({
    summaries: summaries.map((s) => ({
      ...s,
      weekStartDate: s.weekStartDate.toISOString(),
      createdAt: s.createdAt.toISOString(),
    })),
  });
}
