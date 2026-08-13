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
  preloadCollection: vi.fn(),
  resolveCourseCode: vi.fn(),
  logEvent: vi.fn(),
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
