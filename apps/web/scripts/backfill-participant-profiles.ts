/**
 * Backfill ParticipantProfile rows
 * ═══════════════════════════════════════════════════════════════════════════
 * `ParticipantProfile.organizationId` is the tenancy anchor for socios — the
 * Socio row carries no organizationId of its own. Every mentor-facing read goes
 * through it:
 *
 *   getSociosForMentor(orgId, mentorId)
 *     → where: { status: 'ACTIVE', mentorId, participantProfile: { organizationId } }
 *
 * A socio with no profile therefore fails that join and is invisible on
 * /dashboard/learners and /dashboard/alerts, no matter what `Socio.mentorId`
 * says. That exclusion is deliberate in the repo (an unanchored socio has no
 * tenant and must not leak into a tenant's list) — the bug is not the filter,
 * it is that rows exist without the anchor. This script creates the anchor.
 *
 * Org resolution reuses the production chain verbatim
 * (`tenantPrismaRepo.resolveOrganizationForSocio`) rather than reimplementing
 * it, so a backfilled socio lands in exactly the tenant the app would have put
 * it in:
 *
 *   tier 1  participant_profile — cannot occur here by construction; we only
 *           look at socios that have no profile. Reported as an anomaly if seen.
 *   tier 2  collection_key      — authoritative. Create.
 *   tier 3  default             — a guess, not a tenant identification. WRITE
 *           NOTHING. Creating a profile from tier 3 would hard-code an orphan
 *           into whatever DEFAULT_ORGANIZATION_ID happens to say, converting a
 *           loud per-request warning into a silent permanent row in the wrong
 *           tenant. Tier 3 socios are reported for a human to assign.
 *
 * Scope: data only. Nothing here touches signup, WhatsApp onboarding, seeding,
 * curriculum selection, or MentoringRelationship semantics.
 *
 * Usage:
 *   npx tsx scripts/backfill-participant-profiles.ts             # dry run (default)
 *   npx tsx scripts/backfill-participant-profiles.ts --apply     # actually write
 *
 * Idempotent: writes are upserts keyed on the unique `socioId`, and the scan
 * only selects socios with no profile, so a second --apply is a no-op.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { tenantPrismaRepo } from '../src/lib/repo/tenantPrismaRepo';
import type { OrgResolutionSource } from '../src/lib/repo/tenantRepo.types';

if (!process.env.DATABASE_URL) {
  console.error('[Backfill] DATABASE_URL not set. Check your .env file.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

type SocioRow = {
  id: string;
  name: string | null;
  language: string;
  status: string;
  mentorId: string | null;
  curriculumCollectionKey: string | null;
};

type Resolution =
  | { kind: 'resolved'; source: OrgResolutionSource; organizationId: string }
  | { kind: 'tier3'; reason: string };

type Created = { id: string; source: OrgResolutionSource; organizationId: string };

type GroupResult = {
  label: string;
  socios: SocioRow[];
  created: Created[];
  tier3: Array<{ id: string; reason: string }>;
  anomalies: string[];
};

/** Tier label for the console, so "which tier" is never inferred from a source string. */
const TIER: Record<OrgResolutionSource, string> = {
  participant_profile: 'tier 1 (profile)',
  collection_key: 'tier 2 (curriculum)',
  default: 'tier 3 (default org)',
};

function tally<T extends string>(values: T[]): string {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${k} × ${n}`).join(', ') || 'none';
}

/**
 * Runs the production chain and classifies the answer.
 *
 * Tier 3 arrives two ways and both mean the same thing: the socio is an orphan.
 * With DEFAULT_ORGANIZATION_ID set the chain returns `source: 'default'`;
 * without it the chain throws rather than guess. Neither is a resolution, so
 * both land here as `tier3` and neither writes.
 */
async function resolveOrg(socioId: string): Promise<Resolution> {
  try {
    const { organizationId, source } = await tenantPrismaRepo.resolveOrganizationForSocio(socioId);
    if (source === 'default') {
      return { kind: 'tier3', reason: `default org ${organizationId} (no profile, no resolvable curriculum)` };
    }
    return { kind: 'resolved', source, organizationId };
  } catch (err) {
    return {
      kind: 'tier3',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

async function processGroup(label: string, socios: SocioRow[]): Promise<GroupResult> {
  const result: GroupResult = { label, socios, created: [], tier3: [], anomalies: [] };

  for (const socio of socios) {
    const resolution = await resolveOrg(socio.id);

    if (resolution.kind === 'tier3') {
      result.tier3.push({ id: socio.id, reason: resolution.reason });
      continue;
    }

    if (resolution.source === 'participant_profile') {
      // Impossible given the scan filter. If it fires, the scan and the chain
      // disagree about what "has a profile" means, and that is worth knowing.
      result.anomalies.push(socio.id);
      continue;
    }

    if (APPLY) {
      await prisma.participantProfile.upsert({
        where: { socioId: socio.id },
        update: {},
        create: {
          organizationId: resolution.organizationId,
          socioId: socio.id,
          displayName: socio.name,
          preferredLang: socio.language,
          // Provenance matters here: this row's tenant was inferred from the
          // socio's curriculum, not from an enrollment anyone performed. A
          // later audit should be able to tell those apart.
          metadata: {
            backfilledBy: 'backfill-participant-profiles',
            backfilledAt: new Date().toISOString(),
            orgResolutionSource: resolution.source,
          },
        },
      });
    }

    result.created.push({
      id: socio.id,
      source: resolution.source,
      organizationId: resolution.organizationId,
    });
  }

  return result;
}

function reportGroup(g: GroupResult, verboseIds: boolean): void {
  const verb = APPLY ? 'created' : 'would create';
  console.log(`\n── ${g.label} ─────────────────────────────────────────`);
  console.log(`   missing a profile : ${g.socios.length}`);
  console.log(`   ${verb.padEnd(17)} : ${g.created.length}`);
  console.log(`   unresolved tier 3 : ${g.tier3.length}`);
  if (g.anomalies.length > 0) {
    console.log(`   ANOMALY (chain says profile exists): ${g.anomalies.length}`);
  }

  if (g.created.length > 0) {
    console.log(`   resolved via      : ${tally(g.created.map((c) => TIER[c.source]))}`);
    console.log(`   landing in org    : ${tally(g.created.map((c) => c.organizationId))}`);
  }

  if (verboseIds && g.created.length > 0) {
    console.log(`\n   ${verb} (${g.created.length}):`);
    for (const c of g.created) {
      console.log(`     ${c.id}  ${TIER[c.source]}  org=${c.organizationId}`);
    }
  }

  if (g.tier3.length > 0) {
    console.log(`\n   tier 3 — NOT written, assign these by hand (${g.tier3.length}):`);
    for (const { id, reason } of g.tier3) console.log(`     ${id}  ${reason}`);
  }

  if (g.anomalies.length > 0) {
    console.log(`\n   anomalies (${g.anomalies.length}):`);
    for (const id of g.anomalies) console.log(`     ${id}`);
  }
}

async function main() {
  console.log('═'.repeat(72));
  console.log(`ParticipantProfile backfill — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
  console.log('═'.repeat(72));

  const totalSocios = await prisma.socio.count();
  const withProfile = await prisma.participantProfile.count({ where: { socioId: { not: null } } });

  const missing = (await prisma.socio.findMany({
    where: { participantProfile: null },
    select: {
      id: true,
      name: true,
      language: true,
      status: true,
      mentorId: true,
      curriculumCollectionKey: true,
    },
    orderBy: { createdAt: 'asc' },
  })) as SocioRow[];

  // Group (a) is the urgent set: these socios are ACTIVE and someone is
  // supposed to be mentoring them, so the missing anchor is actively hiding
  // live caseload. Group (b) is everything else missing an anchor.
  const groupA = missing.filter((s) => s.status === 'ACTIVE' && s.mentorId !== null);
  const groupB = missing.filter((s) => !(s.status === 'ACTIVE' && s.mentorId !== null));

  console.log(`\nsocios total          : ${totalSocios}`);
  console.log(`already have a profile: ${withProfile}  (skipped-existing)`);
  console.log(`missing a profile     : ${missing.length}`);

  const a = await processGroup('(a) ACTIVE with a mentor — urgent', groupA);
  const b = await processGroup('(b) everything else missing a profile', groupB);

  reportGroup(a, true);   // full id list, per the brief
  reportGroup(b, false);

  const created = a.created.length + b.created.length;
  const tier3 = a.tier3.length + b.tier3.length;

  console.log('\n' + '═'.repeat(72));
  console.log('SUMMARY');
  console.log(`  created           : ${created}${APPLY ? '' : ' (dry run — nothing written)'}`);
  console.log(`  skipped-existing  : ${withProfile}`);
  console.log(`  unresolved tier 3 : ${tier3}`);
  console.log('═'.repeat(72));

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.');
  } else if (tier3 > 0) {
    console.log(
      `\n${tier3} socio(s) remain invisible on purpose: tier 3 is a guess, not a tenant. ` +
        `Assign each one a curriculum or an enrollment, then re-run.`,
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
