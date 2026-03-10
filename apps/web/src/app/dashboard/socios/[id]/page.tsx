export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { repo } from '@/lib/repo';
import { computeSocioHealth } from '@/lib/health';
import { isSupportedLanguage, type SupportedLanguage } from '@/lib/i18n/languages';
import { getDashboardStrings } from '@/lib/i18n/dashboard';
import { ChatHistory } from './ChatHistory';
import { SendMessageForm } from './SendMessageForm';
import { SliderPanel } from './SliderPanel';
import { FlagsPanel } from './FlagsPanel';
import { LessonProgressPanel } from './LessonProgressPanel';

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

  const cookieStore = await cookies();
  const rawLang = cookieStore.get('dashboard_lang')?.value ?? 'en';
  const lang: SupportedLanguage = isSupportedLanguage(rawLang) ? rawLang : 'en';
  const t = getDashboardStrings(lang);

  const socio = await repo.getSocioById(id);
  if (!socio) notFound();

  const [health, progress, flags, lessonProgress, messages] = await Promise.all([
    computeSocioHealth(id),
    repo.getSocioProgress(id),
    repo.getFlags(id),
    repo.getLessonProgressAll(id),
    repo.getMessages(id, 50),
  ]);

  const overrides = (socio.promptOverrides ?? {}) as Record<string, number | string | undefined>;

  const serializedMessages = messages.map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));

  const serializedFlags = flags.map(f => ({
    ...f,
    resolvedAt: f.resolvedAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
  }));

  const serializedLessonProgress = lessonProgress.map(lp => ({
    ...lp,
    completedAt: lp.completedAt?.toISOString() ?? null,
    createdAt: lp.createdAt.toISOString(),
    updatedAt: lp.updatedAt.toISOString(),
  }));

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <a href="/dashboard/socios" className="text-sm text-[#1B2A4A] hover:underline">&larr; {t.backToSocios}</a>
        <div className="flex items-center gap-3 mt-2">
          <span className={`inline-block w-4 h-4 rounded-full ${STATUS_COLORS[health.status]}`} />
          <h2 className="text-2xl font-bold text-gray-900">{socio.name || t.noName}</h2>
        </div>
        <div className="flex gap-4 mt-1 text-sm text-gray-500">
          <span>{t.channel}: {socio.channelType}</span>
          <span>{t.language}: {socio.language}</span>
          <span>{t.currentLesson}: {progress.currentLessonNumber}</span>
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
          <ChatHistory messages={serializedMessages} />
          <SendMessageForm socioId={id} />
        </div>

        {/* Right column: Panels */}
        <div className="space-y-6">
          <SliderPanel
            socioId={id}
            initialComplexity={(overrides.complexity as number) ?? 0.5}
            initialWarmth={(overrides.warmth as number) ?? 0.5}
            initialPositivity={(overrides.positivity as number) ?? 0.5}
          />
          <FlagsPanel flags={serializedFlags} />
          <LessonProgressPanel lessonProgress={serializedLessonProgress} />
        </div>
      </div>
    </div>
  );
}
