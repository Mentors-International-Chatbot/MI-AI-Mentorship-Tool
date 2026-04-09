export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { repo } from '@/lib/repo';
import { verifySession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { computeSocioHealth } from '@/lib/health';
import { isSupportedLanguage, type SupportedLanguage } from '@/lib/i18n/languages';
import { getDashboardStrings } from '@/lib/i18n/dashboard';
import { ChatHistory } from './ChatHistory';
import { SendMessageForm } from './SendMessageForm';
import { AiToggleButton } from './AiToggleButton';
import { SliderPanel } from './SliderPanel';
import { FlagsPanel } from './FlagsPanel';
import { LessonProgressPanel } from './LessonProgressPanel';
import { SummaryPanel } from './SummaryPanel';
import { RevenueChart } from './RevenueChart';

const STATUS_COLORS: Record<string, string> = {
  RED: 'bg-red-500',
  YELLOW: 'bg-yellow-400',
  GREEN: 'bg-green-500',
};

export default async function SocioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await verifySession();
  if (!session || session.role === 'socio') {
    redirect('/login');
  }

  const cookieStore = await cookies();
  const rawLang = cookieStore.get('dashboard_lang')?.value ?? 'en';
  const lang: SupportedLanguage = isSupportedLanguage(rawLang) ? rawLang : 'en';
  const t = getDashboardStrings(lang);

  const socio = await repo.getSocioById(id);
  if (!socio) notFound();

  // Mentors can only view their assigned socios
  if (session.role === 'mentor' && socio.mentorId !== session.userId) {
    notFound();
  }

  const [health, progress, flags, lessonProgress, messages, summaries, financialRows, latestFeedback] =
    await Promise.all([
      computeSocioHealth(id),
      repo.getSocioProgress(id),
      repo.getFlags(id),
      repo.getLessonProgressAll(id),
      repo.getMessages(id, 50),
      prisma.summary.findMany({
        where: { socioId: id },
        orderBy: { weekStartDate: 'desc' },
        take: 8,
      }),
      prisma.financialSnapshot.findMany({
        where: { socioId: id },
        orderBy: { weekStartDate: 'desc' },
        take: 20,
      }),
      prisma.socioFeedback.findFirst({
        where: { socioId: id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

  const serializedFinancials = [...financialRows]
    .reverse()
    .map((f) => ({
      id: f.id,
      revenue: f.revenue,
      netProfit: f.netProfit,
      weekStartDate: f.weekStartDate.toISOString(),
    }));

  const overrides = (socio.promptOverrides ?? {}) as Record<string, number | string | undefined>;

  const serializedMessages = messages.map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));

  const serializedFlags = flags.map((f) => ({
    ...f,
    source: f.source,
    resolvedAt: f.resolvedAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
  }));

  const serializedLessonProgress = lessonProgress.map(lp => ({
    ...lp,
    completedAt: lp.completedAt?.toISOString() ?? null,
    createdAt: lp.createdAt.toISOString(),
    updatedAt: lp.updatedAt.toISOString(),
  }));

  const serializedSummaries = summaries.map((s) => ({
    id: s.id,
    weekStartDate: s.weekStartDate.toISOString(),
    content: s.content,
    flags: s.flags as {
      risks: string[];
      achievements: string[];
      recommendedAction: string;
      overallHealth: 'green' | 'yellow' | 'red';
    } | null,
    metrics: s.metrics as {
      messageCount: number;
      lessonsCompleted: number;
      avgConfusion: number;
      avgFrustration: number;
      currentLesson: number;
      activeFlagCount: number;
    } | null,
    createdAt: s.createdAt.toISOString(),
  }));

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link href="/dashboard/socios" className="text-sm text-[#1B2A4A] hover:underline">
          &larr; {t.backToSocios}
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <span className={`inline-block w-4 h-4 rounded-full ${STATUS_COLORS[health.status]}`} />
          <h2 className="text-2xl font-bold text-gray-900">{socio.name || t.noName}</h2>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
          <span>{t.channel}: {socio.channelType}</span>
          <span>{t.language}: {socio.language}</span>
          <span>{t.currentLesson}: {progress.currentLessonNumber}</span>
          {latestFeedback?.rating != null && (
            <span>
              {t.satisfactionLabel}:{' '}
              <span className="font-medium text-gray-900">{latestFeedback.rating}/10</span>
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-gray-500">
          {health.reasons.map((r, i) => (
            <span key={i} className="mr-3">{r}</span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Chat + Send */}
        <div className="lg:col-span-2 space-y-4">
          <ChatHistory socioId={id} messages={serializedMessages} />
          <SendMessageForm socioId={id} initialAiPaused={socio.aiPaused} />
        </div>

        {/* Right column: Panels */}
        <div className="space-y-6">
          <SliderPanel
            socioId={id}
            initialComplexity={(overrides.complexity as number) ?? 0.5}
            initialWarmth={(overrides.warmth as number) ?? 0.5}
            initialPositivity={(overrides.positivity as number) ?? 0.5}
          />
          <FlagsPanel flags={serializedFlags} socioId={id} />
          <LessonProgressPanel lessonProgress={serializedLessonProgress} />
          <SummaryPanel socioId={id} summaries={serializedSummaries} />
          <RevenueChart data={serializedFinancials} />
        </div>
      </div>
    </div>
  );
}
