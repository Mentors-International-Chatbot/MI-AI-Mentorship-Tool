/**
 * Anchoring coverage — every account-creation path is accounted for
 * ═══════════════════════════════════════════════════════════════════════════
 * A Socio with no ParticipantProfile, or a Mentor with no MentorProfile, is
 * invisible to every org-scoped query — the learner never appears on a
 * dashboard, the mentor sees an empty roster, and nothing anywhere errors. Two
 * backfills cleaned up 26 such rows; this test is what stops them recurring.
 *
 * ── Why this is not "does creation write a profile" ─────────────────────────
 * It deliberately cannot be. The rule is: write the profile at the first moment
 * a real organization signal exists, never before. At creation there usually is
 * no signal — a self-signup socio has picked no course, a self-signup mentor has
 * nothing at all — and the tempting middle path of defaulting to
 * DEFAULT_ORGANIZATION_ID and correcting later is worse than staying unanchored,
 * because reads short-circuit on the profile and a wrong anchor is permanent.
 *
 * So each creation path declares HOW it gets anchored, and the three legal
 * answers mirror the rule:
 *
 *   at_creation        a signal exists right then (an admin's own org)
 *   lazy               anchored at a named later event, which must really wire it
 *   declared_exception never anchored, with a reason and what would change it
 *
 * ── What actually has teeth ─────────────────────────────────────────────────
 * The registry is checked against source in BOTH directions. A new creation
 * path — LTI auto-provisioning is the one coming — fails this test until
 * somebody writes down how it anchors. That is the whole point: the previous
 * failures were not wrong decisions, they were decisions nobody was asked to
 * make.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

type Anchoring =
  | { kind: 'at_creation'; anchorFile: string }
  | { kind: 'lazy'; event: string; anchorFile: string }
  | { kind: 'declared_exception'; reason: string };

type CreationPath = {
  /** Source file that creates the row. */
  file: string;
  entity: 'socio' | 'mentor';
  anchoring: Anchoring;
};

/**
 * Every path that creates a Socio or a Mentor.
 *
 * Keyed by a stable human label, not a line number — line numbers rot, and the
 * scan below finds the sites by pattern anyway.
 */
const CREATION_PATHS: Record<string, CreationPath> = {
  'socio: web/whatsapp first message': {
    file: 'src/lib/messaging/handler.ts',
    entity: 'socio',
    anchoring: {
      kind: 'declared_exception',
      reason:
        'No organization signal exists at first message and none arrives later on this path: ' +
        'setSocioCurriculum has exactly one caller (/api/auth/curriculum, a session-bound web ' +
        'route) which WhatsApp never reaches. These socios stay unanchored indefinitely and are ' +
        'counted on /admin. Removed when the WhatsApp Business number → organization mapping ' +
        'lands, which is the real signal for this channel.',
    },
  },
  'socio: self-signup': {
    file: 'src/app/api/auth/signup/route.ts',
    entity: 'socio',
    anchoring: {
      kind: 'lazy',
      event: 'course selection (/join → POST /api/auth/curriculum)',
      anchorFile: 'src/app/api/auth/curriculum/route.ts',
    },
  },
  'mentor: self-signup': {
    file: 'src/app/api/auth/signup/route.ts',
    entity: 'mentor',
    anchoring: {
      kind: 'lazy',
      event: 'first socio assignment (PATCH /api/admin/socios)',
      anchorFile: 'src/app/api/admin/socios/route.ts',
    },
  },
  'mentor: created by an admin': {
    file: 'src/app/api/admin/mentors/route.ts',
    entity: 'mentor',
    anchoring: { kind: 'at_creation', anchorFile: 'src/app/api/admin/mentors/route.ts' },
  },
  'socio + mentor: database seed': {
    file: 'prisma/seed.ts',
    entity: 'socio',
    anchoring: {
      kind: 'declared_exception',
      reason:
        'Development fixture data, never a real tenant account. Seeded rows are anchored by ' +
        'backfill-phase1 / the two backfill scripts when a developer needs them visible. ' +
        'Removed if seeding ever becomes a production provisioning path.',
    },
  },
};

/** Functions that actually write a profile. A file "anchors" if it calls one. */
const ANCHOR_CALLS = [
  'anchorMentorProfile',
  'anchorParticipantProfile',
  'createParticipant',
  'createMentorProfile',
];

/** Source sites that create a Socio or Mentor row, as `file → entities`. */
function creationSitesInSource(): Map<string, Set<'socio' | 'mentor'>> {
  const files = [
    'src/lib/messaging/handler.ts',
    'src/app/api/auth/signup/route.ts',
    'src/app/api/admin/mentors/route.ts',
    'prisma/seed.ts',
    'src/lib/repo/prismaRepo.ts',
    'src/lib/repo/inMemoryRepo.ts',
  ].filter((f) => existsSync(join(ROOT, f)));

  const found = new Map<string, Set<'socio' | 'mentor'>>();
  const socioCreate = /(?:prisma|tx)\s*\.\s*socio\s*\.\s*create\s*\(|repo\.createSocio\s*\(/;
  const mentorCreate = /(?:prisma|tx)\s*\.\s*mentor\s*\.\s*create\s*\(/;

  for (const f of files) {
    const text = read(f);
    const entities = new Set<'socio' | 'mentor'>();
    if (socioCreate.test(text)) entities.add('socio');
    if (mentorCreate.test(text)) entities.add('mentor');
    if (entities.size > 0) found.set(f, entities);
  }
  return found;
}

/** The repo layer implements `createSocio`; it is plumbing, not a policy site. */
const REPO_LAYER = ['src/lib/repo/prismaRepo.ts', 'src/lib/repo/inMemoryRepo.ts'];

describe('anchoring coverage', () => {
  const sites = creationSitesInSource();

  it('finds the creation sites at all (guards against a broken scan)', () => {
    // Without this, every assertion below could pass vacuously.
    expect(sites.size).toBeGreaterThan(3);
    expect(sites.get('src/app/api/auth/signup/route.ts')).toBeDefined();
  });

  it('accounts for every creation site in the registry', () => {
    // The one with teeth. LTI auto-provisioning (§6) is a third socio-creation
    // path with no picker and no admin step; it fails here until someone states
    // how it anchors, which is exactly the question nobody was asked last time.
    const registered = new Set(Object.values(CREATION_PATHS).map((p) => p.file));
    const unaccounted = [...sites.keys()].filter(
      (f) => !registered.has(f) && !REPO_LAYER.includes(f),
    );

    expect(
      unaccounted,
      `These files create a Socio or Mentor but declare no anchoring route. An account created ` +
        `here is invisible to every org-scoped query and nothing errors. Add an entry to ` +
        `CREATION_PATHS saying whether it anchors at creation, lazily at a named event, or is a ` +
        `declared exception:\n  ${unaccounted.join('\n  ')}`,
    ).toEqual([]);
  });

  it('has no registry entry for a file that no longer creates anything', () => {
    // A stale entry asserts coverage that is not there, and the next reader
    // believes it.
    const ghosts = Object.entries(CREATION_PATHS).filter(
      ([, p]) => !sites.has(p.file) || !sites.get(p.file)!.has(p.entity),
    );
    expect(
      ghosts.map(([label]) => label),
      `These registry entries no longer match a real creation site: ${ghosts
        .map(([l]) => l)
        .join(', ')}`,
    ).toEqual([]);
  });

  it('wires every anchor point it claims — a named event must really anchor', () => {
    // This is what makes §10 provable rather than merely true. Claiming "anchored
    // lazily at first socio assignment" while that route calls nothing is exactly
    // the read-side-works/write-side-missing shape this codebase keeps producing.
    const broken: string[] = [];

    for (const [label, path] of Object.entries(CREATION_PATHS)) {
      if (path.anchoring.kind === 'declared_exception') continue;

      const anchorFile = path.anchoring.anchorFile;
      if (!existsSync(join(ROOT, anchorFile))) {
        broken.push(`${label}: anchor file ${anchorFile} does not exist`);
        continue;
      }
      const text = read(anchorFile);
      if (!ANCHOR_CALLS.some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(text))) {
        broken.push(`${label}: ${anchorFile} calls no anchoring function`);
      }
    }

    expect(broken, `Anchoring claimed but not wired:\n  ${broken.join('\n  ')}`).toEqual([]);
  });

  it('gives every declared exception a reason and an exit condition', () => {
    // An exception without "removed when..." is a silence with better grammar.
    for (const [label, path] of Object.entries(CREATION_PATHS)) {
      if (path.anchoring.kind !== 'declared_exception') continue;
      expect(path.anchoring.reason.length, `${label} reason is too short`).toBeGreaterThan(80);
      expect(
        path.anchoring.reason,
        `${label} should say what would remove the exception`,
      ).toMatch(/removed when|removed if/i);
    }
  });

  it('keeps the WhatsApp gap declared rather than silent', () => {
    // Named specifically because it is the one live hole: agreed as backlog,
    // and the risk was that "WhatsApp socios are unanchored" quietly becomes
    // permanent. If someone wires that channel's org mapping, this entry has to
    // be revisited to make the test pass honestly.
    const wa = CREATION_PATHS['socio: web/whatsapp first message'];
    expect(wa.anchoring.kind).toBe('declared_exception');
    if (wa.anchoring.kind === 'declared_exception') {
      expect(wa.anchoring.reason).toMatch(/whatsapp/i);
    }
  });

  it('does not let a lazy anchor point silently stop anchoring', () => {
    // The two lazy events, pinned by name. Deleting the anchor call from either
    // is the single change that would restart the leak, and it would otherwise
    // be invisible.
    expect(read('src/app/api/auth/curriculum/route.ts')).toMatch(/anchorParticipantProfile\s*\(/);
    expect(read('src/app/api/admin/socios/route.ts')).toMatch(/anchorMentorProfile\s*\(/);
    expect(read('src/app/api/admin/mentors/route.ts')).toMatch(/anchorMentorProfile\s*\(/);
  });
});
