import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { mentorId } = await req.json();

  if (!mentorId) {
    return NextResponse.json({ error: 'mentorId required' }, { status: 400 });
  }

  const flag = await repo.resolveFlag(id, mentorId);
  return NextResponse.json(flag);
}
