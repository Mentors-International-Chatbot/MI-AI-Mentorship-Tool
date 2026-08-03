import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  resolveOrganizationForSocio: vi.fn(),
  getOrganizationIdByMentorId: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  verifySession: mocks.verifySession,
}));

vi.mock('@/lib/db', () => ({
  prisma: { feedback: { findMany: mocks.findMany, create: mocks.create } },
}));

vi.mock('@/lib/repo/tenantPrismaRepo', () => ({
  tenantPrismaRepo: {
    resolveOrganizationForSocio: mocks.resolveOrganizationForSocio,
    getOrganizationIdByMentorId: mocks.getOrganizationIdByMentorId,
  },
}));

vi.mock('@/lib/repo', () => ({ repo: {} }));

import { GET, POST } from '../route';

const ROWS = [
  { id: 'f1', page: 'chat', subject: 'S', body: 'B', createdAt: new Date(0) },
];

const SOCIO = {
  userId: 'socio-1',
  role: 'socio' as const,
  name: 'Ana',
  rememberMe: false,
  sessionStart: 0,
};

const ADMIN = {
  userId: 'admin-1',
  role: 'admin' as const,
  name: 'Root',
  rememberMe: false,
  sessionStart: 0,
};

/** Each request gets a distinct IP so the shared limiter map stays isolated. */
let ipCounter = 0;
function postRequest(
  body: unknown,
  opts: { ip?: string; referer?: string; spoofedXff?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    // Platform-set header, the one the limiter trusts.
    'x-vercel-forwarded-for': opts.ip ?? `10.0.0.${++ipCounter}`,
  };
  if (opts.spoofedXff) headers['x-forwarded-for'] = opts.spoofedXff;
  if (opts.referer) headers.referer = opts.referer;

  return new NextRequest('http://localhost:3000/api/feedback', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const VALID = { page: 'chat', subject: 'Bug', body: 'Something broke' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue(ROWS);
  mocks.create.mockImplementation(async ({ data }: { data: unknown }) => ({
    id: 'new-id',
    createdAt: new Date(0),
    ...(data as object),
  }));
});

describe('POST /api/feedback — attribution', () => {
  it('records userId, role and organizationId for a socio session', async () => {
    mocks.verifySession.mockResolvedValue(SOCIO);
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: 'org-abc',
      source: 'participant_profile',
    });

    const res = await POST(postRequest(VALID));

    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'socio-1',
        role: 'socio',
        organizationId: 'org-abc',
      }),
    });
  });

  it('accepts a tier-2 collection_key resolution', async () => {
    mocks.verifySession.mockResolvedValue(SOCIO);
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: 'org-xyz',
      source: 'collection_key',
    });

    await POST(postRequest(VALID));

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org-xyz' }),
    });
  });

  it('writes null org for a tier-3 default resolution rather than guessing', async () => {
    mocks.verifySession.mockResolvedValue(SOCIO);
    mocks.resolveOrganizationForSocio.mockResolvedValue({
      organizationId: 'default-org',
      source: 'default',
    });

    const res = await POST(postRequest(VALID));

    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'socio-1',
        organizationId: null,
      }),
    });
  });

  it('writes null org when resolution throws, and still saves', async () => {
    mocks.verifySession.mockResolvedValue(SOCIO);
    mocks.resolveOrganizationForSocio.mockRejectedValue(
      new Error('DEFAULT_ORGANIZATION_ID is unset'),
    );

    const res = await POST(postRequest(VALID));

    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: null }),
    });
  });

  it('attributes a mentor via MentorProfile, not the socio chain', async () => {
    // The legacy Mentor model has no organizationId, but MentorProfile does —
    // linked back by a unique mentorId. Mentors are NOT untenanted.
    mocks.verifySession.mockResolvedValue({
      userId: 'mentor-1',
      role: 'mentor',
      name: 'Rosa',
      rememberMe: false,
      sessionStart: 0,
    });
    mocks.getOrganizationIdByMentorId.mockResolvedValue('org-mentor');

    const res = await POST(postRequest(VALID));

    expect(res.status).toBe(201);
    expect(mocks.resolveOrganizationForSocio).not.toHaveBeenCalled();
    expect(mocks.getOrganizationIdByMentorId).toHaveBeenCalledWith('mentor-1');
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'mentor-1',
        role: 'mentor',
        organizationId: 'org-mentor',
      }),
    });
  });

  it('attributes an admin through the same MentorProfile path', async () => {
    mocks.verifySession.mockResolvedValue(ADMIN);
    mocks.getOrganizationIdByMentorId.mockResolvedValue('org-admin');

    const res = await POST(postRequest(VALID));

    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'admin-1',
        role: 'admin',
        organizationId: 'org-admin',
      }),
    });
  });

  it('writes null org for a mentor with no MentorProfile', async () => {
    mocks.verifySession.mockResolvedValue(ADMIN);
    mocks.getOrganizationIdByMentorId.mockResolvedValue(null);

    const res = await POST(postRequest(VALID));

    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: null }),
    });
  });

  it('succeeds with nulls when there is no session', async () => {
    mocks.verifySession.mockResolvedValue(null);

    const res = await POST(postRequest(VALID));

    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: null,
        role: null,
        organizationId: null,
      }),
    });
  });

  it('captures pagePath from the Referer header', async () => {
    mocks.verifySession.mockResolvedValue(null);

    await POST(postRequest(VALID, { referer: 'http://localhost:3000/login?next=/chat' }));

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ pagePath: '/login' }),
    });
  });

  it('never stores the query string — reset tokens must not land in the table', async () => {
    mocks.verifySession.mockResolvedValue(null);

    await POST(
      postRequest(VALID, {
        referer: 'https://app.example.com/reset-password?token=SECRET-RESET-TOKEN#frag',
      }),
    );

    const stored = mocks.create.mock.calls[0][0].data;
    expect(stored.pagePath).toBe('/reset-password');
    expect(JSON.stringify(stored)).not.toContain('SECRET-RESET-TOKEN');
  });

  it('records null pagePath when Referer is absent', async () => {
    mocks.verifySession.mockResolvedValue(null);

    await POST(postRequest(VALID));

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ pagePath: null }),
    });
  });
});

describe('POST /api/feedback — abuse controls', () => {
  it('rejects submissions past the per-IP rate limit', async () => {
    mocks.verifySession.mockResolvedValue(null);
    const ip = '203.0.113.7';

    // 5 allowed within the window.
    for (let i = 0; i < 5; i++) {
      const res = await POST(postRequest(VALID, { ip }));
      expect(res.status).toBe(201);
    }

    const blocked = await POST(postRequest(VALID, { ip }));

    expect(blocked.status).toBe(429);
    expect(mocks.create).toHaveBeenCalledTimes(5);
  });

  it('cannot be bypassed by rotating a client-supplied x-forwarded-for', async () => {
    // The whole reason the limiter keys on the platform header: if it trusted
    // XFF, a fresh random value per request would reset the counter every time.
    mocks.verifySession.mockResolvedValue(null);
    const realIp = '203.0.113.99';

    for (let i = 0; i < 5; i++) {
      const res = await POST(
        postRequest(VALID, { ip: realIp, spoofedXff: `1.2.3.${i}` }),
      );
      expect(res.status).toBe(201);
    }

    const blocked = await POST(
      postRequest(VALID, { ip: realIp, spoofedXff: '9.9.9.9' }),
    );

    expect(blocked.status).toBe(429);
  });

  it('limits per IP, so one submitter does not block another', async () => {
    mocks.verifySession.mockResolvedValue(null);

    for (let i = 0; i < 6; i++) await POST(postRequest(VALID, { ip: '198.51.100.1' }));
    const other = await POST(postRequest(VALID, { ip: '198.51.100.2' }));

    expect(other.status).toBe(201);
  });

  it('rejects an oversized body', async () => {
    mocks.verifySession.mockResolvedValue(null);

    const res = await POST(
      postRequest({ ...VALID, body: 'x'.repeat(5001) }),
    );

    expect(res.status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects an oversized subject', async () => {
    mocks.verifySession.mockResolvedValue(null);

    const res = await POST(
      postRequest({ ...VALID, subject: 'x'.repeat(201) }),
    );

    expect(res.status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('accepts text right at the limit', async () => {
    mocks.verifySession.mockResolvedValue(null);

    const res = await POST(
      postRequest({ ...VALID, subject: 'x'.repeat(200), body: 'y'.repeat(5000) }),
    );

    expect(res.status).toBe(201);
  });

  it('rejects missing fields', async () => {
    mocks.verifySession.mockResolvedValue(null);

    const res = await POST(postRequest({ page: 'chat', subject: '   ' }));

    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects non-string fields', async () => {
    mocks.verifySession.mockResolvedValue(null);

    const res = await POST(postRequest({ page: 'chat', subject: 1, body: {} }));

    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/feedback', () => {
  it('returns 401 without a session', async () => {
    mocks.verifySession.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('returns 403 for a socio', async () => {
    mocks.verifySession.mockResolvedValue(SOCIO);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('returns 403 for a mentor — reads are admin-only', async () => {
    mocks.verifySession.mockResolvedValue({
      userId: 'mentor-1',
      role: 'mentor',
      name: 'Rosa',
      rememberMe: false,
      sessionStart: 0,
    });

    const res = await GET();

    expect(res.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('returns 200 for an admin', async () => {
    mocks.verifySession.mockResolvedValue(ADMIN);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });

  it('documents that the query is NOT tenant-scoped', async () => {
    // Platform admin is the only reader and needs the cross-tenant view —
    // anonymous rows carry no organizationId at all. This pins the query so it
    // fails loudly if someone adds scoping without revisiting the null-org rows.
    mocks.verifySession.mockResolvedValue(ADMIN);

    await GET();

    expect(mocks.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
    });
  });
});
