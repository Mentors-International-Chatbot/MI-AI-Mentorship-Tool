// Loads TEST_DATABASE_URL for the equivalence check below.
import 'dotenv/config';
import { describe, it, expect, afterEach } from 'vitest';
import { isFlagActive, activeFlagWhere, type FlagLike } from '@/lib/flags/active';

/**
 * The whole point of this file: a TS predicate and a Prisma where clause are two
 * expressions of one rule, and nothing but a test stops them drifting. The unit
 * cases below pin the semantics; the DB case proves Postgres agrees.
 *
 * ── Why TEST_DATABASE_URL and not DATABASE_URL ──────────────────────────────
 * The equivalence check writes rows. `DATABASE_URL` is the shared Neon dev
 * database that also holds real pilot data, so pointing this at it would mean
 * every `vitest run` — including two developers at once, or CI on main —
 * mutates it. Same hazard class as SHADOW_DATABASE_URL pointing at live dev.
 * Point TEST_DATABASE_URL at a disposable Neon branch instead.
 *
 * Absence is handled asymmetrically on purpose. Locally, missing config skips
 * with a loud warning: convenience. In CI, missing config FAILS: a silently
 * skipped equivalence test is the vacuous green this file exists to prevent.
 * ────────────────────────────────────────────────────────────────────────────
 */

const NOW = new Date('2026-08-05T12:00:00Z');
const past = new Date(NOW.getTime() - 60 * 60 * 1000);
const future = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);

type Fixture = { key: string; flag: FlagLike; expected: boolean };

/** One row per lifecycle state the schema can produce. */
const FIXTURES: Fixture[] = [
  { key: 'open', flag: { resolved: false, status: 'OPEN', snoozedUntil: null }, expected: true },
  { key: 'acknowledged', flag: { resolved: false, status: 'ACKNOWLEDGED', snoozedUntil: null }, expected: true },
  { key: 'reopened', flag: { resolved: false, status: 'REOPENED', snoozedUntil: null }, expected: true },
  { key: 'snoozed-future', flag: { resolved: false, status: 'SNOOZED', snoozedUntil: future }, expected: false },
  { key: 'snoozed-past', flag: { resolved: false, status: 'SNOOZED', snoozedUntil: past }, expected: true },
  { key: 'snoozed-null', flag: { resolved: false, status: 'SNOOZED', snoozedUntil: null }, expected: true },
  { key: 'resolved', flag: { resolved: true, status: 'RESOLVED', snoozedUntil: null }, expected: false },
  { key: 'resolved-stale-snooze', flag: { resolved: true, status: 'RESOLVED', snoozedUntil: past }, expected: false },
  { key: 'auto-closed', flag: { resolved: false, status: 'AUTO_CLOSED', snoozedUntil: null }, expected: false },
  { key: 'auto-closed-past-snooze', flag: { resolved: false, status: 'AUTO_CLOSED', snoozedUntil: past }, expected: false },
];

describe('isFlagActive', () => {
  for (const { key, flag, expected } of FIXTURES) {
    it(`${key} → ${expected ? 'active' : 'inactive'}`, () => {
      expect(isFlagActive(flag, NOW)).toBe(expected);
    });
  }

  it('a snooze expiring exactly now counts as expired', () => {
    expect(isFlagActive({ resolved: false, status: 'SNOOZED', snoozedUntil: NOW }, NOW)).toBe(true);
  });
});

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const IN_CI = !!process.env.CI;
const TEST_NAME = 'activeFlagWhere agrees with isFlagActive';

if (!TEST_DB_URL && !IN_CI) {
  // process.stderr directly, not console.warn: vitest's default reporter
  // swallows module-scope console output, which would make this "loud" warning
  // invisible — the exact silent-gap failure this gate exists to avoid.
  process.stderr.write(
    `\n[33m[SKIPPED] ${TEST_NAME}[0m\n` +
      `  src/lib/flags/__tests__/active.test.ts\n` +
      `  TEST_DATABASE_URL is not set, so isFlagActive/activeFlagWhere equivalence is UNVERIFIED.\n` +
      `  Point it at a disposable Neon branch. Never DATABASE_URL — that is shared dev data.\n` +
      `  This is a hard failure in CI.\n\n`,
  );
}

/** Names the reason in the reporter, not just in the stderr banner above. */
const DB_TEST_TITLE = TEST_DB_URL
  ? TEST_NAME
  : `${TEST_NAME} [SKIPPED: TEST_DATABASE_URL not set]`;

/**
 * Rows are namespaced by this run so concurrent suites cannot collide, and the
 * prefix is greppable if a run ever dies hard enough to leave strays:
 *   SELECT * FROM socios WHERE external_id LIKE '__test_equiv_%';
 */
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EXTERNAL_ID = `__test_equiv_${RUN_ID}`;

// Registered unconditionally and at describe scope, so a mid-test failure still
// cleans up. Putting this at the end of the test body would leak on any throw.
let teardown: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (teardown) {
    await teardown();
    teardown = null;
  }
});

describe('activeFlagWhere', () => {
  it.skipIf(!TEST_DB_URL && !IN_CI)(DB_TEST_TITLE, async () => {
    if (!TEST_DB_URL) {
      // Only reachable in CI: refuse to pass without having actually checked.
      throw new Error(
        'TEST_DATABASE_URL is required in CI. Without it the predicate/where ' +
          'equivalence is never verified and this suite reports a vacuous green.',
      );
    }

    const { PrismaClient } = await import('@prisma/client');
    const { PrismaNeon } = await import('@prisma/adapter-neon');
    const prisma = new PrismaClient({
      adapter: new PrismaNeon({ connectionString: TEST_DB_URL }),
    });

    teardown = async () => {
      try {
        const socios = await prisma.socio.findMany({
          where: { externalId: { startsWith: '__test_equiv_' } },
          select: { id: true },
        });
        for (const s of socios) {
          await prisma.socioFlag.deleteMany({ where: { socioId: s.id } });
          await prisma.socio.delete({ where: { id: s.id } });
        }
      } finally {
        await prisma.$disconnect();
      }
    };

    const socio = await prisma.socio.create({
      data: { channelType: 'web', externalId: EXTERNAL_ID, status: 'NEW' },
    });

    const created = await Promise.all(
      FIXTURES.map((f) =>
        prisma.socioFlag.create({
          data: {
            socioId: socio.id,
            level: 'YELLOW',
            reason: f.key,
            resolved: f.flag.resolved,
            status: f.flag.status,
            snoozedUntil: f.flag.snoozedUntil,
          },
          select: { id: true, reason: true },
        }),
      ),
    );
    const byKey = new Map(created.map((r) => [r.reason, r.id]));

    const expectedIds = FIXTURES.filter((f) => isFlagActive(f.flag, NOW))
      .map((f) => byKey.get(f.key)!)
      .sort();

    const rows = await prisma.socioFlag.findMany({
      where: { socioId: socio.id, ...activeFlagWhere(NOW) },
      select: { id: true },
    });

    expect(rows.map((r) => r.id).sort()).toEqual(expectedIds);
    // Guard against both sides being trivially empty or trivially everything.
    expect(expectedIds.length).toBeGreaterThan(0);
    expect(expectedIds.length).toBeLessThan(FIXTURES.length);
  });
});
