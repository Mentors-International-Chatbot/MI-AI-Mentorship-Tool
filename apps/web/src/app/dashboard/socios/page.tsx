export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { repo } from '@/lib/repo';
import { computeSocioHealth, type SocioHealth } from '@/lib/health';
import { getDashboardStrings } from '@/lib/i18n/dashboard';
import { resolveDashboardLanguage } from '@/lib/i18n/resolveDashboardLanguage';
import { verifySession } from '@/lib/auth/session';
import { SocioListTable } from './SocioListTable';
import { Prisma } from '@prisma/client';

type SocioRow = {
  id: string;
  name: string | null;
  channelType: string;
  health: SocioHealth;
  currentLesson: number;
  lastInteractionAt: string | null;
};

const HEALTH_ORDER: Record<string, number> = { RED: 0, YELLOW: 1, GREEN: 2 };

function SchemaError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900">
      <h3 className="font-semibold mb-2">Database schema out of date</h3>
      <p className="text-sm mb-3">{message}</p>
      <p className="text-sm font-mono bg-amber-100 p-2 rounded">
        npx prisma migrate deploy
      </p>
      <p className="text-xs mt-2 text-amber-700">
        Run this in <code>apps/web</code> with a working DATABASE_URL (e.g. from your terminal).
      </p>
    </div>
  );
}

export default async function SociosPage() {
  const session = await verifySession();
  if (!session || session.role === 'socio') {
    redirect('/login');
  }

  const lang = await resolveDashboardLanguage();
  const t = getDashboardStrings(lang);

  let socios;
  try {
    socios = session.role === 'admin'
      ? await repo.getAllSocios()
      : await repo.getSociosByMentor(session.userId);
  } catch (err) {
    const isSchemaError =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === 'P2021' || err.code === 'P2010' || err.message?.includes('does not exist'));
    if (isSchemaError) {
      return (
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-6">{t.sociosTitle}</h2>
          <SchemaError message="A table or column used by the dashboard is missing. Apply migrations to sync the database with the schema." />
        </div>
      );
    }
    throw err;
  }

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
