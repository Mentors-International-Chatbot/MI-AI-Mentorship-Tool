/**
 * Generic Scheduled Check-in Route
 * ═══════════════════════════════════════════════════════════════════════════
 * Reads check-in configurations from CourseMeta.scheduledCheckins.
 * Fires check-ins based on cadence, sends to socios in their language.
 * Replaces the old MI-specific financial-checkin route.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { WhatsAppChannel } from '@/lib/delivery';
import { getCourseMeta, resolveLocalized } from '@/lib/courses/course-meta';
import type { ScheduledCheckin } from '@/lib/journey-package/journey-package.schema';
import { DEFAULT_LANGUAGE, type SupportedLanguage, isSupportedLanguage } from '@/lib/i18n/languages';

// ── Cadence Evaluation ────────────────────────────────────────────────────────

function shouldFireForCadence(cadence: ScheduledCheckin['cadence']): boolean {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ...

  switch (cadence) {
    case 'daily':
      return true;
    case 'weekly':
      // Fire on Mondays (start of week)
      return dayOfWeek === 1;
    case 'biweekly':
      // Fire on 1st and 15th of month
      const day = now.getUTCDate();
      return day === 1 || day === 15;
    case 'monthly':
      // Fire on 1st of month
      return now.getUTCDate() === 1;
    default:
      return false;
  }
}

// ── Main Handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const whatsappChannel = new WhatsAppChannel();

  // Get all distinct curriculum collection keys from active socios
  const distinctCurriculums = await prisma.socio.findMany({
    where: { status: 'ACTIVE' },
    select: { curriculumCollectionKey: true },
    distinct: ['curriculumCollectionKey'],
  });

  const collectionKeys = distinctCurriculums
    .map((s) => s.curriculumCollectionKey)
    .filter((key): key is string => key !== null);

  const results: {
    checkinId: string;
    course: string;
    sent: number;
    errors: string[];
  }[] = [];

  // Process each course's check-ins
  for (const collectionKey of collectionKeys) {
    const meta = await getCourseMeta(collectionKey);

    // Get enabled check-ins that should fire today
    const activeCheckins = meta.scheduledCheckins.filter(
      (c) => c.enabled && shouldFireForCadence(c.cadence)
    );

    if (activeCheckins.length === 0) continue;

    // Get socios for this course (WhatsApp channel only for now)
    const socios = await prisma.socio.findMany({
      where: {
        status: 'ACTIVE',
        channelType: 'whatsapp',
        curriculumCollectionKey: collectionKey,
      },
      select: {
        id: true,
        whatsappPhoneNumber: true,
        externalId: true,
        language: true,
      },
    });

    for (const checkin of activeCheckins) {
      let sent = 0;
      const errors: string[] = [];

      for (const socio of socios) {
        const phone = socio.whatsappPhoneNumber ?? socio.externalId;
        if (!phone) continue;

        // Resolve language with fallback
        const lang: SupportedLanguage =
          socio.language && isSupportedLanguage(socio.language)
            ? socio.language
            : DEFAULT_LANGUAGE;

        // Resolve prompt to socio's language
        const message = resolveLocalized(checkin.prompt, lang);

        try {
          await whatsappChannel.sendMessage(phone, message);

          // Store the check-in message
          await prisma.message.create({
            data: {
              socioId: socio.id,
              role: 'assistant',
              content: message,
              senderType: 'ai',
            },
          });

          sent++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`socio=${socio.id}: ${msg}`);
          console.error(`[CronCheckin] Error for socio=${socio.id}, checkin=${checkin.id}:`, err);
        }
      }

      results.push({
        checkinId: checkin.id,
        course: collectionKey,
        sent,
        errors,
      });
    }
  }

  // Summary
  const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    totalSent,
    totalErrors,
    details: results.map((r) => ({
      checkinId: r.checkinId,
      course: r.course,
      sent: r.sent,
      errors: r.errors.length > 0 ? r.errors : undefined,
    })),
  });
}
