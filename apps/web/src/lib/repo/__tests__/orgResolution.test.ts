/**
 * socio → organization resolution chain
 * ----------------------------------------------------------------------------
 * Tier 1 (ParticipantProfile) and tier 2 (curriculum collection) identify a
 * real tenant. Tier 3 (DEFAULT_ORGANIZATION_ID) is a guess.
 *
 * The case these tests exist for: ContentCollection is unique on
 * (organizationId, slug), so a slug can be held by more than one tenant. An
 * ambiguous slug is NOT a resolution — it must fall through to tier 3 so that
 * callers keying off `source` can fail closed, rather than being handed an
 * arbitrary org stamped 'collection_key'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  participantProfile: {
    findUnique: vi.fn(),
  },
  socio: {
    findUnique: vi.fn(),
  },
  contentCollection: {
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

// Import AFTER mocking
import { tenantPrismaRepo } from '../tenantPrismaRepo';

const SOCIO_ID = 'soci-0000-0000-0000-000000000001';
const ORG_FROM_PROFILE = 'org-profile-000000000001';
const ORG_FROM_COLLECTION = 'org-collection-00000001';
const ORG_OTHER_TENANT = 'org-other-00000000000001';
const DEFAULT_ORG = 'org-default-000000000001';
const SLUG = 'intro-course';

const originalDefaultOrg = process.env.DEFAULT_ORGANIZATION_ID;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEFAULT_ORGANIZATION_ID = DEFAULT_ORG;
  // Default posture: no profile, socio carries a curriculum key.
  mockPrisma.participantProfile.findUnique.mockResolvedValue(null);
  mockPrisma.socio.findUnique.mockResolvedValue({ curriculumCollectionKey: SLUG });
  mockPrisma.contentCollection.findMany.mockResolvedValue([]);
});

afterEach(() => {
  if (originalDefaultOrg === undefined) {
    delete process.env.DEFAULT_ORGANIZATION_ID;
  } else {
    process.env.DEFAULT_ORGANIZATION_ID = originalDefaultOrg;
  }
  vi.restoreAllMocks();
});

describe('resolveOrganizationForSocio — tier reporting', () => {
  it('tier 1: reports participant_profile when the socio has a profile', async () => {
    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      organizationId: ORG_FROM_PROFILE,
    });

    const result = await tenantPrismaRepo.resolveOrganizationForSocio(SOCIO_ID);

    expect(result).toEqual({
      organizationId: ORG_FROM_PROFILE,
      source: 'participant_profile',
    });
    // Tier 1 short-circuits — the curriculum path is never consulted.
    expect(mockPrisma.contentCollection.findMany).not.toHaveBeenCalled();
  });

  it('tier 2: resolves on exactly one slug match', async () => {
    mockPrisma.contentCollection.findMany.mockResolvedValue([
      { organizationId: ORG_FROM_COLLECTION },
    ]);

    const result = await tenantPrismaRepo.resolveOrganizationForSocio(SOCIO_ID);

    expect(result).toEqual({
      organizationId: ORG_FROM_COLLECTION,
      source: 'collection_key',
    });
  });

  it('tier 2: falls through to default when two tenants hold the slug', async () => {
    mockPrisma.contentCollection.findMany.mockResolvedValue([
      { organizationId: ORG_FROM_COLLECTION },
      { organizationId: ORG_OTHER_TENANT },
    ]);

    const result = await tenantPrismaRepo.resolveOrganizationForSocio(SOCIO_ID);

    expect(result).toEqual({ organizationId: DEFAULT_ORG, source: 'default' });
    // Critically: it must NOT pick one and call it authoritative.
    expect(result.source).not.toBe('collection_key');
  });

  it('tier 2: warns loudly on a collision, naming slug, socio, and candidates', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockPrisma.contentCollection.findMany.mockResolvedValue([
      { organizationId: ORG_FROM_COLLECTION },
      { organizationId: ORG_OTHER_TENANT },
    ]);

    await tenantPrismaRepo.resolveOrganizationForSocio(SOCIO_ID);

    const collisionWarning = warn.mock.calls
      .map((args) => String(args[0]))
      .find((msg) => msg.includes('is held by'));

    expect(collisionWarning).toBeDefined();
    expect(collisionWarning).toContain(SLUG);
    expect(collisionWarning).toContain(SOCIO_ID);
    expect(collisionWarning).toContain(ORG_FROM_COLLECTION);
    expect(collisionWarning).toContain(ORG_OTHER_TENANT);
  });

  it('tier 3: reports default on zero slug matches', async () => {
    mockPrisma.contentCollection.findMany.mockResolvedValue([]);

    const result = await tenantPrismaRepo.resolveOrganizationForSocio(SOCIO_ID);

    expect(result).toEqual({ organizationId: DEFAULT_ORG, source: 'default' });
  });

  it('tier 3: reports default when the socio has no curriculum key at all', async () => {
    mockPrisma.socio.findUnique.mockResolvedValue({ curriculumCollectionKey: null });

    const result = await tenantPrismaRepo.resolveOrganizationForSocio(SOCIO_ID);

    expect(result).toEqual({ organizationId: DEFAULT_ORG, source: 'default' });
    expect(mockPrisma.contentCollection.findMany).not.toHaveBeenCalled();
  });

  it('throws rather than guessing when DEFAULT_ORGANIZATION_ID is unset', async () => {
    delete process.env.DEFAULT_ORGANIZATION_ID;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPrisma.contentCollection.findMany.mockResolvedValue([]);

    await expect(tenantPrismaRepo.resolveOrganizationForSocio(SOCIO_ID)).rejects.toThrow(
      /Cannot resolve organization/,
    );
  });
});

describe('resolveOrganizationIdForSocio — unchanged contract', () => {
  it('still returns a bare id string on tier 1', async () => {
    mockPrisma.participantProfile.findUnique.mockResolvedValue({
      organizationId: ORG_FROM_PROFILE,
    });

    await expect(tenantPrismaRepo.resolveOrganizationIdForSocio(SOCIO_ID)).resolves.toBe(
      ORG_FROM_PROFILE,
    );
  });

  it('still returns the default org id on tier 3 rather than throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockPrisma.contentCollection.findMany.mockResolvedValue([]);

    await expect(tenantPrismaRepo.resolveOrganizationIdForSocio(SOCIO_ID)).resolves.toBe(
      DEFAULT_ORG,
    );
  });

  it('an ambiguous slug degrades to the default org, not an arbitrary tenant', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockPrisma.contentCollection.findMany.mockResolvedValue([
      { organizationId: ORG_FROM_COLLECTION },
      { organizationId: ORG_OTHER_TENANT },
    ]);

    await expect(tenantPrismaRepo.resolveOrganizationIdForSocio(SOCIO_ID)).resolves.toBe(
      DEFAULT_ORG,
    );
  });
});
