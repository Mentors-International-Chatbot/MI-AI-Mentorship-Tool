import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { verifySession } from '@/lib/auth/session';
import { isSupportedLanguage } from '@/lib/i18n/languages';

/**
 * Persist the viewer's dashboard UI language.
 *
 * This is the source of truth read by `resolveDashboardLanguage` on every
 * dashboard render, so the choice follows the user across devices rather than
 * living only in a browser cookie. Also used by the cron summary job.
 */
export async function PATCH(request: NextRequest) {
  const session = await verifySession();
  if (!session || (session.role !== 'mentor' && session.role !== 'admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as { preferredLanguage?: string };
  const raw = body.preferredLanguage?.trim() ?? '';
  if (!raw || !isSupportedLanguage(raw)) {
    return NextResponse.json({ error: 'Invalid preferredLanguage' }, { status: 400 });
  }

  const updated = await repo.setMentorPreferredLanguage(session.userId, raw);
  if (!updated) {
    return NextResponse.json({ error: 'Mentor not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
