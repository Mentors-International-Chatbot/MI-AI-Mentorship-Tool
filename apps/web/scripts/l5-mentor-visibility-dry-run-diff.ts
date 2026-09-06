/**
 * L5 stage 3 of 5 — the dry-run diff (the gate).
 * ═══════════════════════════════════════════════════════════════════════════
 * See reports/l0.2.6-mentorid-reader-classification.md for the full staged
 * plan and "delta four" (the status-filtering axis this script accounts for
 * below). Writes nothing, ever — pure analysis.
 *
 * Runs standalone, before the stage 1 backfill has written a single row.
 * Rather than reading the real `CourseStaffAssignment` table, it derives the
 * same hypothetical mapping the backfill script would produce (each mentor's
 * staffed courses = the distinct collectionKeys of their own currently-
 * assigned socios' enrollments) directly from `Socio`/`Enrollment`. This is
 * exactly Michael's ask: "if it computes both sides from raw SQL... it may
 * run before the backfill." After the backfill actually runs, the real table
 * should match this derivation exactly (nothing else writes it yet) — running
 * this script again post-backfill is a cheap way to confirm that.
 *
 * ── Delta four: status is a second axis, separate from membership ─────────
 * `Enrollment.status` is `active | paused | completed | dropped` (not the
 * three-value `ACTIVE | ARCHIVED | COMPLETED` shorthand — `dropped` is what
 * the schema calls a retired/superseded enrollment; there is no literal
 * "archived" value today). Stage 2 found three readers (`getSociosForMentor`,
 * `mentorCaseloadScope`, the derived id-list) filter Socio.status=ACTIVE with
 * no enrollment-status opinion at all, while three others
 * (`verifyMentorOwnership`, the flag routes, the learner page) apply no
 * status filter whatsoever. Naively joining on `status: 'active'` enrollments
 * only would narrow every one of those six — a mentor could no longer open a
 * learner who *finished* the course, which is plainly wrong: completion is
 * the normal, expected end state, not an edge case.
 *
 * So this script's roster comparison — matching what a stage 4 "roster
 * listing" predicate should be — includes both `active` and `completed`
 * enrollments. `paused` is included too (a paused learner is still enrolled,
 * not gone) pending an explicit decision; `dropped` is excluded from the
 * roster comparison but would belong in a separate, broader "reachability"
 * predicate (open lookup by id, not list membership) per D10 — not modeled
 * here since this script diffs *rosters*, not per-socio reachability.
 *
 * ── Running order ──────────────────────────────────────────────────────────
 * See backfill-course-staff-assignment.ts's header for the full sequence
 * (Neon branch snapshot first — this migration is insert-only, which is not
 * the same as reversible). This script itself is safe to run standalone,
 * before or after the backfill, on a branch or on production directly — it
 * never writes.
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

// Roster-listing statuses (delta four). Not 'dropped' — see header comment.
const ROSTER_ENROLLMENT_STATUSES = ['active', 'completed', 'paused'] as const;

async function main() {
  // ── Old roster: strict Socio.mentorId match, ACTIVE + unarchived ─────────
  // Mirrors mentorSocioWhere() in lib/repo/mentorVisibility.ts exactly —
  // this script intentionally does not import application code, so it stays
  // correct even if that predicate changes before stage 4 runs.
  const assignedSocios = await prisma.socio.findMany({
    where: { mentorId: { not: null }, status: 'ACTIVE', archivedAt: null },
    select: { id: true, mentorId: true },
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

  // ── Enrollments feeding the join, at roster-listing statuses (delta four) ─
  const rosterEnrollments = await prisma.enrollment.findMany({
    where: { status: { in: [...ROSTER_ENROLLMENT_STATUSES] } },
    select: { collectionKey: true, participant: { select: { socioId: true } } },
  });
  // Any enrollment at all (including 'dropped'), for the BREAKS check only —
  // a socio who dropped one enrollment but has an active/completed one
  // elsewhere is not broken; a socio with literally zero enrollment rows is.
  const anyEnrollments = await prisma.enrollment.findMany({
    select: { participant: { select: { socioId: true } } },
  });
  const sociosWithAnyEnrollment = new Set(
    anyEnrollments.map((e) => e.participant.socioId).filter((id): id is string => id !== null),
  );

  const socioIdsByCollectionKey = new Map<string, Set<string>>();
  for (const e of rosterEnrollments) {
    if (!e.participant.socioId || !e.collectionKey) continue;
    if (!socioIdsByCollectionKey.has(e.collectionKey)) socioIdsByCollectionKey.set(e.collectionKey, new Set());
    socioIdsByCollectionKey.get(e.collectionKey)!.add(e.participant.socioId);
  }

  // ── Hypothetical CourseStaffAssignment, derived exactly as the stage 1 ────
  // backfill script derives it — NOT read from the real table. See header.
  const collectionKeysByEnrollmentForSocio = new Map<string, Set<string>>();
  for (const e of rosterEnrollments) {
    if (!e.participant.socioId || !e.collectionKey) continue;
    if (!collectionKeysByEnrollmentForSocio.has(e.participant.socioId)) {
      collectionKeysByEnrollmentForSocio.set(e.participant.socioId, new Set());
    }
    collectionKeysByEnrollmentForSocio.get(e.participant.socioId)!.add(e.collectionKey);
  }
  const collectionKeysByMentor = new Map<string, Set<string>>();
  for (const [mentorId, socioIds] of oldRosterByMentor) {
    const keys = new Set<string>();
    for (const socioId of socioIds) {
      for (const key of collectionKeysByEnrollmentForSocio.get(socioId) ?? []) keys.add(key);
    }
    if (keys.size > 0) collectionKeysByMentor.set(mentorId, keys);
  }

  console.log('═'.repeat(78));
  console.log('WIDENS — per-mentor roster growth (new roster minus old roster)');
  console.log('Read this with your own eyes, not just the count: 12 -> 60 is the shared-');
  console.log('model feature working. 12 -> 400 means a mentor\'s assigned socios span an');
  console.log('unexpectedly large set of courses, or those courses have unexpectedly large');
  console.log('rosters themselves — look at *why* before accepting either number.');
  console.log('═'.repeat(78));
  let anyWiden = false;
  for (const [mentorId, oldSet] of oldRosterByMentor) {
    const newSet = new Set<string>();
    for (const key of collectionKeysByMentor.get(mentorId) ?? []) {
      for (const socioId of socioIdsByCollectionKey.get(key) ?? []) newSet.add(socioId);
    }
    const widened = [...newSet].filter((id) => !oldSet.has(id));
    if (widened.length > 0) {
      anyWiden = true;
      const courses = [...(collectionKeysByMentor.get(mentorId) ?? [])];
      console.log(`  mentor=${mentorId}  ${oldSet.size} -> ${newSet.size}  (+${widened.length})  courses=[${courses.join(', ')}]`);
    }
  }
  if (!anyWiden) console.log('  (no mentor gains anyone)');

  console.log('\n' + '═'.repeat(78));
  console.log('NARROWS — two kinds, do not conflate them');
  console.log('═'.repeat(78));

  // Kind 1: expected — the mentorId===null org-wide fallback going away.
  let orphanedByFallbackRemoval = 0;
  for (const socio of unassignedSocios) {
    const keys = collectionKeysByEnrollmentForSocio.get(socio.id) ?? new Set<string>();
    const reachableUnderJoin = [...keys].some((key) =>
      [...collectionKeysByMentor.values()].some((mentorKeys) => mentorKeys.has(key)),
    );
    if (!reachableUnderJoin) orphanedByFallbackRemoval++;
  }
  console.log(`  (1) expected — unassigned-socio fallback removal`);
  console.log(`      unassigned, ACTIVE socios today : ${unassignedSocios.length}`);
  console.log(`      becomes unreachable by anyone   : ${orphanedByFallbackRemoval}`);

  // Kind 2: NOT expected — an old-roster member who disappears from the new
  // roster for a reason other than the fallback (e.g. a status/derivation
  // gap — "delta four showing up early" if this is ever non-zero).
  let unexpectedNarrow = 0;
  for (const [mentorId, oldSet] of oldRosterByMentor) {
    const newSet = new Set<string>();
    for (const key of collectionKeysByMentor.get(mentorId) ?? []) {
      for (const socioId of socioIdsByCollectionKey.get(key) ?? []) newSet.add(socioId);
    }
    for (const socioId of oldSet) {
      if (!newSet.has(socioId)) unexpectedNarrow++;
    }
  }
  console.log(`  (2) UNEXPECTED — old-roster member absent from the new roster for any other`);
  console.log(`      reason (should be 0; every old-roster socio has this mentor staffed on`);
  console.log(`      at least one of their own enrollment's courses, by construction of the`);
  console.log(`      hypothetical derivation above)`);
  console.log(`      count : ${unexpectedNarrow}${unexpectedNarrow > 0 ? '  <-- investigate before stage 4' : ''}`);

  console.log('\n' + '═'.repeat(78));
  console.log('BREAKS — assigned socios with NO enrollment at all (vanish under the join)');
  console.log('Includes completed/paused/dropped enrollments in the "has one" check — only');
  console.log('a socio with zero enrollment rows of any status counts as broken.');
  console.log('EXPECTED ZERO. STOP SHIP ON STAGE 4 IF NON-ZERO.');
  console.log('═'.repeat(78));
  const brokenSocioIds = assignedSocios.filter((s) => !sociosWithAnyEnrollment.has(s.id)).map((s) => s.id);
  console.log(`  assigned ACTIVE socios total     : ${assignedSocios.length}`);
  console.log(`  with no enrollment at all        : ${brokenSocioIds.length}`);
  if (brokenSocioIds.length > 0) {
    console.log('\n  Would vanish from every mentor\'s view under the join:');
    for (const id of brokenSocioIds) console.log(`      socio=${id}`);
  }

  console.log('\n' + '═'.repeat(78));
  console.log('SUMMARY');
  console.log('═'.repeat(78));
  console.log(`  mentors with an old-roster socio           : ${oldRosterByMentor.size}`);
  console.log(`  unassigned-socio fallback removals (kind 1) : ${orphanedByFallbackRemoval}`);
  console.log(`  unexpected narrows (kind 2, delta four)     : ${unexpectedNarrow}`);
  console.log(`  BREAKS (stop-ship if > 0)                   : ${brokenSocioIds.length}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('[DryRunDiff] Failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
