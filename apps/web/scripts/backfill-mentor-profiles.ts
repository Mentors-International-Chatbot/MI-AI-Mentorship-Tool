/**
 * Backfill MentorProfile rows
 * ═══════════════════════════════════════════════════════════════════════════
 * Sibling to `backfill-participant-profiles.ts`. Same defect, one table over.
 *
 * `MentorProfile.organizationId` is the tenancy anchor for mentors, and every
 * mentor-facing page starts by resolving it:
 *
 *   getOrganizationIdByMentorId(mentorId)
 *     → mentorProfile.organizationId, or NULL
 *   → null means the page renders an EMPTY roster. Not an error, not a warning.
 *
 * So a mentor with no MentorProfile sees nothing, however many socios point at
 * them — even socios whose own ParticipantProfile is perfectly healthy. That is
 * what left `jacky jack` and `Verify GOOD-2` invisible after the participant
 * backfill: their side of the anchor was fixed, their mentor's was not.
 *
 * ── Resolution ──────────────────────────────────────────────────────────────
 * Delegated to `resolveMentorOrg` in `src/lib/tenancy/mentorAnchor.ts`, which
 * the runtime anchoring path also calls. See that module for the signal order
 * and for why there is deliberately no tier-3 default-org guess for mentors.
 *
 * Scope: data only. Nothing here touches mentor signup or creation code — that
 * path never creating a MentorProfile is the upstream bug, deferred per §10.
 *
 * Usage:
 *   npx tsx scripts/backfill-mentor-profiles.ts             # dry run (default)
 *   npx tsx scripts/backfill-mentor-profiles.ts --apply     # actually write
 *
 * Idempotent: writes are upserts keyed on the unique `mentorId`, and the scan
 * only selects mentors with no profile, so a second --apply is a no-op.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import {
  resolveMentorOrg,
  MENTOR_SIGNAL_LABEL,
  type MentorOrgSignal,
  type MentorOrgResolution,
} from '../src/lib/tenancy/mentorAnchor';

if (!process.env.DATABASE_URL) {
  console.error('[Backfill] DATABASE_URL not set. Check your .env file.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

type MentorRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
};

/**
 * Org resolution lives in `src/lib/tenancy/mentorAnchor.ts`, not here.
 *
 * This script and the runtime anchoring path must agree on "which org does this
 * mentor belong to" — two implementations of one rule is the exact defect that
 * produced the invisible-socio problem in the first place. The script simply
 * calls the shared resolver with no explicit org, since a backfill has no
 * creating-admin context to pass.
 */

/**
 * Read-only duplicate-name check.
 *
 * Reports only. A shared name is weak evidence — two real people can share one,
 * and the accounts hold different emails — so this never merges, deletes, or
 * links anything. It exists because a mentor "missing" a profile may actually
 * be a second account for someone who already has one, and backfilling that
 * account creates a working duplicate rather than fixing anything.
 */
async function reportDuplicateNames(): Promise<void> {
  const all = await prisma.mentor.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      mentorProfile: { select: { organizationId: true } },
      _count: { select: { socios: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const byName = new Map<string, typeof all>();
  for (const m of all) {
    const key = m.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), m]);
  }

  const collisions = [...byName.values()].filter((rows) => rows.length > 1);

  console.log('\n' + '─'.repeat(72));
  console.log('SIDE CHECK — mentors sharing a name (read-only, nothing modified)');
  console.log('─'.repeat(72));

  if (collisions.length === 0) {
    console.log('  none');
    return;
  }

  for (const rows of collisions) {
    const anyWithProfile = rows.some((r) => r.mentorProfile);
    const anyWithout = rows.some((r) => !r.mentorProfile);
    const flag = anyWithProfile && anyWithout ? '  ← POSSIBLE DUPLICATE ACCOUNT' : '';
    console.log(`\n  "${rows[0].name}" × ${rows.length}${flag}`);
    for (const r of rows) {
      console.log(
        `    ${r.id}  <${r.email}>  profile=${r.mentorProfile ? 'yes' : 'NO '}  ` +
          `socios=${r._count.socios}  created=${r.createdAt.toISOString().slice(0, 10)}`,
      );
    }
  }
  console.log('\n  Reported only — no merge, no delete, no relink.');
}

async function main() {
  console.log('═'.repeat(72));
  console.log(`MentorProfile backfill — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
  console.log('═'.repeat(72));

  const totalMentors = await prisma.mentor.count();
  const withProfile = await prisma.mentorProfile.count({ where: { mentorId: { not: null } } });
  const membershipRows = await prisma.organizationMembership.count();

  const missing = (await prisma.mentor.findMany({
    where: { mentorProfile: null },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })) as MentorRow[];

  console.log(`\nmentors total          : ${totalMentors}`);
  console.log(`already have a profile : ${withProfile}  (skipped-existing)`);
  console.log(`missing a profile      : ${missing.length}`);
  console.log(`OrganizationMembership : ${membershipRows} rows platform-wide` +
    (membershipRows === 0 ? '  ← signal 1 resolves nobody' : ''));

  const created: Array<{ mentor: MentorRow; signal: MentorOrgSignal; organizationId: string; detail: string }> = [];
  const unresolved: Array<{ mentor: MentorRow; kind: string; detail: string }> = [];

  const verb = APPLY ? 'created' : 'would create';

  console.log('\n── per mentor ─────────────────────────────────────────────');
  for (const mentor of missing) {
    const r: MentorOrgResolution = await resolveMentorOrg(mentor.id);

    if (r.kind !== 'resolved') {
      unresolved.push({ mentor, kind: r.kind, detail: r.detail });
      console.log(`  SKIP     ${mentor.name.padEnd(20)} <${mentor.email}>`);
      console.log(`           ${r.kind === 'ambiguous' ? 'AMBIGUOUS' : 'no signal'} — ${r.detail}`);
      continue;
    }

    if (APPLY) {
      await prisma.mentorProfile.upsert({
        where: { mentorId: mentor.id },
        update: {},
        create: {
          organizationId: r.organizationId,
          mentorId: mentor.id,
          displayName: mentor.name,
          // Mirrors the shape backfill-phase1 wrote, plus provenance: signal 2
          // is inferred from caseload, not declared by anyone, and a later
          // audit should be able to tell those apart.
          metadata: {
            email: mentor.email,
            legacyRole: mentor.role,
            backfilledBy: 'backfill-mentor-profiles',
            backfilledAt: new Date().toISOString(),
            orgResolutionSignal: r.signal,
          },
        },
      });
    }

    created.push({ mentor, signal: r.signal, organizationId: r.organizationId, detail: r.detail });
    console.log(`  ${verb.toUpperCase().padEnd(8)} ${mentor.name.padEnd(20)} <${mentor.email}>`);
    console.log(`           ${MENTOR_SIGNAL_LABEL[r.signal]} → org ${r.organizationId}  (${r.detail})`);
  }

  console.log('\n' + '═'.repeat(72));
  console.log('SUMMARY');
  console.log(`  ${verb.padEnd(17)} : ${created.length}${APPLY ? '' : ' (dry run — nothing written)'}`);
  console.log(`  skipped-existing  : ${withProfile}`);
  console.log(`  unresolved        : ${unresolved.length}`);
  if (unresolved.length > 0) {
    for (const u of unresolved) {
      console.log(`      ${u.mentor.id}  ${u.mentor.name}  (${u.kind}: ${u.detail})`);
    }
  }
  console.log('═'.repeat(72));

  await reportDuplicateNames();

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.');
  } else if (unresolved.length > 0) {
    console.log(
      `\n${unresolved.length} mentor(s) still have no tenant and will keep seeing an empty ` +
        `roster. That is correct for a mentor with no socios; give them an ` +
        `OrganizationMembership or an assigned socio, then re-run.`,
    );
  }
}

main()
  .catch((err) => {
    console.error('[Backfill] Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
