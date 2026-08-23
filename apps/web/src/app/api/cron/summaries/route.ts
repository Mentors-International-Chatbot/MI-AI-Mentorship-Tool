import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { generateSummary } from '@/lib/summary/generateSummary';
import { isSupportedLanguage } from '@/lib/i18n/languages';

function summaryLangForMentor(preferred: string | null | undefined): string {
  const t = preferred?.trim() ?? '';
  if (t && isSupportedLanguage(t)) return t;
  return 'en';
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const socios = await prisma.socio.findMany({
    where: { status: 'ACTIVE', archivedAt: null }, // A.3: no weekly summary for an archived socio
    select: { id: true, mentorId: true },
  });

  const mentorIds = [
    ...new Set(socios.map((s) => s.mentorId).filter((id): id is string => id != null)),
  ];
  type MentorLangRow = { id: string; preferred_language: string };
  const mentors: MentorLangRow[] =
    mentorIds.length > 0
      ? await prisma.$queryRaw<MentorLangRow[]>(Prisma.sql`
          SELECT id, preferred_language
          FROM mentors
          WHERE id IN (${Prisma.join(mentorIds)})
        `)
      : [];
  const langByMentorId = new Map(mentors.map((m) => [m.id, m.preferred_language]));

  let generated = 0;
  const errors: string[] = [];

  for (const socio of socios) {
    try {
      const lang = socio.mentorId
        ? summaryLangForMentor(langByMentorId.get(socio.mentorId))
        : 'es';
      const generatedSummary = await generateSummary(socio.id, lang);
      if (!generatedSummary) continue;

      await prisma.summary.create({
        data: {
          socioId: socio.id,
          weekStartDate: generatedSummary.weekStartDate,
          content: generatedSummary.content,
          flags: generatedSummary.flags,
          metrics: generatedSummary.metrics,
        },
      });

      generated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`socio=${socio.id}: ${msg}`);
      console.error(`[CronSummary] Error for socio=${socio.id}:`, err);
    }
  }

  return NextResponse.json({
    totalSocios: socios.length,
    generated,
    errors: errors.length > 0 ? errors : undefined,
  });
}
