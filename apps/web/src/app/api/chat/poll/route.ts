import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestIdentity } from '@/lib/auth/requestIdentity';
import { repo } from '@/lib/repo';
import { toClientMessage } from '../toClientMessage';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const identity = await resolveRequestIdentity(req);
  if (!identity) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const since = req.nextUrl.searchParams.get('since');
  if (!since) {
    return NextResponse.json({ messages: [], currentLesson: null as number | null });
  }

  const sinceDate = new Date(since);
  if (Number.isNaN(sinceDate.getTime())) {
    return NextResponse.json({ messages: [], currentLesson: null as number | null });
  }

  const socio = await repo.getSocio(identity.channel, identity.externalId);
  if (!socio) {
    return NextResponse.json({ messages: [], currentLesson: null as number | null });
  }

  const progress = await repo.getSocioProgress(socio.id);

  const newMessages = await repo.getMessagesWithSentiment(socio.id, { since: sinceDate });

  const mapped = newMessages
    .map(toClientMessage)
    .filter((m): m is NonNullable<typeof m> => m !== null);

  return NextResponse.json({
    messages: mapped,
    currentLesson: progress.currentLessonNumber,
  });
}
