import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload } from '@/lib/auth/session';

const mockPrisma = {
  contentCollection: { findMany: vi.fn() },
  program: { findMany: vi.fn() },
  programMembership: { findMany: vi.fn() },
};

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

const { writableScopesFor, canWriteScope } = await import('@/lib/auth/courseScope');

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function session(role: SessionPayload['role'], userId = 'u1'): SessionPayload {
  return { userId, role, name: 'Test' } as SessionPayload;
}

/** One course lead bound to a program in ORG_A owning collection `course-a`. */
function seedCourseLeadMembership() {
  mockPrisma.programMembership.findMany.mockResolvedValue([
    {
      programId: 'prog-a',
      program: {
        organizationId: ORG_A,
        versions: [
          { collection: { slug: 'course-a', name: 'Course A' } },
          // Same collection backing a second version — must not duplicate.
          { collection: { slug: 'course-a', name: 'Course A' } },
          { collection: null }, // a version with no collection yet
        ],
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.contentCollection.findMany.mockResolvedValue([
    { slug: 'course-a', name: 'Course A', organizationId: ORG_A },
    { slug: 'course-b', name: 'Course B', organizationId: ORG_B },
  ]);
  mockPrisma.program.findMany.mockResolvedValue([
    { id: 'prog-a', organizationId: ORG_A },
    { id: 'prog-b', organizationId: ORG_B },
  ]);
});

describe('writableScopesFor', () => {
  it('gives an admin every course on the platform', async () => {
    const scopes = await writableScopesFor(session('admin'));
    expect(scopes.map((s) => s.collectionKey).sort()).toEqual(['course-a', 'course-b']);
  });

  it('gives a course lead only the courses their programs own', async () => {
    seedCourseLeadMembership();
    const scopes = await writableScopesFor(session('course_lead'));
    expect(scopes.map((s) => s.collectionKey)).toEqual(['course-a']);
    expect(scopes[0].organizationId).toBe(ORG_A);
  });

  it('collapses one collection shared by several program versions', async () => {
    seedCourseLeadMembership();
    const scopes = await writableScopesFor(session('course_lead'));
    // The fixture has course-a twice; a course is the unit of configuration.
    expect(scopes).toHaveLength(1);
  });

  it('gives a course lead with no memberships nothing', async () => {
    mockPrisma.programMembership.findMany.mockResolvedValue([]);
    expect(await writableScopesFor(session('course_lead'))).toEqual([]);
  });

  it('gives a mentor nothing — configuring courses is not their role', async () => {
    expect(await writableScopesFor(session('mentor'))).toEqual([]);
  });

  it('gives a learner nothing', async () => {
    expect(await writableScopesFor(session('socio'))).toEqual([]);
  });
});

describe('canWriteScope', () => {
  it('lets a course lead write their own course', async () => {
    seedCourseLeadMembership();
    const ok = await canWriteScope(session('course_lead'), {
      organizationId: ORG_A,
      collectionKey: 'course-a',
    });
    expect(ok).toBe(true);
  });

  it("refuses a course lead writing another course", async () => {
    seedCourseLeadMembership();
    const ok = await canWriteScope(session('course_lead'), {
      organizationId: ORG_B,
      collectionKey: 'course-b',
    });
    expect(ok).toBe(false);
  });

  it('refuses a course lead claiming their own course under another org', async () => {
    // Guards against trusting a client-supplied organizationId.
    seedCourseLeadMembership();
    const ok = await canWriteScope(session('course_lead'), {
      organizationId: ORG_B,
      collectionKey: 'course-a',
    });
    expect(ok).toBe(false);
  });

  it('refuses a course lead writing the platform tier', async () => {
    // The platform tier is what every course inherits; editing it would reach
    // past their own course into everyone else's.
    seedCourseLeadMembership();
    expect(await canWriteScope(session('course_lead'), {})).toBe(false);
    expect(
      await canWriteScope(session('course_lead'), { organizationId: ORG_A, collectionKey: null }),
    ).toBe(false);
  });

  it('lets an admin write the platform tier', async () => {
    expect(await canWriteScope(session('admin'), {})).toBe(true);
  });

  it('refuses a mentor and a learner outright', async () => {
    for (const role of ['mentor', 'socio'] as const) {
      expect(await canWriteScope(session(role), { organizationId: ORG_A, collectionKey: 'course-a' })).toBe(false);
      expect(await canWriteScope(session(role), {})).toBe(false);
    }
  });
});
