import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { repo } from '@/lib/repo';
import { DEFAULT_LANGUAGE, isSupportedLanguage, type SupportedLanguage } from '@/lib/i18n/languages';
import { getCourseMeta } from '@/lib/courses/course-meta';
import { resolveLearnerHome } from '@/lib/courses/learnerHome';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({
      error: 'Not authenticated',
      code: 'no_session',
    }, { status: 401 });
  }

  let language: SupportedLanguage = DEFAULT_LANGUAGE;
  let curriculumCollectionKey: string | null = null;
  let courseName: string | null = null;
  let mentorName: string | null = null;
  let displayName: string | null = null;
  let homePath: string | null = null;
  let enrollmentIssue: 'not-enrolled' | 'no-published-course' | 'channel-not-supported' | null = null;

  if (session.role === 'socio') {
    const socio = await repo.getSocio('web', session.userId);
    if (!socio) {
      // The JWT is valid but its database identity is absent. In development
      // this most commonly means the browser kept a cookie while DATABASE_URL
      // switched to another Neon branch. It is not a missing API route.
      return NextResponse.json({
        error: 'This session belongs to a different or reset database. Clear it and sign in again.',
        code: 'session_database_mismatch',
      }, { status: 409 });
    }
    language = isSupportedLanguage(socio.language) ? socio.language : DEFAULT_LANGUAGE;
    curriculumCollectionKey = socio.curriculumCollectionKey ?? null;

    // Fetch course metadata if socio has a curriculum.
    if (curriculumCollectionKey) {
      const meta = await getCourseMeta(curriculumCollectionKey);
      courseName = meta.courseName;
      mentorName = meta.mentorName;
      displayName = meta.displayName;
      const resolution = await resolveLearnerHome(socio.id);
      // A.5: more than one ACTIVE enrollment has no single homePath to give —
      // this is not an enrollment error, so it must not set enrollmentIssue.
      // join/page.tsx already falls back to '/home' whenever homePath is
      // falsy (`data.homePath || '/home'`, twice), and /home is the one place
      // that now knows how to render the course list. Reusing that existing
      // fallback avoids needing new picker UI in two places.
      homePath = resolution.kind === 'redirect' ? resolution.path : null;
      const joinError = homePath?.match(/^\/join\?error=(not-enrolled|no-published-course|channel-not-supported)$/u)?.[1];
      if (joinError === 'not-enrolled' || joinError === 'no-published-course' || joinError === 'channel-not-supported') {
        enrollmentIssue = joinError;
      }
    }
  } else {
    const mentor = await prisma.mentor.findUnique({
      where: { id: session.userId },
      select: { preferredLanguage: true },
    });
    if (!mentor) {
      return NextResponse.json({
        error: 'This session belongs to a different or reset database. Clear it and sign in again.',
        code: 'session_database_mismatch',
      }, { status: 409 });
    }
    const pl = mentor?.preferredLanguage ?? 'en';
    language = isSupportedLanguage(pl) ? pl : 'en';
  }

  return NextResponse.json({
    userId: session.userId,
    name: session.name,
    role: session.role,
    language,
    curriculumCollectionKey,
    courseName,
    mentorName,
    displayName,
    homePath,
    enrollmentIssue,
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
    return NextResponse.json({
      error: 'This session belongs to a different or reset database. Clear it and sign in again.',
      code: 'session_database_mismatch',
    }, { status: 409 });
  }

  await repo.updateSocio(socio.id, { language: body.language });

  return NextResponse.json({ language: body.language });
}
