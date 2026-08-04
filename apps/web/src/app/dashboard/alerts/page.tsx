export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { repo, tenantRepo } from '@/lib/repo';
import { createTenantContext } from '@/lib/repo/tenantContext';
import { computeHealthFromData } from '@/lib/health';
import { getCourseSummaries } from '@/lib/journey-package/course-summaries';
import { getCourseMeta, resolveLocalized } from '@/lib/courses/course-meta';
import { getDashboardStrings } from '@/lib/i18n/dashboard';
import { resolveDashboardLanguage } from '@/lib/i18n/resolveDashboardLanguage';
import { verifySession } from '@/lib/auth/session';
import { buildAlertZones, derivePositiveSignals, type ZoneSocioInput } from '@/lib/signals';
import { gatherPositiveSignalSources } from '@/lib/signals/gather';
import { AlertSnapshot, type AlertSnapshotSocio } from './AlertSnapshot';

/**
 * Mentor alert snapshot.
 *
 * Signals, not roster — `/dashboard/learners` stays the roster and keeps the
 * course rollup cards. This page answers a different question: who needs me.
 *
 * Scoping mirrors `/dashboard/learners` exactly, for the same reason stated
 * there: an admin opening a mentor-scoped page would see something silently
 * different from what a mentor sees, so admins go to the program-wide surface
 * instead.
 */
export default async function AlertsPage() {
  const session = await verifySession();
  if (!session || session.role === 'socio') {
    redirect('/login');
  }
  if (session.role === 'admin') {
    redirect('/admin/learners');
  }

  const lang = await resolveDashboardLanguage();
  const t = getDashboardStrings(lang);

  const organizationId = await tenantRepo.getOrganizationIdByMentorId(session.userId);
  const socios = organizationId
    ? await tenantRepo.getSociosForMentor(organizationId, session.userId)
    : [];

  // Zone inputs. Flags are fetched here rather than via `computeSocioHealth` so
  // the exact unresolved counts survive — the health service drops the yellow
  // reason on a socio already RED, and the zone-1 card needs the true total.
  const zoneInputs: ZoneSocioInput[] = await Promise.all(
    socios.map(async (socio) => {
      const [flags, progress] = await Promise.all([
        repo.getFlags(socio.id),
        repo.getSocioProgress(socio.id),
      ]);
      return {
        socioId: socio.id,
        name: socio.name ?? null,
        curriculumCollectionKey: socio.curriculumCollectionKey ?? null,
        currentLesson: progress.currentLessonNumber,
        health: computeHealthFromData(flags, progress),
        flags,
      };
    }),
  );

  // Positives are derived, never stored. A socio with no assessment sessions,
  // no completions, no gaps and no sentiment rows simply produces none.
  const positives = organizationId
    ? derivePositiveSignals(
        await gatherPositiveSignalSources(
          createTenantContext(organizationId),
          socios.map((s) => s.id),
        ),
      )
    : [];

  const zones = buildAlertZones(zoneInputs, positives);

  // Course chrome: lesson totals for "lesson X of N", and the participant noun.
  // The noun is resolved per course rather than once for the page — a mentor
  // with socios in two courses cannot have a single correct participant word.
  const collectionKeys = [
    ...new Set(
      zoneInputs
        .map((z) => z.curriculumCollectionKey)
        .filter((k): k is string => k !== null),
    ),
  ];
  const courses = await getCourseSummaries(collectionKeys, organizationId ?? undefined);
  const lessonCounts = new Map(courses.map((c) => [c.collectionKey, c.lessonCount]));
  const courseNames = new Map(courses.map((c) => [c.collectionKey, c.displayName]));

  const participantNouns = new Map(
    await Promise.all(
      collectionKeys.map(async (key): Promise<[string, string]> => {
        const meta = await getCourseMeta(key);
        return [key, resolveLocalized(meta.terminology.participant, lang)];
      }),
    ),
  );

  const decorations: Record<string, AlertSnapshotSocio> = {};
  for (const input of zoneInputs) {
    const key = input.curriculumCollectionKey;
    decorations[input.socioId] = {
      courseName: key ? courseNames.get(key) ?? null : null,
      lessonCount: key ? lessonCounts.get(key) ?? 0 : 0,
      participantNoun: key ? participantNouns.get(key) ?? null : null,
    };
  }

  // Zone 3 names people who may not be in zones 1 or 2 at all, so it needs its
  // own name lookup rather than reading one off a zone card.
  const socioNames: Record<string, string | null> = {};
  for (const socio of socios) socioNames[socio.id] = socio.name ?? null;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900">{t.signalsTitle}</h2>
      <p className="text-sm text-gray-600 mt-1 mb-6">{t.signalsSubtitle}</p>
      <AlertSnapshot
        zones={zones}
        decorations={decorations}
        socioNames={socioNames}
        t={t}
      />
    </div>
  );
}
