import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { repo } from '@/lib/repo';
import { isSupportedLanguage } from '@/lib/i18n/languages';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let language = 'es';
  let curriculumCollectionKey: string | null = null;

  if (session.role === 'socio') {
    const socio = await repo.getSocio('web', session.userId);
    if (socio) {
      language = socio.language || 'es';
      curriculumCollectionKey = socio.curriculumCollectionKey ?? null;
    }
  } else {
    const mentor = await prisma.mentor.findUnique({
      where: { id: session.userId },
      select: { preferredLanguage: true },
    });
    const pl = mentor?.preferredLanguage ?? 'en';
    language = isSupportedLanguage(pl) ? pl : 'en';
  }

  return NextResponse.json({
    userId: session.userId,
    name: session.name,
    role: session.role,
    language,
    curriculumCollectionKey,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (session.role !== 'socio') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as { language?: string };
  if (!body.language || !isSupportedLanguage(body.language)) {
    return NextResponse.json({ error: 'Invalid language' }, { status: 400 });
  }

  const socio = await repo.getSocio('web', session.userId);
  if (!socio) {
    return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
  }

  await repo.updateSocio(socio.id, { language: body.language });

  return NextResponse.json({ language: body.language });
}
