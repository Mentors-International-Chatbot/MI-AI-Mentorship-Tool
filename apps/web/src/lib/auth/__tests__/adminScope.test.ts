/**
 * resolveAdminScope: which org/course/learner slice a caller may see
 * aggregates for. A discriminated union on purpose — see the file's own
 * header comment for why `system` carries no organizationId and why
 * `mentor` carries socioIds as the real constraint, collectionKeys as
 * derived convenience data only.
 *
 * The adversarial test at the bottom is the one that would have caught the
 * original flat-object shape: two mentors, same org, same course, disjoint
 * caseloads — each resolver result must exclude the other's learners.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload } from '@/lib/auth/session';

const mocks = vi.hoisted(() => ({
  writableScopesFor: vi.fn(),
  mentorCaseloadScope: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock('@/lib/auth/courseScope', () => ({ writableScopesFor: mocks.writableScopesFor }));
vi.mock('@/lib/auth/mentorCaseloadScope', () => ({ mentorCaseloadScope: mocks.mentorCaseloadScope }));
vi.mock('@/lib/logging/logger', () => ({ logEvent: mocks.logEvent }));

const { resolveAdminScope } = await import('@/lib/auth/adminScope');
type AdminScopeModule = typeof import('@/lib/auth/adminScope');
type AdminScopeNoneReason = Extract<Awaited<ReturnType<AdminScopeModule['resolveAdminScope']>>, { kind: 'none' }>['reason'];

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function session(role: SessionPayload['role'], userId = 'u1'): SessionPayload {
  return { userId, role, name: 'Test' } as SessionPayload;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.logEvent.mockResolvedValue(undefined);
});

describe('resolveAdminScope — system', () => {
  it('gives an admin a system scope with no organizationId at all', async () => {
    const scope = await resolveAdminScope(session('admin', 'admin-1'));
    expect(scope).toEqual({ kind: 'system', actorId: 'admin-1' });
    // Not just "equals undefined" — the property must be structurally
    // absent, which is what makes passing it to a tenant-scoped method a
    // type error rather than a runtime one.
    expect('organizationId' in scope).toBe(false);
  });
});

describe('resolveAdminScope — course_admin', () => {
  it('resolves a single-org course lead to a course_admin scope', async () => {
    mocks.writableScopesFor.mockResolvedValue([
      { organizationId: ORG_A, collectionKey: 'course-a', programId: 'p1', displayName: 'Course A' },
      { organizationId: ORG_A, collectionKey: 'course-b', programId: 'p1', displayName: 'Course B' },
    ]);

    const scope = await resolveAdminScope(session('course_lead', 'lead-1'));
    expect(scope).toEqual({
      kind: 'course_admin',
      actorId: 'lead-1',
      organizationId: ORG_A,
      collectionKeys: ['course-a', 'course-b'],
    });
  });

  it('returns none/no_membership for a course lead with no writable scopes', async () => {
    mocks.writableScopesFor.mockResolvedValue([]);
    const scope = await resolveAdminScope(session('course_lead', 'lead-1'));
    expect(scope).toEqual({ kind: 'none', actorId: 'lead-1', reason: 'no_membership' });
  });

  it('fails closed (none/ambiguous_org_course_lead) and logs a warn when scopes span multiple orgs', async () => {
    mocks.writableScopesFor.mockResolvedValue([
      { organizationId: ORG_A, collectionKey: 'course-a', programId: 'p1', displayName: 'Course A' },
      { organizationId: ORG_B, collectionKey: 'course-b', programId: 'p2', displayName: 'Course B' },
    ]);

    const scope = await resolveAdminScope(session('course_lead', 'lead-1'));
    expect(scope).toEqual({ kind: 'none', actorId: 'lead-1', reason: 'ambiguous_org_course_lead' });
    expect(mocks.logEvent).toHaveBeenCalledWith('warn', 'system', expect.stringContaining('multiple organizations'), expect.anything());
  });
});

describe('resolveAdminScope — mentor', () => {
  it('resolves an anchored caseload to a mentor scope carrying socioIds', async () => {
    mocks.mentorCaseloadScope.mockResolvedValue({
      status: 'ok',
      organizationId: ORG_A,
      socioIds: ['socio-1', 'socio-2'],
      collectionKeys: ['course-a'],
    });

    const scope = await resolveAdminScope(session('mentor', 'mentor-1'));
    expect(scope).toEqual({
      kind: 'mentor',
      actorId: 'mentor-1',
      organizationId: ORG_A,
      socioIds: ['socio-1', 'socio-2'],
      collectionKeys: ['course-a'],
    });
  });

  it('maps no_caseload to none/no_caseload', async () => {
    mocks.mentorCaseloadScope.mockResolvedValue({ status: 'no_caseload' });
    const scope = await resolveAdminScope(session('mentor', 'mentor-1'));
    expect(scope).toEqual({ kind: 'none', actorId: 'mentor-1', reason: 'no_caseload' });
  });

  it('maps no_profile to none/no_profile', async () => {
    mocks.mentorCaseloadScope.mockResolvedValue({ status: 'no_profile' });
    const scope = await resolveAdminScope(session('mentor', 'mentor-1'));
    expect(scope).toEqual({ kind: 'none', actorId: 'mentor-1', reason: 'no_profile' });
  });

  it('fails closed (none/ambiguous_org_mentor) and logs an error when the caseload spans multiple orgs', async () => {
    mocks.mentorCaseloadScope.mockResolvedValue({ status: 'ambiguous_org', organizationIds: [ORG_A, ORG_B] });
    const scope = await resolveAdminScope(session('mentor', 'mentor-1'));
    expect(scope).toEqual({ kind: 'none', actorId: 'mentor-1', reason: 'ambiguous_org_mentor' });
    expect(mocks.logEvent).toHaveBeenCalledWith('error', 'system', expect.stringContaining('multiple organizations'), expect.anything());
  });
});

/**
 * Exact-reason-string pins, one assertion each, so a future edit that
 * collapses two of these back onto a shared string fails here first rather
 * than being noticed only when someone tries to alert on the anomaly cases
 * and can't tell them apart from the ordinary empty ones.
 */
describe('resolveAdminScope — none.reason is distinct per path, not shared', () => {
  it('mentor-no-caseload -> no_caseload', async () => {
    mocks.mentorCaseloadScope.mockResolvedValue({ status: 'no_caseload' });
    const scope = await resolveAdminScope(session('mentor', 'm1'));
    expect(scope.kind).toBe('none');
    expect((scope as { reason: string }).reason).toBe('no_caseload');
  });

  it('mentor-ambiguous-org -> ambiguous_org_mentor', async () => {
    mocks.mentorCaseloadScope.mockResolvedValue({ status: 'ambiguous_org', organizationIds: [ORG_A, ORG_B] });
    const scope = await resolveAdminScope(session('mentor', 'm1'));
    expect(scope.kind).toBe('none');
    expect((scope as { reason: string }).reason).toBe('ambiguous_org_mentor');
  });

  it('course_lead-no-membership -> no_membership', async () => {
    mocks.writableScopesFor.mockResolvedValue([]);
    const scope = await resolveAdminScope(session('course_lead', 'l1'));
    expect(scope.kind).toBe('none');
    expect((scope as { reason: string }).reason).toBe('no_membership');
  });

  it('course_lead-multi-org -> ambiguous_org_course_lead', async () => {
    mocks.writableScopesFor.mockResolvedValue([
      { organizationId: ORG_A, collectionKey: 'course-a', programId: 'p1', displayName: 'Course A' },
      { organizationId: ORG_B, collectionKey: 'course-b', programId: 'p2', displayName: 'Course B' },
    ]);
    const scope = await resolveAdminScope(session('course_lead', 'l1'));
    expect(scope.kind).toBe('none');
    expect((scope as { reason: string }).reason).toBe('ambiguous_org_course_lead');
  });

  it('all five reason strings are pairwise distinct', () => {
    const reasons: AdminScopeNoneReason[] = [
      'no_caseload',
      'no_profile',
      'no_membership',
      'ambiguous_org_mentor',
      'ambiguous_org_course_lead',
    ];
    expect(new Set(reasons).size).toBe(reasons.length);
  });
});

describe('resolveAdminScope — socio', () => {
  it('gives a socio session no admin scope', async () => {
    const scope = await resolveAdminScope(session('socio', 'socio-1'));
    expect(scope).toEqual({ kind: 'none', actorId: 'socio-1', reason: 'no_membership' });
  });
});

describe('resolveAdminScope — adversarial: two mentors, same org, same course, disjoint caseloads', () => {
  it('each resolves to a scope excluding the other mentor\'s learners', async () => {
    // Both mentors teach in ORG_A, both have learners enrolled in
    // "course-a" — a flat { organizationId, collectionKeys } scope would
    // make these two indistinguishable, which is exactly the bug the
    // socioIds-as-primary-constraint design exists to prevent.
    mocks.mentorCaseloadScope.mockImplementation(async (mentorId: string) => {
      if (mentorId === 'mentor-a') {
        return { status: 'ok', organizationId: ORG_A, socioIds: ['socio-1', 'socio-2'], collectionKeys: ['course-a'] };
      }
      if (mentorId === 'mentor-b') {
        return { status: 'ok', organizationId: ORG_A, socioIds: ['socio-3', 'socio-4'], collectionKeys: ['course-a'] };
      }
      throw new Error(`unscripted mentorId ${mentorId}`);
    });

    const scopeA = await resolveAdminScope(session('mentor', 'mentor-a'));
    const scopeB = await resolveAdminScope(session('mentor', 'mentor-b'));

    expect(scopeA.kind).toBe('mentor');
    expect(scopeB.kind).toBe('mentor');
    // Same org, same derived course list — the part a flat object would
    // have collapsed into an identical scope.
    expect((scopeA as { organizationId: string }).organizationId).toBe((scopeB as { organizationId: string }).organizationId);
    expect((scopeA as { collectionKeys: string[] }).collectionKeys).toEqual((scopeB as { collectionKeys: string[] }).collectionKeys);

    const socioIdsA = (scopeA as { socioIds: string[] }).socioIds;
    const socioIdsB = (scopeB as { socioIds: string[] }).socioIds;
    // The actual scope: no overlap between the two caseloads.
    expect(socioIdsA.some((id) => socioIdsB.includes(id))).toBe(false);
    expect(socioIdsA).toEqual(['socio-1', 'socio-2']);
    expect(socioIdsB).toEqual(['socio-3', 'socio-4']);
  });
});
