/**
 * provisionLaunch — LTI course-start path
 * ----------------------------------------------------------------------------
 * Platform Restructure Phase A, Stage 1 (G3): every path that begins a
 * learner's course must create-or-resolve an ACTIVE Enrollment through the
 * one shared repo method, `tenantPrismaRepo.resolveOrCreateActiveEnrollment`.
 * This file pins that the LTI launch path does so — it previously wrote the
 * Enrollment itself via a raw `ltiRuntimeRepo.enrollment.upsert` call, a
 * second hand-rolled creation path alongside the web curriculum route's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  ltiContextFindUnique: vi.fn(),
  ltiIdentityUpsert: vi.fn(),
  ltiIdentityUpdate: vi.fn(),
  socioUpsert: vi.fn(),
  socioUpdate: vi.fn(),
  participantFindUnique: vi.fn(),
  participantCreate: vi.fn(),
  ltiEnrollmentUpsert: vi.fn(),
  mentorCreate: vi.fn(),
  mentorProfileCreate: vi.fn(),
  resolveOrCreateActiveEnrollment: vi.fn(),
}));

vi.mock('@/lib/repo/ltiRuntimeRepo', () => ({
  ltiRuntimeRepo: {
    ltiContext: { findUnique: mocks.ltiContextFindUnique },
    ltiIdentity: { upsert: mocks.ltiIdentityUpsert, update: mocks.ltiIdentityUpdate },
    socio: { upsert: mocks.socioUpsert, update: mocks.socioUpdate },
    participantProfile: { findUnique: mocks.participantFindUnique, create: mocks.participantCreate },
    ltiEnrollment: { upsert: mocks.ltiEnrollmentUpsert },
    mentor: { create: mocks.mentorCreate },
    mentorProfile: { create: mocks.mentorProfileCreate },
  },
}));

vi.mock('@/lib/repo/tenantPrismaRepo', () => ({
  tenantPrismaRepo: { resolveOrCreateActiveEnrollment: mocks.resolveOrCreateActiveEnrollment },
}));

import { provisionLaunch } from '../provision';

const CONTEXT_ID = 'context-1';
const ORG_ID = 'org-1';
const PROGRAM_VERSION_ID = 'pver-1';
const COHORT_ID = 'cohort-1';

const CONTEXT_ROW = {
  id: CONTEXT_ID,
  organizationId: ORG_ID,
  programVersionId: PROGRAM_VERSION_ID,
  cohortId: COHORT_ID,
  programVersion: { collection: { slug: 'ai-essentials' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ltiContextFindUnique.mockResolvedValue(CONTEXT_ROW);
  mocks.ltiIdentityUpsert.mockResolvedValue({ id: 'identity-1', socioId: null, mentorId: null });
  mocks.ltiIdentityUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: 'identity-1',
    socioId: (args.data.socioId as string | undefined) ?? 'socio-1',
    mentorId: (args.data.mentorId as string | undefined) ?? null,
  }));
  mocks.socioUpsert.mockResolvedValue({ id: 'socio-1' });
  mocks.socioUpdate.mockResolvedValue({ id: 'socio-1' });
  mocks.participantFindUnique.mockResolvedValue(null);
  mocks.participantCreate.mockResolvedValue({ id: 'participant-1', organizationId: ORG_ID });
  mocks.ltiEnrollmentUpsert.mockResolvedValue({});
  mocks.mentorCreate.mockResolvedValue({ id: 'mentor-1' });
  mocks.mentorProfileCreate.mockResolvedValue({ id: 'mentor-profile-1' });
  mocks.resolveOrCreateActiveEnrollment.mockResolvedValue({ id: 'enrollment-1', status: 'active' });
});

describe('provisionLaunch — learner role', () => {
  it('resolves an Enrollment through the shared repo method, not a raw upsert', async () => {
    await provisionLaunch({
      platformId: 'platform-1',
      subject: 'subject-1',
      contextId: CONTEXT_ID,
      roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership/Learner'],
      claims: { name: 'Canvas Learner', locale: 'en' },
    });

    expect(mocks.resolveOrCreateActiveEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID }),
      expect.objectContaining({
        participantId: 'participant-1',
        programVersionId: PROGRAM_VERSION_ID,
        cohortId: COHORT_ID,
        channel: 'canvas',
      }),
    );
  });

  it('reuses an existing ParticipantProfile rather than creating a second one on re-launch', async () => {
    mocks.participantFindUnique.mockResolvedValue({ id: 'participant-existing', organizationId: ORG_ID });

    await provisionLaunch({
      platformId: 'platform-1',
      subject: 'subject-1',
      contextId: CONTEXT_ID,
      roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership/Learner'],
      claims: { name: 'Canvas Learner', locale: 'en' },
    });

    expect(mocks.participantCreate).not.toHaveBeenCalled();
    expect(mocks.resolveOrCreateActiveEnrollment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ participantId: 'participant-existing' }),
    );
  });

  it('does not attempt enrollment for an instructor-only launch', async () => {
    mocks.ltiIdentityUpsert.mockResolvedValue({ id: 'identity-2', socioId: null, mentorId: null });

    await provisionLaunch({
      platformId: 'platform-1',
      subject: 'subject-2',
      contextId: CONTEXT_ID,
      roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership/Instructor'],
      claims: { name: 'Canvas Instructor', locale: 'en' },
    });

    expect(mocks.resolveOrCreateActiveEnrollment).not.toHaveBeenCalled();
  });
});
