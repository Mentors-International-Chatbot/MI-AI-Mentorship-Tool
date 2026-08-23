/**
 * repo.archiveSocio — soft-archive (Platform Restructure Phase A, Stage 3 / A.3)
 * ----------------------------------------------------------------------------
 * Sets archivedAt, never deletes. Idempotent: re-archiving an already-archived
 * socio must not overwrite the original archivedAt — that timestamp is the
 * record of when the archive decision actually happened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  socio: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

import { prismaRepo } from '../prismaRepo';

const SOCIO_ID = 'socio-0000-0000-0000-000000000001';

function socioRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SOCIO_ID,
    whatsappPhoneNumber: null,
    channelType: 'web',
    externalId: SOCIO_ID,
    language: 'en',
    passwordHash: null,
    name: 'Test Socio',
    businessName: null,
    businessDescription: null,
    status: 'ACTIVE',
    promptOverrides: null,
    aiPaused: false,
    metadata: null,
    mentorId: null,
    curriculumCollectionKey: 'mi-colombia-curriculum',
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('archiveSocio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets archivedAt on a not-yet-archived socio', async () => {
    mockPrisma.socio.findUnique.mockResolvedValue(socioRow());
    mockPrisma.socio.update.mockResolvedValue(socioRow({ archivedAt: new Date('2026-08-22') }));

    const result = await prismaRepo.archiveSocio(SOCIO_ID);

    expect(mockPrisma.socio.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SOCIO_ID }, data: { archivedAt: expect.any(Date) } }),
    );
    expect(result.archivedAt).toEqual(new Date('2026-08-22'));
  });

  it('IDEMPOTENT: does not overwrite an existing archivedAt on re-entry', async () => {
    const originalArchivedAt = new Date('2026-08-01');
    mockPrisma.socio.findUnique.mockResolvedValue(socioRow({ archivedAt: originalArchivedAt }));

    const result = await prismaRepo.archiveSocio(SOCIO_ID);

    expect(mockPrisma.socio.update).not.toHaveBeenCalled();
    expect(result.archivedAt).toEqual(originalArchivedAt);
  });

  it('never deletes — only ever calls update, never delete', async () => {
    mockPrisma.socio.findUnique.mockResolvedValue(socioRow());
    mockPrisma.socio.update.mockResolvedValue(socioRow({ archivedAt: new Date() }));

    await prismaRepo.archiveSocio(SOCIO_ID);

    expect(mockPrisma.socio).not.toHaveProperty('delete');
  });

  it('throws when the socio does not exist', async () => {
    mockPrisma.socio.findUnique.mockResolvedValue(null);

    await expect(prismaRepo.archiveSocio('nonexistent')).rejects.toThrow('Socio not found');
    expect(mockPrisma.socio.update).not.toHaveBeenCalled();
  });
});
