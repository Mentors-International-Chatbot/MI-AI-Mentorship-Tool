import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { verifyMentorOrAdmin } from '@/lib/auth/ownership';
import { isSnoozeDays } from '@/lib/repo/types';
import { mentorOwnsSocio } from '@/lib/repo/mentorVisibility';

/**
 * "Not now." Drops the alert out of health until `snoozedUntil` passes, at
 * which point it counts again on its own — no second action required.
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
    if (!flagWithSocio || !mentorOwnsSocio(flagWithSocio.socio, auth.session.userId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  const flag = await repo.getFlagById(id);
  if (!flag) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    days?: unknown;
    note?: unknown;
  } | null;

  if (!isSnoozeDays(body?.days)) {
    return NextResponse.json(
      { error: 'days must be one of 1, 3, or 7' },
      { status: 400 },
    );
  }

  const note = typeof body?.note === 'string' && body.note.trim().length > 0
    ? body.note.trim()
    : undefined;

  const snoozed = await repo.snoozeFlag(id, auth.session.userId, body.days, note);
  return NextResponse.json(snoozed);
}
