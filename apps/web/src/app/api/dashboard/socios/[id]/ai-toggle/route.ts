import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { verifyMentorOwnership } from '@/lib/auth/ownership';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: socioId } = await params;

  const auth = await verifyMentorOwnership(socioId);
  if (!auth.authorized) return auth.response;

  const { aiPaused } = (await req.json()) as { aiPaused: boolean };

  if (typeof aiPaused !== 'boolean') {
    return NextResponse.json({ error: 'aiPaused must be a boolean' }, { status: 400 });
  }

  const updated = await repo.updateSocio(socioId, { aiPaused });

  return NextResponse.json({ success: true, aiPaused: updated.aiPaused });
}
