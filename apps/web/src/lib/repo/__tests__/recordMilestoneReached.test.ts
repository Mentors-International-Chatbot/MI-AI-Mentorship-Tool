/**
 * recordMilestoneReached — enrollmentId resolution and cross-org guard (A.4)
 * ----------------------------------------------------------------------------
 * Platform Restructure Phase A, Stage 4. This is the legacy `repo`, which
 * does not take a TenantContext — it verifies data.organizationId directly
 * against a caller-supplied enrollmentId instead, matching
 * tenantPrismaRepo.createAssessmentSession's guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  enrollment: { findUnique: vi.fn(), findMany: vi.fn() },
  socio: { findUnique: vi.fn() },
  milestoneProgress: { upsert: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

import { prismaRepo } from '../prismaRepo';

const ORG_A = 'org-aaaa-0000-0000-000000000001';
const ORG_B = 'org-bbbb-0000-0000-000000000002';
const SOCIO_ID = 'socio-0000-0000-0000-000000000001';
const PARTICIPANT_ID = 'part-0000-0000-0000-000000000001';
const ENROLLMENT_A = 'enrl-a-0000-0000-000000000001';
const ENROLLMENT_B = 'enrl-b-0000-0000-000000000002';

function mockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mp-1', socioId: SOCIO_ID, organizationId: ORG_A, collectionKey: 'course-a',
    milestoneKey: 'm1', reachedAt: new Date(), source: 'ai_marker', evidence: null, enrollmentId: null,
    ...overrides,
  };
}

describe('recordMilestoneReached — enrollmentId (A.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('BLOCKS: a caller-supplied enrollmentId from another org is dropped, falls back to resolution', async () => {
    mockPrisma.enrollment.findUnique.mockResolvedValueOnce({
      cohort: { program: { organizationId: ORG_B } }, // wrong org
    });
    mockPrisma.socio.findUnique.mockResolvedValueOnce({ participantProfile: { id: PARTICIPANT_ID } });
    mockPrisma.enrollment.findMany.mockResolvedValueOnce([{ id: ENROLLMENT_A, status: 'active', enrolledAt: new Date() }]);
    mockPrisma.milestoneProgress.upsert.mockResolvedValue(mockRow({ enrollmentId: ENROLLMENT_A }));

    await prismaRepo.recordMilestoneReached({
      socioId: SOCIO_ID,
      organizationId: ORG_A,
      collectionKey: 'course-a',
      milestoneKey: 'm1',
      enrollmentId: ENROLLMENT_B, // attacker/bug-supplied, wrong org
    });

    expect(mockPrisma.milestoneProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ enrollmentId: ENROLLMENT_A }) }),
    );
  });

  it('ALLOWS: a caller-supplied enrollmentId from the right org is used as-is, no fallback lookup', async () => {
    mockPrisma.enrollment.findUnique.mockResolvedValueOnce({
      cohort: { program: { organizationId: ORG_A } },
    });
    mockPrisma.milestoneProgress.upsert.mockResolvedValue(mockRow({ enrollmentId: ENROLLMENT_A }));

    await prismaRepo.recordMilestoneReached({
      socioId: SOCIO_ID,
      organizationId: ORG_A,
      collectionKey: 'course-a',
      milestoneKey: 'm1',
      enrollmentId: ENROLLMENT_A,
    });

    expect(mockPrisma.milestoneProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ enrollmentId: ENROLLMENT_A }) }),
    );
    expect(mockPrisma.socio.findUnique).not.toHaveBeenCalled();
  });

  it('resolves enrollmentId internally when the caller supplies none (chat-surface case)', async () => {
    mockPrisma.socio.findUnique.mockResolvedValueOnce({ participantProfile: { id: PARTICIPANT_ID } });
    mockPrisma.enrollment.findMany.mockResolvedValueOnce([{ id: ENROLLMENT_A, status: 'active', enrolledAt: new Date() }]);
    mockPrisma.milestoneProgress.upsert.mockResolvedValue(mockRow({ enrollmentId: ENROLLMENT_A }));

    await prismaRepo.recordMilestoneReached({
      socioId: SOCIO_ID,
      organizationId: ORG_A,
      collectionKey: 'course-a',
      milestoneKey: 'm1',
    });

    expect(mockPrisma.enrollment.findUnique).not.toHaveBeenCalled(); // no caller-supplied id to verify
    expect(mockPrisma.milestoneProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ enrollmentId: ENROLLMENT_A }) }),
    );
  });
});
