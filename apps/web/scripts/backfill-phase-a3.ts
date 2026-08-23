/**
 * Platform Restructure Phase A, Stage 3 (A.3) — Enrollment-creation pass for
 * orphaned socios.
 *
 * Two groups, both derived and reported (see the Stage 3 chat transcript)
 * before this ran:
 *
 *  - 13 zero-enrollment socios: get a fresh ACTIVE enrollment via the one
 *    shared creation path (resolveOrCreateActiveEnrollment), pinned to the
 *    current PUBLISHED version of their curriculumCollectionKey.
 *  - 3 dangling-draft-ProgramVersion socios (Brad Lees, Sean Murdock
 *    9594c1bd, Sam Kimball): soft-archived as confirmed test accounts — no
 *    deletes, no fresh enrollment. Their dangling Enrollment row is dropped
 *    (status: 'dropped') so it exits the ACTIVE partial-unique-index scope.
 *
 * Idempotent: re-running is safe. archiveSocio no-ops on an already-archived
 * socio; resolveOrCreateActiveEnrollment resolves the existing row for
 * anyone already enrolled; dropping an already-dropped enrollment is a
 * harmless no-op update.
 *
 * Run: npx tsx -r dotenv/config scripts/backfill-phase-a3.ts
 */
import { repo } from '@/lib/repo';
import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { createTenantContext } from '@/lib/repo/tenantContext';
import { prisma } from '@/lib/db';

const ORG_ID = '8d1ca50e-b191-4934-ad36-0d9873ce247a';

const ZERO_ENROLLMENT: Array<{ socioId: string; name: string; participantId: string; programVersionId: string; collectionKey: string }> = [
  { socioId: 'bac9a3eb-2d7d-4e52-8249-ee7f25b39c9e', name: 'Mike', participantId: 'd78e55f4-6bf9-4b34-af82-ef432129cebb', programVersionId: '6b78b551-c0d9-4746-a19f-af19e277c325', collectionKey: 'mi-colombia-curriculum' },
  { socioId: '5b0367f2-1de0-4c4f-b55a-b5382ea260f9', name: 'Verify CONFUSED', participantId: '2c0d4cdf-f65c-4219-a613-50e57da73508', programVersionId: '242a0ee7-142e-44d6-a6bf-944ffcea8c5d', collectionKey: 'pbj-basics' },
  { socioId: '91890a6d-c1bd-4b4b-a01b-76f4a22b60e9', name: 'Sean Murdock', participantId: '3a2d7047-c2e5-47dd-9fd4-05880c39f484', programVersionId: '242a0ee7-142e-44d6-a6bf-944ffcea8c5d', collectionKey: 'pbj-basics' },
  { socioId: 'a6783ee4-dd08-4593-9661-75506274558e', name: 'aug 3', participantId: '837676ef-cab3-46d3-bf19-02a6fff98ee5', programVersionId: '242a0ee7-142e-44d6-a6bf-944ffcea8c5d', collectionKey: 'pbj-basics' },
  { socioId: '4a029e0f-3959-427c-a465-bb213822327b', name: 'Michael B aug 3', participantId: '55e453cd-9620-4137-bc69-b49f2da94c16', programVersionId: '6b78b551-c0d9-4746-a19f-af19e277c325', collectionKey: 'mi-colombia-curriculum' },
  { socioId: 'ce2a3005-4647-4f3c-aa46-49ded77c40d8', name: '8/10/26 (2)', participantId: 'f6d5d465-6dfa-4d52-83f3-58f3cb74e706', programVersionId: '242a0ee7-142e-44d6-a6bf-944ffcea8c5d', collectionKey: 'pbj-basics' },
  { socioId: '16902892-362f-45c2-bb39-bb13c3cf225c', name: 'Eira Groberg', participantId: '4317645d-fd52-484d-b6ae-db4781eed6c1', programVersionId: '242a0ee7-142e-44d6-a6bf-944ffcea8c5d', collectionKey: 'pbj-basics' },
  { socioId: '01e4b01d-5264-4010-8e5b-a35c1e61dd27', name: 'Prof Sampson', participantId: 'd0fe0ca6-93f0-4d02-94e3-e46abafd49fe', programVersionId: '242a0ee7-142e-44d6-a6bf-944ffcea8c5d', collectionKey: 'pbj-basics' },
  { socioId: '83bc5701-0790-4ce1-893a-a9da5424591f', name: 'Eira Groberg.mi', participantId: '97a01576-9304-4572-bcd1-3c0d58e4e1af', programVersionId: '6b78b551-c0d9-4746-a19f-af19e277c325', collectionKey: 'mi-colombia-curriculum' },
  { socioId: 'deea7d22-f963-45c8-bf6d-07156bee2cb1', name: 'Ryan2', participantId: '9c3ba4ed-f408-40ec-9d45-feee3143a0e8', programVersionId: '242a0ee7-142e-44d6-a6bf-944ffcea8c5d', collectionKey: 'pbj-basics' },
  { socioId: '690475e2-033b-4b0f-abb6-8d6f3208d61d', name: 'Amelia Burrell', participantId: 'a145a861-66a6-49f7-af3c-c68539e67ed9', programVersionId: '242a0ee7-142e-44d6-a6bf-944ffcea8c5d', collectionKey: 'pbj-basics' },
  { socioId: '1bddf5dc-30d5-4b0e-bc08-4c16a6186e4c', name: 'Pb & J Bois', participantId: '7914da88-71b2-46e4-8228-c363bc66eebb', programVersionId: '242a0ee7-142e-44d6-a6bf-944ffcea8c5d', collectionKey: 'pbj-basics' },
  { socioId: '13811640-efcd-40c1-a576-c5b31afcb9c7', name: 'Lucy Levie', participantId: '5f0477ff-1c29-41af-a33a-0c3cded98812', programVersionId: '242a0ee7-142e-44d6-a6bf-944ffcea8c5d', collectionKey: 'pbj-basics' },
];

const DANGLING: Array<{ socioId: string; name: string; danglingEnrollmentId: string }> = [
  { socioId: '5054d8c0-5dd9-4ac3-b825-2628423fd769', name: 'Brad Lees', danglingEnrollmentId: '04e3efe7-4ecc-4a68-853a-8f10b04b9df9' },
  { socioId: '9594c1bd-67f1-40dc-ba83-fa235333ac15', name: 'Sean Murdock (9594c1bd)', danglingEnrollmentId: '2168aa5f-cb80-4d04-b0a1-a9723d929dd0' },
  { socioId: 'f1520e6c-3277-499e-b678-6b499d061f69', name: 'Sam Kimball', danglingEnrollmentId: '66a0b827-e926-4ad4-9a46-97a097b2259d' },
];

async function main() {
  const ctx = createTenantContext(ORG_ID);

  console.log('=== Writing 13 zero-enrollment socios ===');
  for (const row of ZERO_ENROLLMENT) {
    const enrollment = await tenantPrismaRepo.resolveOrCreateActiveEnrollment(ctx, {
      participantId: row.participantId,
      programVersionId: row.programVersionId,
      channel: 'web',
    });
    console.log(`${row.name} (${row.socioId}): enrollment ${enrollment.id}, collectionKey=${enrollment.collectionKey}, status=${enrollment.status}`);
  }

  console.log('');
  console.log('=== Soft-archiving 3 dangling-draft socios ===');
  for (const row of DANGLING) {
    const socio = await repo.archiveSocio(row.socioId);
    const enrollment = await tenantPrismaRepo.updateEnrollmentStatus(ctx, row.danglingEnrollmentId, 'dropped');
    console.log(`${row.name} (${row.socioId}): archivedAt=${socio.archivedAt?.toISOString()}, enrollment ${enrollment.id} status=${enrollment.status}`);
  }

  console.log('');
  console.log('=== Post-pass assertion: zero non-archived socios without a resolvable ACTIVE enrollment ===');
  const nonArchived = await prisma.socio.findMany({
    where: { status: 'ACTIVE', archivedAt: null },
    select: { id: true, name: true, participantProfile: { select: { enrollments: { where: { status: 'active' }, select: { id: true, collectionKey: true } } } } },
  });
  const unresolved = nonArchived.filter((s) => (s.participantProfile?.enrollments.length ?? 0) === 0);
  console.log(`Non-archived socios: ${nonArchived.length}`);
  console.log(`Unresolved (no ACTIVE enrollment): ${unresolved.length}`);
  for (const u of unresolved) console.log(`  UNRESOLVED: ${u.id} (${u.name})`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
