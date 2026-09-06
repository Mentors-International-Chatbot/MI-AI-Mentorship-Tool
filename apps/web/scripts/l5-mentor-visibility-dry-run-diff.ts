/**
 * L5 stage 3 of 5 — the dry-run diff (the gate).
 * ═══════════════════════════════════════════════════════════════════════════
 * See reports/l0.2.6-mentorid-reader-classification.md for the full staged
 * plan. This script writes nothing, ever — pure analysis, computing today's
 * (stage 2) roster semantics against what the `Enrollment ⋈
 * CourseStaffAssignment` join (stage 4) would produce, without switching
 * anything live. Three deltas are expected; only one is a plausible
 * stop-ship:
 *
 *   WIDENS  — a learner assigned to another mentor in the same course
 *             becomes visible. Intended (L5.3's shared model), but a mentor
 *             going from a caseload of 12 to 60 should be a decision made on
 *             purpose, not discovered after the swap. Reported per mentor.
 *   NARROWS — the mentorId===null org-wide fallback (verifyMentorOwnership)
 *             goes away. An unassigned socio in a course no mentor is
 *             staffed on becomes unreachable by *anyone*, not just one
 *             mentor — the fallback L5.4 already planned to delete, landing
 *             here instead of at UI time.
 *   BREAKS  — any socio with no ACTIVE Enrollment vanishes from every
 *             mentor's view under the join. Expected zero. THE ONE TO STOP
 *             SHIP ON IF NON-ZERO. Do not infer this from Phase A's August
 *             backfill history — run it against production, today.
 *
 * Usage:
 *   npx tsx scripts/l5-mentor-visibility-dry-run-diff.ts
 * ═══════════════════════════════════════════════════════════════════════════
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';

if (!process.env.DATABASE_URL) {
  console.error('[DryRunDiff] DATABASE_URL not set. Check your .env file.');
  process.exit(1);
}

async function main() {
  // ── Old roster: strict Socio.mentorId match, ACTIVE + unarchived ─────────
  // Mirrors mentorSocioWhere() in lib/repo/mentorVisibility.ts exactly —
  // this script intentionally does not import application code, so it stays
  // correct even if that file's predicate changes before stage 4 runs.
  const assignedSocios = await prisma.socio.findMany({
    where: { mentorId: { not: null }, status: 'ACTIVE', archivedAt: null },
    select: { id: true, mentorId: true, participantProfile: { select: { id: true } } },
  });

  const oldRosterByMentor = new Map<string, Set<string>>();
  for (const s of assignedSocios) {
    const mentorId = s.mentorId as string;
    if (!oldRosterByMentor.has(mentorId)) oldRosterByMentor.set(mentorId, new Set());
    oldRosterByMentor.get(mentorId)!.add(s.id);
  }

  // ── Unassigned socios, for the NARROWS/BREAKS checks ──────────────────────
  const unassignedSocios = await prisma.socio.findMany({
    where: { mentorId: null, status: 'ACTIVE', archivedAt: null },
    select: { id: true },
  });

  // ── New roster: Enrollment(learner, course) join CourseStaffAssignment(mentor, course) ──
  const assignments = await prisma.courseStaffAssignment.findMany({
    where: { endedAt: null },
    select: { mentorId: true, collectionKey: true },
  });
  const collectionKeysByMentor = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (!collectionKeysByMentor.has(a.mentorId)) collectionKeysByMentor.set(a.mentorId, new Set());
    collectionKeysByMentor.get(a.mentorId)!.add(a.collectionKey);
  }

  const activeEnrollments = await prisma.enrollment.findMany({
    where: { status: 'active' },
    select: { collectionKey: true, participant: { select: { socioId: true } } },
  });
  // All socioIds with ANY active enrollment in ANY course — used for BREAKS.
  const sociosWithActiveEnrollment = new Set(
    activeEnrollments.map((e) => e.participant.socioId).filter((id): id is string => id !== null),
  );
  // socioId sets per collectionKey, for building each mentor's new roster.
  const socioIdsByCollectionKey = new Map<string, Set<string>>();
  for (const e of activeEnrollments) {
    if (!e.participant.socioId || !e.collectionKey) continue;
    if (!socioIdsByCollectionKey.has(e.collectionKey)) socioIdsByCollectionKey.set(e.collectionKey, new Set());
    socioIdsByCollectionKey.get(e.collectionKey)!.add(e.participant.socioId);
  }

  const allMentorIds = new Set([...oldRosterByMentor.keys(), ...collectionKeysByMentor.keys()]);

  console.log('═'.repeat(78));
  console.log('WIDENS — per-mentor roster growth (new roster minus old roster)');
  console.log('═'.repeat(78));
  let anyWiden = false;
  for (const mentorId of allMentorIds) {
    const oldSet = oldRosterByMentor.get(mentorId) ?? new Set<string>();
    const newSet = new Set<string>();
    for (const key of collectionKeysByMentor.get(mentorId) ?? []) {
      for (const socioId of socioIdsByCollectionKey.get(key) ?? []) newSet.add(socioId);
    }
    const widened = [...newSet].filter((id) => !oldSet.has(id));
    if (widened.length > 0) {
      anyWiden = true;
      console.log(`  mentor=${mentorId}  ${oldSet.size} -> ${newSet.size}  (+${widened.length})`);
    }
  }
  if (!anyWiden) console.log('  (no mentor gains anyone)');

  console.log('\n' + '═'.repeat(78));
  console.log('NARROWS — unassigned socios reachable today only via the org-wide fallback,');
  console.log('unreachable by anyone once that fallback is removed');
  console.log('═'.repeat(78));
  // A currently-unassigned socio is reachable today by ANY mentor sharing its
  // org (verifyMentorOwnership's fallback). Under the join it needs an
  // active enrollment in a course SOME mentor is staffed on. Report the
  // ones that would have nobody.
  let orphanedByFallbackRemoval = 0;
  for (const socio of unassignedSocios) {
    const enrolled = activeEnrollments.filter((e) => e.participant.socioId === socio.id);
    const reachableUnderJoin = enrolled.some((e) =>
      [...collectionKeysByMentor.values()].some((keys) => e.collectionKey && keys.has(e.collectionKey)),
    );
    if (!reachableUnderJoin) orphanedByFallbackRemoval++;
  }
  console.log(`  unassigned, ACTIVE socios today : ${unassignedSocios.length}`);
  console.log(`  becomes unreachable by anyone   : ${orphanedByFallbackRemoval}`);

  console.log('\n' + '═'.repeat(78));
  console.log('BREAKS — assigned socios with no ACTIVE Enrollment at all (vanish under the join)');
  console.log('EXPECTED ZERO. STOP SHIP ON STAGE 4 IF NON-ZERO.');
  console.log('═'.repeat(78));
  const brokenSocioIds: string[] = [];
  for (const s of assignedSocios) {
    if (!sociosWithActiveEnrollment.has(s.id)) brokenSocioIds.push(s.id);
  }
  console.log(`  assigned ACTIVE socios total     : ${assignedSocios.length}`);
  console.log(`  with no ACTIVE enrollment at all : ${brokenSocioIds.length}`);
  if (brokenSocioIds.length > 0) {
    console.log('\n  Would vanish from every mentor\'s view under the join:');
    for (const id of brokenSocioIds) console.log(`      socio=${id}`);
  }

  console.log('\n' + '═'.repeat(78));
  console.log('SUMMARY');
  console.log('═'.repeat(78));
  console.log(`  mentors with any assignment (old or new) : ${allMentorIds.size}`);
  console.log(`  unassigned-socio fallback removals       : ${orphanedByFallbackRemoval}`);
  console.log(`  BREAKS (stop-ship if > 0)                : ${brokenSocioIds.length}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('[DryRunDiff] Failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
