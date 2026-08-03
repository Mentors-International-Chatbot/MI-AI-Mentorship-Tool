export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { repo, tenantRepo } from '@/lib/repo';
import { computeHealthFromData } from '@/lib/health';
import { getCourseSummaries } from '@/lib/journey-package/course-summaries';
import { getDashboardStrings } from '@/lib/i18n/dashboard';
import { resolveDashboardLanguage } from '@/lib/i18n/resolveDashboardLanguage';
import { verifySession } from '@/lib/auth/session';
import { SocioListTable } from './SocioListTable';
import { buildCourseRollups, type SocioRow } from './courseRollup';
import { Prisma } from '@prisma/client';

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
  // Set only on a tenant-scoped read. Left undefined for the platform admin so
  // course names resolve cross-tenant, matching the list they annotate.
  let scopedOrganizationId: string | undefined;
  try {
    if (session.role === 'admin') {
      // Platform admin is the one legitimate cross-tenant reader.
      socios = await repo.getSociosAcrossAllOrganizations();
    } else {
      // Mentors are scoped to their own organization. A mentor with no
      // MentorProfile has no resolvable tenant, so they see nothing — never
      // an unscoped fallback.
      const organizationId = await tenantRepo.getOrganizationIdByMentorId(session.userId);
      scopedOrganizationId = organizationId ?? undefined;
      socios = organizationId
        ? await tenantRepo.getSociosForMentor(organizationId, session.userId)
        : [];
    }
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

  // Flags are fetched here rather than inside `computeSocioHealth` so the exact
  // unresolved red/yellow counts survive: the health service reports only the
  // reasons that decided the status, dropping yellow flags on a socio already
  // RED. Calling `computeHealthFromData` with the same data also drops this
  // from three queries per socio to two.
  const rows: SocioRow[] = await Promise.all(
    socios.map(async (socio) => {
      const [flags, progress] = await Promise.all([
        repo.getFlags(socio.id),
        repo.getSocioProgress(socio.id),
      ]);
      const unresolved = flags.filter((f) => !f.resolved);
      return {
        id: socio.id,
        name: socio.name ?? null,
        channelType: socio.channelType,
        health: computeHealthFromData(flags, progress),
        currentLesson: progress.currentLessonNumber,
        lastInteractionAt: progress.lastInteractionAt?.toISOString() ?? null,
        curriculumCollectionKey: socio.curriculumCollectionKey ?? null,
        unresolvedRed: unresolved.filter((f) => f.level === 'RED').length,
        unresolvedYellow: unresolved.filter((f) => f.level === 'YELLOW').length,
      };
    })
  );

  rows.sort((a, b) => (HEALTH_ORDER[a.health.status] ?? 2) - (HEALTH_ORDER[b.health.status] ?? 2));

  // The only new data the rollups need: how long each course is, and what it is
  // called. Everything else is derived from `rows` above.
  const courses = await getCourseSummaries(
    rows.map((r) => r.curriculumCollectionKey).filter((k): k is string => k !== null),
    scopedOrganizationId,
  );
  const rollups = buildCourseRollups(rows, courses);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">{t.sociosTitle}</h2>
      <SocioListTable rows={rows} rollups={rollups} courses={courses} />
    </div>
  );
}
