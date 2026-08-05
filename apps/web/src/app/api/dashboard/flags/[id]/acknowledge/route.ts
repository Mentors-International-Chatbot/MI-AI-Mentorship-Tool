import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { verifyMentorOrAdmin } from '@/lib/auth/ownership';

/**
 * "I've seen this." Records that a mentor looked at the alert without claiming
 * it is dealt with — `resolved` stays false and health still counts the flag.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await verifyMentorOrAdmin();
  if (!auth.authorized) return auth.response;

  // For mentors, verify the flag belongs to one of their socios
  if (auth.session.role === 'mentor') {
    const flagWithSocio = await repo.getFlagWithSocio(id);
    if (!flagWithSocio || flagWithSocio.socio.mentorId !== auth.session.userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  const flag = await repo.getFlagById(id);
  if (!flag) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { note?: unknown } | null;
  const note = typeof body?.note === 'string' && body.note.trim().length > 0
    ? body.note.trim()
    : undefined;

  const acknowledged = await repo.acknowledgeFlag(id, auth.session.userId, note);
  return NextResponse.json(acknowledged);
}
