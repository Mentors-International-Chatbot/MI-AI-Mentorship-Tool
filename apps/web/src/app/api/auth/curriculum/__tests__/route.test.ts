/**
 * Curriculum selection → ParticipantProfile creation
 * ----------------------------------------------------------------------------
 * Course selection is the first moment a socio's organization is knowable, and
 * ParticipantProfile is the anchor every org-scoped query filters on. These
 * tests pin three things that are easy to regress:
 *
 *  - the profile is written only when resolution identified a REAL tenant
 *    (tiers 1 and 2). Tier 3 is DEFAULT_ORGANIZATION_ID — a guess — and writing
 *    it would forge a permanent, authoritative-looking tenant claim.
 *  - the curriculum key is committed BEFORE resolution runs, or resolution
 *    reads the stale row and degrades to tier 3.
 *  - a failed profile write never fails course selection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  getSocio: vi.fn(),
  setSocioCurriculum: vi.fn(),
  resolveOrganizationForSocio: vi.fn(),
  createParticipant: vi.fn(),
  resolveOrCreateActiveEnrollment: vi.fn(),
  preloadCollection: vi.fn(),
  resolveCourseCode: vi.fn(),
  logEvent: vi.fn(),
  programVersionFindMany: vi.fn(),
  participantFindUnique: vi.fn(),
}));

vi.mock('@/lib/logging/logger', () => ({
  logEvent: mocks.logEvent,
}));

vi.mock('@/lib/auth/session', () => ({
  verifySession: mocks.verifySession,
}));

vi.mock('@/lib/repo', () => ({
  repo: {
    getSocio: mocks.getSocio,
    setSocioCurriculum: mocks.setSocioCurriculum,
  },
}));

vi.mock('@/lib/repo/tenantPrismaRepo', () => ({
  tenantPrismaRepo: {
    resolveOrganizationForSocio: mocks.resolveOrganizationForSocio,
    createParticipant: mocks.createParticipant,
    resolveOrCreateActiveEnrollment: mocks.resolveOrCreateActiveEnrollment,
  },
}));

vi.mock('@/lib/lessons/db-lesson-service', () => ({
  preloadCollection: mocks.preloadCollection,
}));

vi.mock('@/lib/courses/resolver', () => ({
  resolveCourseCode: mocks.resolveCourseCode,
  getAvailableCourseCodes: () => ['MI2026'],
  getAvailableCourses: () => [],
}));

// The route reads published versions for every collection to decide, from
// delivery metadata rather than the collection key, whether a course is
// player-surface (hard-gated enrollment) or chat-surface (best-effort
// enrollment — see the "chat-surface enrollment" describe block below). The
// base beforeEach still defaults to no candidates at all, which is the plain
// "course has no published version yet" case for every other test in this file.
vi.mock('@/lib/db', () => ({
  prisma: {
    programVersion: { findMany: mocks.programVersionFindMany },
    participantProfile: { findUnique: mocks.participantFindUnique },
  },
}));

import { POST } from '../route';

const SOCIO_ID = 'socio-0000-0000-0000-000000000001';
const ORG_ID = 'org-real-000000000000001';
const DEFAULT_ORG_ID = 'org-default-000000000001';
const COLLECTION_KEY = 'mi-colombia-curriculum';

const SESSION = {
  userId: SOCIO_ID,
  role: 'socio' as const,
  name: 'Ana',
  rememberMe: false,
  sessionStart: 0,
};

const SOCIO = {
  id: SOCIO_ID,
  channelType: 'web',
  externalId: SOCIO_ID,
  language: 'en',
  name: 'Ana',
  status: 'ACTIVE',
  aiPaused: false,
  curriculumCollectionKey: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function postRequest(courseCode = 'MI2026'): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/curriculum', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ courseCode }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifySession.mockResolvedValue(SESSION);
  mocks.getSocio.mockResolvedValue(SOCIO);
  mocks.setSocioCurriculum.mockResolvedValue({ ...SOCIO, curriculumCollectionKey: COLLECTION_KEY });
  mocks.resolveCourseCode.mockReturnValue(COLLECTION_KEY);
  mocks.preloadCollection.mockResolvedValue(undefined);
  mocks.createParticipant.mockResolvedValue({ id: 'participant-1' });
  mocks.logEvent.mockResolvedValue(undefined);
  // MI has no player-surface published version, so the enrollment path is skipped.
  mocks.programVersionFindMany.mockResolvedValue([]);
  mocks.participantFindUnique.mockResolvedValue(undefined);
  mocks.resolveOrCreateActiveEnrollment.mockResolvedValue({ id: 'enrollment-1' });
});

/** The single logEvent call matching a level, or undefined. */
function loggedAt(level: 'info' | 'warn' | 'error') {
  const call = mocks.logEvent.mock.calls.find((args) => args[0] === level);
  if (!call) return undefined;
  return { level: call[0], category: call[1], message: call[2], metadata: call[3] };
}

describe('POST /api/auth/curriculum — ParticipantProfile creation', () => {
  it('distinguishes a session whose learner row belongs to another database branch', async () => {
    mocks.getSocio.mockResolvedValueOnce(null);

    const res = await POST(postRequest());

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'session_database_mismatch' });
    expect(mocks.setSocioCurriculum).not.toHaveBeenCalled();
  });

  it('tier 2: creates a profile in the org the collection key resolved to', async () => {
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: ORG_ID,
      source: 'collection_key',
    });

    const res = await POST(postRequest());

    expect(res.status).toBe(200);
    expect(mocks.createParticipant).toHaveBeenCalledTimes(1);
    const [ctx, data] = mocks.createParticipant.mock.calls[0];
    expect(ctx).toEqual(expect.objectContaining({ organizationId: ORG_ID }));
    expect(data).toEqual(
      expect.objectContaining({
        socioId: SOCIO_ID,
        displayName: 'Ana',
        // The socio's own language, not a silent "es" default — a BYU student
        // must not get a Spanish-defaulted profile.
        preferredLang: 'en',
      }),
    );
  });

  it('tier 1: creates a profile when an existing profile answered the resolution', async () => {
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: ORG_ID,
      source: 'participant_profile',
    });

    await POST(postRequest());

    expect(mocks.createParticipant).toHaveBeenCalledTimes(1);
    expect(mocks.createParticipant.mock.calls[0][0]).toEqual(
      expect.objectContaining({ organizationId: ORG_ID }),
    );
  });

  it('commits the curriculum key BEFORE resolving, so resolution sees fresh data', async () => {
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: ORG_ID,
      source: 'collection_key',
    });

    await POST(postRequest());

    expect(mocks.setSocioCurriculum).toHaveBeenCalledWith(SOCIO_ID, COLLECTION_KEY);
    const keyWrittenAt = mocks.setSocioCurriculum.mock.invocationCallOrder[0];
    const resolvedAt = mocks.resolveOrganizationForSocio.mock.invocationCallOrder[0];
    expect(keyWrittenAt).toBeLessThan(resolvedAt);
  });

  it('selecting a course twice does not create a second profile', async () => {
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: ORG_ID,
      source: 'collection_key',
    });

    await POST(postRequest());
    await POST(postRequest());

    // Idempotency lives in the repo (upsert on the unique socioId), so what the
    // route must guarantee is that the second pass targets the same key and org
    // rather than minting a new profile identity.
    expect(mocks.createParticipant).toHaveBeenCalledTimes(2);
    const [firstCtx, firstData] = mocks.createParticipant.mock.calls[0];
    const [secondCtx, secondData] = mocks.createParticipant.mock.calls[1];
    expect(secondCtx).toEqual(firstCtx);
    expect(secondData.socioId).toBe(firstData.socioId);
  });

  it('tier 3: creates NO profile and records a discoverable warning', async () => {
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: DEFAULT_ORG_ID,
      source: 'default',
    });

    const res = await POST(postRequest());

    expect(res.status).toBe(200);
    expect(mocks.createParticipant).not.toHaveBeenCalled();

    // Routed to SystemLog, not the console — an unanchored socio is invisible to
    // every dashboard, and nobody reads Vercel function logs.
    const logged = loggedAt('warn');
    expect(logged).toBeDefined();
    expect(logged!.category).toBe('system');
    expect(logged!.message).toContain(SOCIO_ID);
    expect(logged!.message).toContain(COLLECTION_KEY);
    expect(logged!.metadata).toEqual(
      expect.objectContaining({ socioId: SOCIO_ID, collectionKey: COLLECTION_KEY }),
    );
  });

  it('a failing profile write does not fail the course selection, and is logged', async () => {
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: ORG_ID,
      source: 'collection_key',
    });
    mocks.createParticipant.mockRejectedValue(new Error('unique constraint blew up'));

    const res = await POST(postRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ success: true, collectionKey: COLLECTION_KEY }),
    );
    // The user's course is still set, and the cache warm still ran.
    expect(mocks.setSocioCurriculum).toHaveBeenCalledWith(SOCIO_ID, COLLECTION_KEY);
    expect(mocks.preloadCollection).toHaveBeenCalledWith(COLLECTION_KEY);

    const logged = loggedAt('error');
    expect(logged).toBeDefined();
    expect(logged!.category).toBe('system');
    expect(logged!.metadata).toEqual(
      expect.objectContaining({
        socioId: SOCIO_ID,
        collectionKey: COLLECTION_KEY,
        error: 'unique constraint blew up',
      }),
    );
  });

  it('a failing resolution does not fail the course selection either', async () => {
    mocks.resolveOrganizationForSocio.mockRejectedValue(
      new Error('Cannot resolve organization for socio'),
    );

    const res = await POST(postRequest());

    expect(res.status).toBe(200);
    expect(mocks.createParticipant).not.toHaveBeenCalled();
    expect(loggedAt('error')).toBeDefined();
  });

  it('survives logEvent itself throwing — logging must never break selection', async () => {
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: ORG_ID,
      source: 'collection_key',
    });
    mocks.createParticipant.mockRejectedValue(new Error('db gone'));
    // logEvent guards only its own Prisma write; the console call ahead of it is
    // unguarded, so the catch block wraps it rather than trusting it.
    mocks.logEvent.mockRejectedValue(new Error('console is on fire'));

    const res = await POST(postRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ success: true, collectionKey: COLLECTION_KEY }),
    );
  });

  it('does not touch the profile path when the course code is invalid', async () => {
    mocks.resolveCourseCode.mockReturnValue(null);

    const res = await POST(postRequest('NOPE'));

    expect(res.status).toBe(400);
    expect(mocks.setSocioCurriculum).not.toHaveBeenCalled();
    expect(mocks.resolveOrganizationForSocio).not.toHaveBeenCalled();
    expect(mocks.createParticipant).not.toHaveBeenCalled();
  });
});

/**
 * G3 closure: chat-surface courses (MI2024, pbj-basics) used to skip
 * enrollment creation entirely — only the `isPlayerCourse` branch ever wrote
 * one. This is the regression guard for the fix: any collection whose
 * published version resolves to a real, tenant-matched candidate now also
 * gets a best-effort Enrollment through the same shared repo method the
 * player branch uses, whether or not its delivery surface is "player".
 */
describe('POST /api/auth/curriculum — chat-surface enrollment (G3)', () => {
  it('creates an enrollment for a chat-surface course through the shared repo method', async () => {
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: ORG_ID,
      source: 'collection_key',
    });
    mocks.participantFindUnique.mockResolvedValue({ id: 'participant-chat', organizationId: ORG_ID });
    mocks.programVersionFindMany.mockResolvedValue([{
      id: 'chat-version-1',
      programId: 'chat-program-1',
      // No `delivery` metadata at all resolves to the legacy chat default
      // (surface: "chat", supportedChannels: ["web", "whatsapp"]) — this is
      // MI2024's real shape.
      metadata: null,
      program: { organizationId: ORG_ID, organization: { settings: null } },
    }]);

    const res = await POST(postRequest());

    expect(res.status).toBe(200);
    expect(mocks.resolveOrCreateActiveEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID }),
      expect.objectContaining({
        participantId: 'participant-chat',
        programVersionId: 'chat-version-1',
        channel: 'web',
      }),
    );
  });

  it('fails open: an enrollment error still returns success and logs, chat is unaffected', async () => {
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: ORG_ID,
      source: 'collection_key',
    });
    mocks.participantFindUnique.mockResolvedValue({ id: 'participant-chat', organizationId: ORG_ID });
    mocks.programVersionFindMany.mockResolvedValue([{
      id: 'chat-version-1',
      programId: 'chat-program-1',
      metadata: null,
      program: { organizationId: ORG_ID, organization: { settings: null } },
    }]);
    mocks.resolveOrCreateActiveEnrollment.mockRejectedValue(new Error('db blew up'));

    const res = await POST(postRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ success: true, collectionKey: COLLECTION_KEY, homePath: '/chat' }),
    );
    const logged = loggedAt('error');
    expect(logged).toBeDefined();
    expect(logged!.message).toContain('Enrollment');
  });

  it('does not attempt enrollment when no published version exists for the collection', async () => {
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: ORG_ID,
      source: 'collection_key',
    });
    mocks.programVersionFindMany.mockResolvedValue([]);

    const res = await POST(postRequest());

    expect(res.status).toBe(200);
    expect(mocks.resolveOrCreateActiveEnrollment).not.toHaveBeenCalled();
  });

  // These two no-op reasons used to be genuinely silent — no exception, no log
  // — even though the blocking condition (a tenant mismatch, or no single
  // tenant-safe published version) can be permanent for a given socio/org, not
  // just first-selection noise. The comment above this branch claims
  // "idempotent re-entry... guarantees eventually," which is false unless the
  // skip is at least observable for backfill. These pin that both skip paths
  // now log a warn, while still returning success (fail-open, chat unaffected).
  it('logs a warn (not an error) when no single tenant-safe published version supports web delivery', async () => {
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: ORG_ID,
      source: 'collection_key',
    });
    // participant is anchored to a different org than the only candidate, so
    // selectPublishedPlayerVersion's tenant filter leaves zero eligible
    // candidates and returns null — this is the ambiguity-fails-closed case,
    // not an exception.
    mocks.participantFindUnique.mockResolvedValue({ id: 'participant-mismatched', organizationId: 'org-other-000000000002' });
    mocks.programVersionFindMany.mockResolvedValue([{
      id: 'chat-version-1',
      programId: 'chat-program-1',
      metadata: null,
      program: { organizationId: ORG_ID, organization: { settings: null } },
    }]);

    const res = await POST(postRequest());

    expect(res.status).toBe(200);
    expect(mocks.resolveOrCreateActiveEnrollment).not.toHaveBeenCalled();
    const logged = loggedAt('warn');
    expect(logged).toBeDefined();
    expect(logged!.message).toContain('no single tenant-safe published version');
    expect(mocks.logEvent).not.toHaveBeenCalledWith('error', expect.anything(), expect.anything(), expect.anything());
  });

  it('logs a warn (not an error) when the resolved participant tenant does not match the course organization', async () => {
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: 'org-other-000000000002',
      source: 'collection_key',
    });
    // Unanchored at the time selectPublishedPlayerVersion runs (no participant
    // yet), so the single non-synthetic candidate is picked on org ORG_ID.
    // anchorParticipantProfile then creates the real profile on a DIFFERENT
    // org — the second findUnique call (behind `??=`) surfaces that mismatch.
    mocks.participantFindUnique
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 'participant-late', organizationId: 'org-other-000000000002' });
    mocks.programVersionFindMany.mockResolvedValue([{
      id: 'chat-version-1',
      programId: 'chat-program-1',
      metadata: null,
      program: { organizationId: ORG_ID, organization: { settings: null } },
    }]);

    const res = await POST(postRequest());

    expect(res.status).toBe(200);
    expect(mocks.resolveOrCreateActiveEnrollment).not.toHaveBeenCalled();
    const logged = loggedAt('warn');
    expect(logged).toBeDefined();
    expect(logged!.message).toContain('does not match the resolved course');
    expect(mocks.logEvent).not.toHaveBeenCalledWith('error', expect.anything(), expect.anything(), expect.anything());
  });
});
