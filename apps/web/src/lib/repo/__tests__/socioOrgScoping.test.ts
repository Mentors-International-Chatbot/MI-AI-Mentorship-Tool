/**
 * Org scoping for socio list queries
 * ----------------------------------------------------------------------------
 * `Socio` carries no organizationId. The tenancy anchor is
 * `ParticipantProfile.organizationId`, so every tenant-scoped socio read has to
 * filter through that relation.
 *
 * The bug these tests exist for: `getSociosByMentor` scoped by `mentorId` only.
 * Nothing in the schema stops `Socio.mentorId` from pointing at a mentor in a
 * different organization, so an ownership convention was standing in for a
 * tenancy boundary. `getSociosForMentor` applies both.
 *
 * `getSociosAcrossAllOrganizations` is the deliberate exception — platform
 * admin only — and is asserted to be the ONLY path that returns multi-org data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  socio: {
    findMany: vi.fn(),
  },
  mentorProfile: {
    findUnique: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

// Import AFTER mocking
import { tenantPrismaRepo } from '../tenantPrismaRepo';
import { prismaRepo } from '../prismaRepo';

const ORG_A = 'org-aaaa-0000-0000-000000000001';
const ORG_B = 'org-bbbb-0000-0000-000000000002';
const MENTOR_1 = 'mentor-0000-0000-000000000001';
const MENTOR_2 = 'mentor-0000-0000-000000000002';

/** Minimal Prisma-shaped socio row; only the fields the mapper reads matter. */
function socioRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'socio-1',
    whatsappPhoneNumber: null,
    channelType: 'whatsapp',
    externalId: '',
    language: 'es',
    name: 'Test Socio',
    businessName: null,
    businessDescription: null,
    status: 'ACTIVE',
    promptOverrides: null,
    aiPaused: false,
    mentorId: MENTOR_1,
    curriculumCollectionKey: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    ...overrides,
  };
}

/**
 * Stand-in for the socios table. `findMany` is wired to actually apply the
 * `where` clause the repo builds, so a missing filter shows up as leaked rows
 * rather than passing because the mock returned whatever it was told to.
 */
const ALL_SOCIOS = [
  { row: socioRow({ id: 'a1', mentorId: MENTOR_1 }), org: ORG_A },
  { row: socioRow({ id: 'a2', mentorId: MENTOR_2 }), org: ORG_A },
  { row: socioRow({ id: 'a3', mentorId: null }), org: ORG_A },
  // Same mentorId as a1, but a different tenant. This is the cross-org row.
  { row: socioRow({ id: 'b1', mentorId: MENTOR_1 }), org: ORG_B },
  { row: socioRow({ id: 'b2', mentorId: MENTOR_2 }), org: ORG_B },
  // Inactive: must never appear regardless of scoping.
  { row: socioRow({ id: 'a4', mentorId: MENTOR_1, status: 'PAUSED' }), org: ORG_A },
  // No ParticipantProfile at all — unanchored, belongs to no tenant.
  { row: socioRow({ id: 'orphan', mentorId: MENTOR_1 }), org: null },
];

beforeEach(() => {
  vi.clearAllMocks();

  mockPrisma.socio.findMany.mockImplementation(async (args: {
    where?: {
      status?: string;
      mentorId?: string;
      participantProfile?: { organizationId?: string };
    };
  }) => {
    const where = args?.where ?? {};
    return ALL_SOCIOS.filter(({ row, org }) => {
      if (where.status !== undefined && row.status !== where.status) return false;
      if (where.mentorId !== undefined && row.mentorId !== where.mentorId) return false;
      if (where.participantProfile !== undefined) {
        // Relation filter on a nullable to-one: no profile means no match.
        if (org === null) return false;
        if (where.participantProfile.organizationId !== org) return false;
      }
      return true;
    }).map(({ row }) => row);
  });
});

describe('tenantRepo.getSociosForOrganization', () => {
  it('returns only the requested organization\'s active socios', async () => {
    const socios = await tenantPrismaRepo.getSociosForOrganization(ORG_A);

    expect(socios.map((s) => s.id).sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('filters through participantProfile.organizationId, not a socio column', async () => {
    await tenantPrismaRepo.getSociosForOrganization(ORG_A);

    expect(mockPrisma.socio.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          participantProfile: { organizationId: ORG_A },
        }),
      })
    );
  });

  it('excludes socios with no ParticipantProfile — an unanchored socio has no tenant', async () => {
    const socios = await tenantPrismaRepo.getSociosForOrganization(ORG_A);

    expect(socios.map((s) => s.id)).not.toContain('orphan');
  });

  it('excludes non-ACTIVE socios', async () => {
    const socios = await tenantPrismaRepo.getSociosForOrganization(ORG_A);

    expect(socios.map((s) => s.id)).not.toContain('a4');
  });
});

describe('tenantRepo.getSociosForMentor', () => {
  it('returns only the mentor\'s assignments inside their own org', async () => {
    const socios = await tenantPrismaRepo.getSociosForMentor(ORG_A, MENTOR_1);

    expect(socios.map((s) => s.id)).toEqual(['a1']);
  });

  it('never returns a socio in a different org even when mentorId matches', async () => {
    const socios = await tenantPrismaRepo.getSociosForMentor(ORG_A, MENTOR_1);

    // b1 is assigned to MENTOR_1 but lives in ORG_B.
    expect(socios.map((s) => s.id)).not.toContain('b1');
    expect(socios.every((s) => s.mentorId === MENTOR_1)).toBe(true);
  });

  it('applies BOTH filters — org scope is not satisfied by mentorId alone', async () => {
    await tenantPrismaRepo.getSociosForMentor(ORG_A, MENTOR_1);

    expect(mockPrisma.socio.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          mentorId: MENTOR_1,
          participantProfile: { organizationId: ORG_A },
        }),
      })
    );
  });

  it('does not return org-mates assigned to a different mentor', async () => {
    const socios = await tenantPrismaRepo.getSociosForMentor(ORG_A, MENTOR_1);

    expect(socios.map((s) => s.id)).not.toContain('a2');
    expect(socios.map((s) => s.id)).not.toContain('a3');
  });

  it('returns an empty list for a mentor whose org holds none of their assignments', async () => {
    // MENTOR_1's only other assignment is in ORG_B; asking as ORG_B's tenant
    // for a mentor with no ORG_B rows must not widen the scope.
    const socios = await tenantPrismaRepo.getSociosForMentor(ORG_A, 'mentor-unknown');

    expect(socios).toEqual([]);
  });
});

describe('mentor with no MentorProfile', () => {
  /**
   * Mirrors the route/page logic: a mentor whose org cannot be resolved gets an
   * empty list. The failure mode being guarded is falling back to an unscoped
   * query, which would hand a profile-less mentor every socio on the platform.
   */
  async function resolveSociosForMentor(mentorId: string) {
    const organizationId = await tenantPrismaRepo.getOrganizationIdByMentorId(mentorId);
    return organizationId
      ? await tenantPrismaRepo.getSociosForMentor(organizationId, mentorId)
      : [];
  }

  it('getOrganizationIdByMentorId returns null when there is no profile', async () => {
    mockPrisma.mentorProfile.findUnique.mockResolvedValue(null);

    expect(await tenantPrismaRepo.getOrganizationIdByMentorId(MENTOR_1)).toBeNull();
  });

  it('yields an empty list, not every socio', async () => {
    mockPrisma.mentorProfile.findUnique.mockResolvedValue(null);

    const socios = await resolveSociosForMentor(MENTOR_1);

    expect(socios).toEqual([]);
    // The unscoped query must never have been issued.
    expect(mockPrisma.socio.findMany).not.toHaveBeenCalled();
  });

  it('yields the scoped list once a profile exists', async () => {
    mockPrisma.mentorProfile.findUnique.mockResolvedValue({ organizationId: ORG_A });

    const socios = await resolveSociosForMentor(MENTOR_1);

    expect(socios.map((s) => s.id)).toEqual(['a1']);
  });
});

describe('getSociosAcrossAllOrganizations — the deliberate cross-tenant path', () => {
  it('is the only call that returns socios from more than one org', async () => {
    const all = await prismaRepo.getSociosAcrossAllOrganizations();
    const scopedA = await tenantPrismaRepo.getSociosForOrganization(ORG_A);
    const scopedB = await tenantPrismaRepo.getSociosForOrganization(ORG_B);
    const scopedMentor = await tenantPrismaRepo.getSociosForMentor(ORG_A, MENTOR_1);

    const orgOf = (id: string) => ALL_SOCIOS.find((s) => s.row.id === id)?.org;
    const orgsIn = (rows: { id: string }[]) => new Set(rows.map((r) => orgOf(r.id)));

    // The cross-tenant path spans both orgs (and the unanchored socio).
    expect(orgsIn(all).size).toBeGreaterThan(1);
    expect(all.map((s) => s.id).sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'orphan']);

    // Every scoped path stays inside exactly one org.
    expect(orgsIn(scopedA)).toEqual(new Set([ORG_A]));
    expect(orgsIn(scopedB)).toEqual(new Set([ORG_B]));
    expect(orgsIn(scopedMentor)).toEqual(new Set([ORG_A]));
  });

  it('issues no organization filter at all — that is the point of it', async () => {
    await prismaRepo.getSociosAcrossAllOrganizations();

    const [args] = mockPrisma.socio.findMany.mock.calls[0];
    expect(args.where).toEqual({ status: 'ACTIVE' });
    expect(args.where).not.toHaveProperty('participantProfile');
  });
});
