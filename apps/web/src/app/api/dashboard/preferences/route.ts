import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { verifySession } from '@/lib/auth/session';
import { isSupportedLanguage } from '@/lib/i18n/languages';

/** Persist mentor UI language for cron summaries (dashboard cookie is client-only). */
export async function PATCH(request: NextRequest) {
  const session = await verifySession();
  if (!session || session.role !== 'mentor') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as { preferredLanguage?: string };
  const raw = body.preferredLanguage?.trim() ?? '';
  if (!raw || !isSupportedLanguage(raw)) {
    return NextResponse.json({ error: 'Invalid preferredLanguage' }, { status: 400 });
  }

  const updated = await prisma.$executeRaw(
    Prisma.sql`UPDATE mentors SET preferred_language = ${raw} WHERE id = ${session.userId}`,
  );
  if (updated === 0) {
    return NextResponse.json({ error: 'Mentor not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
