import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';
import { repo } from '@/lib/repo';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const socio = await repo.getSocio('web', session.userId);
  if (!socio) {
    return NextResponse.json({
      messages: [],
      currentLesson: null as number | null,
      completedLessons: [] as number[],
    });
  }

  const progress = await repo.getSocioProgress(socio.id);

  const messages = await repo.getMessages(socio.id, 50);

  const mapped = messages
    .map((m) => {
      const displayRole =
        m.role === 'mentor' ? 'assistant' : m.role;
      if (displayRole !== 'user' && displayRole !== 'assistant') {
        return null;
      }
      return {
        id: m.id,
        role: displayRole as 'user' | 'assistant',
        content: m.content,
        senderType: m.senderType ?? null,
        createdAt: m.createdAt.toISOString(),
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  return NextResponse.json({
    messages: mapped,
    currentLesson: progress.currentLessonNumber,
    completedLessons: progress.completedLessons,
  });
}
