/**
 * GET /api/chat/progress
 *
 * The learner's own position: lesson X of N, part within the lesson, gate
 * status, and project milestones when the course declares an outcome.
 *
 * Separate from `/api/chat/poll` on purpose — see `lib/chat/progress.ts`. The
 * poll runs every five seconds; these numbers move a few times per lesson.
 */
import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';
import { repo } from '@/lib/repo';
import { buildChatProgress } from '@/lib/chat/progress';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Web only, by design: this is a rendered panel with no text equivalent, and
  // the brief is explicit that WhatsApp gets nothing rather than a transcription.
  const socio = await repo.getSocio('web', session.userId);
  if (!socio) {
    return NextResponse.json({ progress: null });
  }

  try {
    const progress = await buildChatProgress(socio);
    return NextResponse.json({ progress });
  } catch (error) {
    // A panel that cannot render is a missing sidebar. Failing the request
    // would be a broken chat page for the same fault.
    console.error(`[ChatProgress] Failed for socio ${socio.id}:`, error);
    return NextResponse.json({ progress: null });
  }
}
