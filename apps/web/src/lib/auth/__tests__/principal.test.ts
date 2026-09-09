/**
 * findOrCreatePrincipal: idempotent get-or-create keyed on (provider, subject).
 * resolvePrincipalForSession: the L1.a "resolve on the fly, not invalidate at
 * cutover" decision — a claim-less session backfills deterministically to a
 * password Principal keyed on userId; a principalId that fails to resolve is
 * an error, not a silent re-derive. See principal.ts for the full reasoning.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = {
  principal: { findUnique: vi.fn(), create: vi.fn() },
};

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

const { findOrCreatePrincipal, resolvePrincipalForSession } = await import('../principal');

function principalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'principal-1',
    provider: 'password',
    subject: 'socio-1',
    role: 'socio',
    status: 'ACTIVE',
    socioId: 'socio-1',
    mentorId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findOrCreatePrincipal', () => {
  it('returns the existing row without creating when (provider, subject) already exists', async () => {
    mockPrisma.principal.findUnique.mockResolvedValue(principalRow());

    const result = await findOrCreatePrincipal({
      provider: 'password',
      subject: 'socio-1',
      role: 'socio',
      socioId: 'socio-1',
    });

    expect(result.id).toBe('principal-1');
    expect(mockPrisma.principal.create).not.toHaveBeenCalled();
  });

  it('creates a new row when none exists, defaulting status to ACTIVE', async () => {
    mockPrisma.principal.findUnique.mockResolvedValue(null);
    mockPrisma.principal.create.mockResolvedValue(
      principalRow({ id: 'principal-2', provider: 'lti', subject: 'canvas-sub-1', mentorId: 'mentor-1', socioId: null, role: 'mentor' }),
    );

    const result = await findOrCreatePrincipal({
      provider: 'lti',
      subject: 'canvas-sub-1',
      role: 'mentor',
      mentorId: 'mentor-1',
    });

    expect(mockPrisma.principal.create).toHaveBeenCalledWith({
      data: {
        provider: 'lti',
        subject: 'canvas-sub-1',
        role: 'mentor',
        status: 'ACTIVE',
        socioId: null,
        mentorId: 'mentor-1',
      },
    });
    expect(result.provider).toBe('lti');
  });

  it('is idempotent: the same (provider, subject) never creates twice', async () => {
    mockPrisma.principal.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(principalRow());
    mockPrisma.principal.create.mockResolvedValue(principalRow());

    await findOrCreatePrincipal({ provider: 'password', subject: 'socio-1', role: 'socio', socioId: 'socio-1' });
    await findOrCreatePrincipal({ provider: 'password', subject: 'socio-1', role: 'socio', socioId: 'socio-1' });

    expect(mockPrisma.principal.create).toHaveBeenCalledTimes(1);
  });
});

describe('resolvePrincipalForSession', () => {
  it('looks up by principalId directly when the session already carries one', async () => {
    mockPrisma.principal.findUnique.mockResolvedValue(principalRow({ id: 'principal-9' }));

    const result = await resolvePrincipalForSession({
      principalId: 'principal-9',
      userId: 'socio-1',
      role: 'socio',
    });

    expect(result.id).toBe('principal-9');
    expect(mockPrisma.principal.findUnique).toHaveBeenCalledWith({ where: { id: 'principal-9' } });
    expect(mockPrisma.principal.create).not.toHaveBeenCalled();
  });

  it('throws rather than re-deriving when principalId does not resolve', async () => {
    mockPrisma.principal.findUnique.mockResolvedValue(null);

    await expect(
      resolvePrincipalForSession({ principalId: 'ghost', userId: 'socio-1', role: 'socio' }),
    ).rejects.toThrow('ghost');
    expect(mockPrisma.principal.create).not.toHaveBeenCalled();
  });

  it('backfills a password Principal from userId+role for a claim-less session (socio)', async () => {
    mockPrisma.principal.findUnique.mockResolvedValue(null);
    mockPrisma.principal.create.mockResolvedValue(
      principalRow({ provider: 'password', subject: 'socio-1', role: 'socio', socioId: 'socio-1', mentorId: null }),
    );

    const result = await resolvePrincipalForSession({ userId: 'socio-1', role: 'socio' });

    expect(mockPrisma.principal.create).toHaveBeenCalledWith({
      data: {
        provider: 'password',
        subject: 'socio-1',
        role: 'socio',
        status: 'ACTIVE',
        socioId: 'socio-1',
        mentorId: null,
      },
    });
    expect(result.provider).toBe('password');
  });

  it('backfills against mentorId, not socioId, for a non-socio claim-less session', async () => {
    mockPrisma.principal.findUnique.mockResolvedValue(null);
    mockPrisma.principal.create.mockResolvedValue(
      principalRow({ provider: 'password', subject: 'mentor-1', role: 'admin', socioId: null, mentorId: 'mentor-1' }),
    );

    await resolvePrincipalForSession({ userId: 'mentor-1', role: 'admin' });

    expect(mockPrisma.principal.create).toHaveBeenCalledWith({
      data: {
        provider: 'password',
        subject: 'mentor-1',
        role: 'admin',
        status: 'ACTIVE',
        socioId: null,
        mentorId: 'mentor-1',
      },
    });
  });

  it('backfilling twice for the same claim-less session resolves to the same Principal (idempotent)', async () => {
    mockPrisma.principal.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(principalRow());
    mockPrisma.principal.create.mockResolvedValue(principalRow());

    const first = await resolvePrincipalForSession({ userId: 'socio-1', role: 'socio' });
    const second = await resolvePrincipalForSession({ userId: 'socio-1', role: 'socio' });

    expect(mockPrisma.principal.create).toHaveBeenCalledTimes(1);
    expect(first.id).toBe(second.id);
  });
});
