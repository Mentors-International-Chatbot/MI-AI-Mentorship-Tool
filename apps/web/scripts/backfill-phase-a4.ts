/**
 * Platform Restructure Phase A, Stage 4 (A.4) — enrollmentId backfill on
 * BlockProgress, MilestoneProgress, AssessmentSession.
 *
 * SocioFeedback is deliberately excluded — see the comment at its writer in
 * messaging/handler.ts.
 *
 * Per-table join, established in the Stage 4 investigation:
 *  - BlockProgress, MilestoneProgress: direct join via collectionKey
 *    (participant + collectionKey -> Enrollment).
 *  - AssessmentSession: no collectionKey column. Resolve via
 *    lessonKey -> ContentLesson -> collection.slug, narrowed by the
 *    owning socio's curriculumCollectionKey (disambiguates the
 *    theoretical case of the same lessonKey slug existing in more than
 *    one collection — zero such collisions existed as of the investigation).
 *
 * Tie-break when a participant has more than one Enrollment for the same
 * collectionKey (not observed in current data, but the partial unique index
 * only guarantees uniqueness among ACTIVE rows): prefer status='active',
 * else the most recently enrolled.
 *
 * Idempotent: only ever sets enrollmentId on rows where it is currently
 * null; safe to re-run.
 *
 * Run: npx tsx -r dotenv/config scripts/backfill-phase-a4.ts
 */
import { prisma } from '@/lib/db';

async function resolveEnrollmentId(socioId: string, collectionKey: string): Promise<string | null> {
  const socio = await prisma.socio.findUnique({ where: { id: socioId }, select: { participantProfile: { select: { id: true } } } });
  if (!socio?.participantProfile) return null;
  const candidates = await prisma.enrollment.findMany({
    where: { participantId: socio.participantProfile.id, collectionKey },
    orderBy: [{ enrolledAt: 'desc' }],
  });
  if (candidates.length === 0) return null;
  const active = candidates.find((c) => c.status === 'active');
  return (active ?? candidates[0]).id;
}

async function main() {
  console.log('=== BlockProgress ===');
  const bpRows = await prisma.blockProgress.findMany({ where: { enrollmentId: null }, select: { id: true, socioId: true, collectionKey: true } });
  let bpUpdated = 0;
  const bpUnmatched: unknown[] = [];
  for (const row of bpRows) {
    const enrollmentId = await resolveEnrollmentId(row.socioId, row.collectionKey);
    if (enrollmentId) {
      await prisma.blockProgress.update({ where: { id: row.id }, data: { enrollmentId } });
      bpUpdated++;
    } else {
      bpUnmatched.push(row);
    }
  }
  console.log(`Updated: ${bpUpdated} / ${bpRows.length}. Unmatched: ${bpUnmatched.length}`);
  if (bpUnmatched.length > 0) console.log('  UNMATCHED:', JSON.stringify(bpUnmatched));

  console.log('\n=== MilestoneProgress ===');
  const mpRows = await prisma.milestoneProgress.findMany({ where: { enrollmentId: null }, select: { id: true, socioId: true, collectionKey: true } });
  let mpUpdated = 0;
  const mpUnmatched: unknown[] = [];
  for (const row of mpRows) {
    const enrollmentId = await resolveEnrollmentId(row.socioId, row.collectionKey);
    if (enrollmentId) {
      await prisma.milestoneProgress.update({ where: { id: row.id }, data: { enrollmentId } });
      mpUpdated++;
    } else {
      mpUnmatched.push(row);
    }
  }
  console.log(`Updated: ${mpUpdated} / ${mpRows.length}. Unmatched: ${mpUnmatched.length}`);
  if (mpUnmatched.length > 0) console.log('  UNMATCHED:', JSON.stringify(mpUnmatched));

  console.log('\n=== AssessmentSession ===');
  const asRows = await prisma.assessmentSession.findMany({ where: { enrollmentId: null }, select: { id: true, socioId: true, lessonKey: true } });
  let asUpdated = 0;
  const asUnmatched: unknown[] = [];
  for (const row of asRows) {
    const socio = await prisma.socio.findUnique({ where: { id: row.socioId }, select: { curriculumCollectionKey: true } });
    if (!socio?.curriculumCollectionKey) { asUnmatched.push({ ...row, reason: 'socio has no curriculumCollectionKey' }); continue; }
    const lessonMatch = await prisma.contentLesson.findFirst({
      where: { slug: row.lessonKey, collection: { slug: socio.curriculumCollectionKey } },
      select: { id: true },
    });
    if (!lessonMatch) { asUnmatched.push({ ...row, reason: `lessonKey does not resolve within ${socio.curriculumCollectionKey}` }); continue; }
    const enrollmentId = await resolveEnrollmentId(row.socioId, socio.curriculumCollectionKey);
    if (enrollmentId) {
      await prisma.assessmentSession.update({ where: { id: row.id }, data: { enrollmentId } });
      asUpdated++;
    } else {
      asUnmatched.push({ ...row, reason: 'no enrollment found', collectionKey: socio.curriculumCollectionKey });
    }
  }
  console.log(`Updated: ${asUpdated} / ${asRows.length}. Unmatched: ${asUnmatched.length}`);
  if (asUnmatched.length > 0) console.log('  UNMATCHED:', JSON.stringify(asUnmatched));

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
