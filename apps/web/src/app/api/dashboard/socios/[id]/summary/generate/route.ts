import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { generateSummary } from '@/lib/summary/generateSummary';
import { verifyMentorOwnership } from '@/lib/auth/ownership';
import { isSupportedLanguage } from '@/lib/i18n/languages';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: socioId } = await params;

  const auth = await verifyMentorOwnership(socioId);
  if (!auth.authorized) return auth.response;

  const cookieStore = await cookies();
  const rawLang = cookieStore.get('dashboard_lang')?.value ?? 'en';
  const dashboardLang = isSupportedLanguage(rawLang) ? rawLang : 'en';

  try {
    const generated = await generateSummary(socioId, dashboardLang);
    if (!generated) {
      return NextResponse.json(
        { error: 'NO_MESSAGES_THIS_WEEK' },
        { status: 400 },
      );
    }

    const summary = await prisma.summary.create({
      data: {
        socioId,
        weekStartDate: generated.weekStartDate,
        content: generated.content,
        flags: generated.flags,
        metrics: generated.metrics,
      },
    });

    if (auth.session.role === 'mentor') {
      await prisma
        .$executeRaw(
          Prisma.sql`UPDATE mentors SET preferred_language = ${dashboardLang} WHERE id = ${auth.session.userId}`,
        )
        .catch(() => {});
    }

    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error('[SummaryGenerate] Failed:', error);
    return NextResponse.json({ error: 'Failed to generate summary' }, { status: 500 });
  }
}
