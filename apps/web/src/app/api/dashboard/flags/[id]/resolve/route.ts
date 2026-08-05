import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { verifyMentorOrAdmin } from '@/lib/auth/ownership';
import { isFlagDisposition } from '@/lib/repo/types';

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

  const body = (await req.json().catch(() => null)) as {
    disposition?: unknown;
    note?: unknown;
    linkedMessageId?: unknown;
  } | null;

  const disposition = body?.disposition;
  if (!isFlagDisposition(disposition)) {
    return NextResponse.json(
      { error: 'A valid disposition is required' },
      { status: 400 },
    );
  }

  const note = typeof body?.note === 'string' ? body.note.trim() : '';

  // A red alert is the one case where "resolved" without a word of explanation
  // is worthless to the next mentor who reads it.
  const flag = await repo.getFlagById(id);
  if (!flag) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (flag.level === 'RED' && note.length === 0) {
    return NextResponse.json(
      { error: 'A note is required when resolving a red alert' },
      { status: 400 },
    );
  }

  const linkedMessageId =
    typeof body?.linkedMessageId === 'string' && body.linkedMessageId.length > 0
      ? body.linkedMessageId
      : undefined;

  const resolved = await repo.resolveFlag(id, auth.session.userId, {
    disposition,
    ...(note.length > 0 ? { note } : {}),
    ...(linkedMessageId ? { linkedMessageId } : {}),
  });

  // The panel shows who resolved it; `resolvedBy` alone is only a uuid.
  return NextResponse.json({ ...resolved, resolvedByName: auth.session.name });
}
