/**
 * mentorCaseloadScope: the caseload (socioIds) is the scope; the course
 * list (collectionKeys) is derived, convenience data only. See adminScope.ts
 * for why this distinction matters — two mentors sharing an org and a
 * course must resolve to disjoint scopes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = {
  socio: { findMany: vi.fn() },
};

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

const { mentorCaseloadScope } = await import('@/lib/auth/mentorCaseloadScope');

const ORG_A = 'org-a';
const ORG_B = 'org-b';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mentorCaseloadScope', () => {
  it('returns no_caseload when the mentor has zero assigned socios', async () => {
    mockPrisma.socio.findMany.mockResolvedValue([]);
    expect(await mentorCaseloadScope('mentor-1')).toEqual({ status: 'no_caseload' });
  });

  it('returns no_profile when the caseload exists but none of it is anchored', async () => {
    mockPrisma.socio.findMany.mockResolvedValue([
      { id: 'socio-1', participantProfile: null },
      { id: 'socio-2', participantProfile: null },
    ]);
    expect(await mentorCaseloadScope('mentor-1')).toEqual({ status: 'no_profile' });
  });

  it('resolves organizationId, socioIds, and deduplicated collectionKeys from an anchored caseload', async () => {
    mockPrisma.socio.findMany.mockResolvedValue([
      {
        id: 'socio-1',
        participantProfile: {
          organizationId: ORG_A,
          enrollments: [{ collectionKey: 'course-a' }, { collectionKey: 'course-b' }],
        },
      },
      {
        id: 'socio-2',
        participantProfile: {
          organizationId: ORG_A,
          // Same course as socio-1 — must not duplicate in collectionKeys.
          enrollments: [{ collectionKey: 'course-a' }],
        },
      },
    ]);

    const result = await mentorCaseloadScope('mentor-1');
    expect(result).toEqual({
      status: 'ok',
      organizationId: ORG_A,
      socioIds: ['socio-1', 'socio-2'],
      collectionKeys: ['course-a', 'course-b'],
    });
  });

  it('excludes an unanchored socio from an otherwise-ok caseload rather than failing the whole result', async () => {
    mockPrisma.socio.findMany.mockResolvedValue([
      {
        id: 'socio-1',
        participantProfile: { organizationId: ORG_A, enrollments: [] },
      },
      { id: 'socio-2', participantProfile: null },
    ]);

    const result = await mentorCaseloadScope('mentor-1');
    expect(result).toEqual({
      status: 'ok',
      organizationId: ORG_A,
      socioIds: ['socio-1'],
      collectionKeys: [],
    });
  });

  it('drops dropped enrollments from the derived collectionKeys — the query already filters, this pins the caller does not also need to', async () => {
    mockPrisma.socio.findMany.mockResolvedValue([
      {
        id: 'socio-1',
        participantProfile: {
          organizationId: ORG_A,
          // The mock stands in for prisma's own `where: { status: { not: 'dropped' } }`
          // filter on the enrollments relation — a dropped enrollment's
          // collectionKey should never reach this far in real usage, but the
          // shape here still must not choke on it.
          enrollments: [{ collectionKey: 'course-a' }],
        },
      },
    ]);

    const result = await mentorCaseloadScope('mentor-1');
    expect(result).toEqual({
      status: 'ok',
      organizationId: ORG_A,
      socioIds: ['socio-1'],
      collectionKeys: ['course-a'],
    });
  });

  it('flags a caseload spanning multiple organizations as ambiguous_org rather than picking one', async () => {
    mockPrisma.socio.findMany.mockResolvedValue([
      { id: 'socio-1', participantProfile: { organizationId: ORG_A, enrollments: [] } },
      { id: 'socio-2', participantProfile: { organizationId: ORG_B, enrollments: [] } },
    ]);

    const result = await mentorCaseloadScope('mentor-1');
    expect(result).toEqual({ status: 'ambiguous_org', organizationIds: [ORG_A, ORG_B] });
  });

  it('filters null collectionKeys out of the derived list', async () => {
    mockPrisma.socio.findMany.mockResolvedValue([
      {
        id: 'socio-1',
        participantProfile: {
          organizationId: ORG_A,
          enrollments: [{ collectionKey: null }, { collectionKey: 'course-a' }],
        },
      },
    ]);

    const result = await mentorCaseloadScope('mentor-1');
    expect(result).toEqual({
      status: 'ok',
      organizationId: ORG_A,
      socioIds: ['socio-1'],
      collectionKeys: ['course-a'],
    });
  });
});
