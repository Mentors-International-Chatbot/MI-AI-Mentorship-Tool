export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { repo } from '@/lib/repo';
import { computeSocioHealth, type SocioHealth } from '@/lib/health';
import { isSupportedLanguage, type SupportedLanguage } from '@/lib/i18n/languages';
import { getDashboardStrings } from '@/lib/i18n/dashboard';
import { SocioListTable } from './SocioListTable';

type SocioRow = {
  id: string;
  name: string | null;
  channelType: string;
  health: SocioHealth;
  currentLesson: number;
  lastInteractionAt: string | null;
};

const HEALTH_ORDER: Record<string, number> = { RED: 0, YELLOW: 1, GREEN: 2 };

export default async function SociosPage() {
  const cookieStore = await cookies();
  const rawLang = cookieStore.get('dashboard_lang')?.value ?? 'en';
  const lang: SupportedLanguage = isSupportedLanguage(rawLang) ? rawLang : 'en';
  const t = getDashboardStrings(lang);

  const socios = await repo.getAllSocios();

  const rows: SocioRow[] = await Promise.all(
    socios.map(async (socio) => {
      const [health, progress] = await Promise.all([
        computeSocioHealth(socio.id),
        repo.getSocioProgress(socio.id),
      ]);
      return {
        id: socio.id,
        name: socio.name ?? null,
        channelType: socio.channelType,
        health,
        currentLesson: progress.currentLessonNumber,
        lastInteractionAt: progress.lastInteractionAt?.toISOString() ?? null,
      };
    })
  );

  rows.sort((a, b) => (HEALTH_ORDER[a.health.status] ?? 2) - (HEALTH_ORDER[b.health.status] ?? 2));

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">{t.sociosTitle}</h2>
      <SocioListTable rows={rows} />
    </div>
  );
}
