/**
 * Write-path audit — every table must have a writer
 * ═══════════════════════════════════════════════════════════════════════════
 * Six times now, this codebase has shipped a table whose read side was built
 * during a feature and whose write side was deferred to "wire it up later",
 * with nothing failing when later didn't come:
 *
 *   metric_observations   every row orphaned (enrollmentId NULL, no socioId)
 *   alert_rules           0 rows — nothing seeds one, so the alerts trio is dead
 *   weeklyImplementation  rendered "N/A/10" into every prompt since launch
 *   participant_profiles  25 of 45 socios unanchored → invisible to mentors
 *   mentor_profiles       4 of 14 mentors unanchored → empty rosters
 *   organization_memberships  0 rows — the by-design tenant signal, unwritten
 *
 * Neither existing guardrail catches this. TypeScript can't: a nullable column
 * returning null is valid. Tests can't: they mock the write. The shape is only
 * visible by asking a question neither one asks — *does anything write here?*
 *
 * So this test asks it. For every model in schema.prisma, is there a non-test
 * code path that calls create / createMany / upsert on it — and can anything
 * actually reach that path?
 *
 * ── What it does and does not measure ────────────────────────────────────────
 * Building it surfaced that "the table is empty" spans three distinct causes,
 * and only the first is a missing writer:
 *
 *   1. no reachable writer      AlertRule, EnrollmentInvitation, ProgramMembership,
 *                               OrganizationMembership — nothing can write one
 *   2. writer that never fires  Alert: evaluateAlerts calls createAlert, but no
 *                               AlertRule exists to trigger it
 *   3. writer that writes junk  MetricObservation: completeAssessment calls
 *                               createObservation, but every row lands orphaned
 *
 * This test catches (1) only, and says so rather than implying otherwise — (2)
 * and (3) need row-level or integration checks. (1) is still the majority of the
 * instances, and it is the one no other guardrail sees at all.
 *
 * ── The allowlist is the point ───────────────────────────────────────────────
 * KNOWN_UNWRITTEN below is not a suppression list, it is the backlog made
 * visible and reviewable. Each entry states why the table has no writer and
 * what would change that. Adding an entry is a deliberate act in a diff someone
 * reviews; the failure mode this catches is a table quietly acquiring reads and
 * never acquiring writes, which is exactly what an un-reviewed silence looks
 * like today.
 *
 * Removing an entry is the win condition. `participant_profiles` and
 * `mentor_profiles` would have been on this list before the §10 anchoring work
 * and are not on it now — this test is the regression guard proving that work
 * landed, not just a separate chore.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCHEMA = join(ROOT, 'prisma', 'schema.prisma');

/** Directories that count as "real" write paths. Scripts included: a backfill is a writer. */
const SOURCE_ROOTS = ['src', 'scripts', 'prisma'];

/**
 * Tables with no writer, each with a reason and the condition that removes it.
 * Keep this sorted and keep the reasons specific — a vague entry is how a real
 * gap hides behind a plausible sentence.
 */
const KNOWN_UNWRITTEN: Record<string, string> = {
  AlertRule:
    'No seeding path. The alerts trio (alerts / alert_rules / alert_reviews) is inert because ' +
    'nothing creates a rule. Removed when rule authoring or a seed exists.',
  AlertReview:
    'Downstream of Alert, which is itself downstream of AlertRule. No surface creates a review. ' +
    'Removed when alert triage writes one.',
  EnrollmentInvitation:
    'Half-designed and never wired. It is the intended answer to open mentor self-signup (invite ' +
    'instead of self-register), so nothing writes one because that feature does not exist yet. ' +
    'Removed when invite-based enrollment lands.',
  OrganizationMembership:
    'The by-design mentor↔org signal, 0 rows platform-wide. resolveMentorOrg already reads it as ' +
    'its highest-priority signal, so it starts working the moment anything writes one. ' +
    'Removed when invite-based mentor creation lands.',
  ProgramMembership:
    'No writer anywhere. Nothing enrolls anyone into a program through this table; Enrollment is ' +
    'what the code actually uses. Removed when program membership is either wired up or dropped.',
};

function sourceFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Tests mock writes, so a write inside one proves nothing.
      if (entry === '__tests__' || entry === 'node_modules' || entry === '.next') continue;
      sourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Model names declared in schema.prisma, in declaration order. */
function schemaModels(): string[] {
  const text = readFileSync(SCHEMA, 'utf8');
  return [...text.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
}

/** `User` → `user`, `AIThing` → `aIThing` — how Prisma Client names the accessor. */
function accessor(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** The repo layer. A write in here is plumbing; a write outside it is a caller. */
function isRepoLayer(path: string): boolean {
  return path.includes(join('src', 'lib', 'repo'));
}

/**
 * Two write forms are matched, and the second matters as much as the first:
 *
 *   direct  `prisma.mentorProfile.upsert(` / `.create(` / `.createMany(`
 *   nested  `mentorProfile: { create: {` — a relation write inside another
 *           model's create, which never mentions `prisma.<model>`
 *
 * Missing nested writes would put genuinely-written tables into the allowlist as
 * fake gaps, and an allowlist with wrong entries is worse than no allowlist.
 */
function writesModel(text: string, a: string): boolean {
  const direct = new RegExp(`\\b${a}\\s*\\.\\s*(create|createMany|upsert)\\s*\\(`);
  const nested = new RegExp(
    `\\b${a}\\s*:\\s*\\{[\\s\\S]{0,200}?\\b(create|createMany|connectOrCreate)\\s*:`,
  );
  return direct.test(text) || nested.test(text);
}

/**
 * Repo methods that perform a write, keyed by the model they write.
 *
 * Methods are object properties at two-space indent (`  async createAlert(ctx, data) {`),
 * so the nearest preceding one owns any write below it.
 */
function repoWriteMethods(models: string[], repoTexts: string[]): Map<string, string[]> {
  const byModel = new Map<string, string[]>();
  const accessors = new Map(models.map((m) => [accessor(m), m]));
  const methodDecl = /^\s{2,6}(?:async\s+)?(\w+)\s*\(/;
  const writeCall = /\b(?:prisma|tx)\s*\.\s*(\w+)\s*\.\s*(?:create|createMany|upsert)\s*\(/;

  for (const text of repoTexts) {
    let current = '';
    for (const line of text.split('\n')) {
      const decl = line.match(methodDecl);
      if (decl) current = decl[1];
      const write = line.match(writeCall);
      if (write && current) {
        const model = accessors.get(write[1]);
        if (model) byModel.set(model, [...(byModel.get(model) ?? []), current]);
      }
    }
  }
  return byModel;
}

/**
 * Models with a write path that something can actually reach.
 *
 * The reachability requirement is the whole point, and it is what the obvious
 * version of this test gets wrong. Every one of the six known-silent tables has
 * a perfectly good `createX` method sitting in `tenantPrismaRepo.ts` — so a test
 * that merely greps for `prisma.alertRule.create(` reports AlertRule as written
 * and passes while the table holds zero rows. Five of the six known instances
 * pass that way.
 *
 * So: a write outside the repo layer counts on its own. A write *inside* the
 * repo layer counts only if the method containing it is called from outside the
 * repo layer. An exported CRUD method nobody calls is not a write path, it is
 * unreachable code that looks like one — the same "populated but never read"
 * illusion as MentoringRelationship, pointed the other way.
 */
function modelsWithWriters(models: string[]): Set<string> {
  const files = SOURCE_ROOTS.flatMap((r) => sourceFiles(join(ROOT, r)));
  const repoTexts: string[] = [];
  const outsideTexts: string[] = [];
  for (const f of files) {
    (isRepoLayer(f) ? repoTexts : outsideTexts).push(readFileSync(f, 'utf8'));
  }

  const found = new Set<string>();
  const writeMethods = repoWriteMethods(models, repoTexts);

  for (const model of models) {
    const a = accessor(model);

    // 1. Written directly outside the repo layer.
    if (outsideTexts.some((t) => writesModel(t, a))) {
      found.add(model);
      continue;
    }

    // 2. Written by a repo method that something outside the repo layer calls.
    const methods = writeMethods.get(model) ?? [];
    const reachable = methods.some((m) => {
      const called = new RegExp(`\\.\\s*${m}\\s*\\(|\\b${m}\\s*\\(`);
      return outsideTexts.some((t) => called.test(t));
    });
    if (reachable) found.add(model);
  }

  return found;
}

describe('write-path audit', () => {
  const models = schemaModels();
  const written = modelsWithWriters(models);

  it('finds the schema and its models at all (guards against a broken scan)', () => {
    // Without this, every assertion below could pass vacuously on an empty list.
    expect(models.length).toBeGreaterThan(20);
    expect(models).toContain('Socio');
  });

  it('finds writers at all (guards against a broken matcher)', () => {
    // Pin models that are unambiguously written on the main request path.
    expect(written).toContain('Socio');
    expect(written).toContain('Message');
    expect(written).toContain('SocioFlag');
  });

  it('has no allowlist entry for a table that is actually written', () => {
    // A stale entry is worse than a missing one: it asserts a gap that has been
    // closed, and the next reader believes it.
    const stale = Object.keys(KNOWN_UNWRITTEN).filter((m) => written.has(m));
    expect(
      stale,
      `These are in KNOWN_UNWRITTEN but DO have a write path. Remove them — the gap is closed: ` +
        `${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('has no allowlist entry for a table that no longer exists', () => {
    const ghosts = Object.keys(KNOWN_UNWRITTEN).filter((m) => !models.includes(m));
    expect(
      ghosts,
      `These are in KNOWN_UNWRITTEN but are not models in schema.prisma: ${ghosts.join(', ')}`,
    ).toEqual([]);
  });

  it('every model has a writer, or a reasoned allowlist entry', () => {
    const unwritten = models.filter((m) => !written.has(m) && !(m in KNOWN_UNWRITTEN));
    expect(
      unwritten,
      `These tables have NO create/upsert anywhere in non-test source. That is the shape that ` +
        `produced six silent failures already: the read side works, the write side was deferred, ` +
        `and nothing fails when it never arrives.\n\n` +
        `Either wire up a writer, or add an entry to KNOWN_UNWRITTEN saying why it has none and ` +
        `what would remove it:\n  ${unwritten.join('\n  ')}`,
    ).toEqual([]);
  });

  it('gives every allowlist entry a substantive reason', () => {
    for (const [model, reason] of Object.entries(KNOWN_UNWRITTEN)) {
      expect(reason.length, `${model} reason is too short to be useful`).toBeGreaterThan(40);
      expect(reason, `${model} reason should say what would remove the entry`).toMatch(
        /removed when|removed with/i,
      );
    }
  });
});
