import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';
import { repo } from '@/lib/repo';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await verifySession();
  if (!session) {
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

  const socio = await repo.getSocio('web', session.userId);
  if (!socio) {
    return NextResponse.json({ messages: [], currentLesson: null as number | null });
  }

  const progress = await repo.getSocioProgress(socio.id);

  const newMessages = await prisma.message.findMany({
    where: {
      socioId: socio.id,
      createdAt: { gt: sinceDate },
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({
    messages: newMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'mentor')
      .map((m) => ({
        id: m.id,
        role: m.role === 'mentor' ? 'assistant' : m.role,
        content: m.content,
        senderType: m.senderType,
        createdAt: m.createdAt.toISOString(),
      })),
    currentLesson: progress.currentLessonNumber,
  });
}
