/**
 * tenantPrismaRepo.createParticipant — upsert semantics
 * ----------------------------------------------------------------------------
 * This method sits on a repeatable path (a socio can re-select a course), so a
 * plain create would throw P2002 on the unique socioId the second time round.
 * It upserts on socioId instead, and refuses to re-home a profile that already
 * belongs to another tenant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  participantProfile: {
    findUnique: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

import { tenantPrismaRepo } from '../tenantPrismaRepo';
import { createTenantContext, TenantIsolationError } from '../tenantContext';

const SOCIO_ID = 'socio-0000-0000-0000-000000000001';
const ORG_ID = 'org-aaaa-0000-0000-000000000001';
const OTHER_ORG_ID = 'org-bbbb-0000-0000-000000000002';
const ctx = createTenantContext(ORG_ID);

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'participant-1',
    organizationId: ORG_ID,
    socioId: SOCIO_ID,
    displayName: 'Ana',
    preferredLang: 'en',
    metadata: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

const INPUT = {
  socioId: SOCIO_ID,
  displayName: 'Ana',
  preferredLang: 'en',
  metadata: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.participantProfile.findUnique.mockResolvedValue(null);
  mockPrisma.participantProfile.upsert.mockResolvedValue(profileRow());
  mockPrisma.participantProfile.create.mockResolvedValue(profileRow({ socioId: null }));
});

describe('createParticipant', () => {
  it('upserts on socioId rather than creating, so a second call is idempotent', async () => {
    await tenantPrismaRepo.createParticipant(ctx, INPUT);
    await tenantPrismaRepo.createParticipant(ctx, INPUT);

    expect(mockPrisma.participantProfile.create).not.toHaveBeenCalled();
    expect(mockPrisma.participantProfile.upsert).toHaveBeenCalledTimes(2);
    for (const call of mockPrisma.participantProfile.upsert.mock.calls) {
      expect(call[0].where).toEqual({ socioId: SOCIO_ID });
    }
  });

  it('takes organizationId from ctx on create', async () => {
    await tenantPrismaRepo.createParticipant(ctx, INPUT);

    const args = mockPrisma.participantProfile.upsert.mock.calls[0][0];
    expect(args.create).toEqual(
      expect.objectContaining({
        organizationId: ORG_ID,
        socioId: SOCIO_ID,
        preferredLang: 'en',
      }),
    );
  });

  it('never rewrites organizationId on the update path', async () => {
    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      id: 'participant-1',
      organizationId: ORG_ID,
    });

    await tenantPrismaRepo.createParticipant(ctx, INPUT);

    const args = mockPrisma.participantProfile.upsert.mock.calls[0][0];
    expect(args.update).not.toHaveProperty('organizationId');
  });

  it('refuses to re-home a profile owned by another tenant', async () => {
    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      id: 'participant-1',
      organizationId: OTHER_ORG_ID,
    });

    await expect(tenantPrismaRepo.createParticipant(ctx, INPUT)).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
    expect(mockPrisma.participantProfile.upsert).not.toHaveBeenCalled();
  });

  it('does not blank out an existing displayName when the caller has none', async () => {
    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      id: 'participant-1',
      organizationId: ORG_ID,
    });

    await tenantPrismaRepo.createParticipant(ctx, { ...INPUT, displayName: null });

    const args = mockPrisma.participantProfile.upsert.mock.calls[0][0];
    expect(args.update).not.toHaveProperty('displayName');
    expect(args.update.preferredLang).toBe('en');
  });

  it('falls back to a plain create when there is no socioId to key on', async () => {
    await tenantPrismaRepo.createParticipant(ctx, { ...INPUT, socioId: null });

    expect(mockPrisma.participantProfile.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.participantProfile.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.participantProfile.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ organizationId: ORG_ID, socioId: null }),
    );
  });
});
