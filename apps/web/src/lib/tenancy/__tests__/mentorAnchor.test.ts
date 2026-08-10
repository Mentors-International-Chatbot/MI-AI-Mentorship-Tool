/**
 * Mentor tenancy anchoring
 * ═══════════════════════════════════════════════════════════════════════════
 * The rule under test: write the profile at the first moment a real org signal
 * exists, never before.
 *
 * Most of these cases exist because every failure here is silent. An unanchored
 * mentor sees an empty roster; a *wrongly* anchored one sees someone else's
 * tenant. Neither throws, and neither shows an error, so the decision is pinned
 * directly rather than inferred from behaviour.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/repo/tenantPrismaRepo', () => ({
  tenantPrismaRepo: {
    getMentorAnchorInputs: vi.fn(),
    getOrganizationIdByMentorId: vi.fn(),
    createMentorProfile: vi.fn(),
  },
}));

vi.mock('@/lib/logging/logger', () => ({ logEvent: vi.fn(async () => {}) }));

vi.mock('@/lib/repo/tenantContext', () => ({
  createTenantContext: (organizationId: string) => ({ organizationId }),
}));

import { tenantPrismaRepo } from '@/lib/repo/tenantPrismaRepo';
import { logEvent } from '@/lib/logging/logger';
import { resolveMentorOrg, anchorMentorProfile } from '../mentorAnchor';

const repo = tenantPrismaRepo as unknown as {
  getMentorAnchorInputs: ReturnType<typeof vi.fn>;
  getOrganizationIdByMentorId: ReturnType<typeof vi.fn>;
  createMentorProfile: ReturnType<typeof vi.fn>;
};
const mockLog = logEvent as unknown as ReturnType<typeof vi.fn>;

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const IDENTITY = { name: 'Verify Mentor A', email: 'a@example.com', role: 'mentor' };

function inputs(over: Partial<{
  identity: typeof IDENTITY | null;
  memberships: { organizationId: string; role: string }[];
  assignedSocioCount: number;
  assignedSocioOrganizationIds: string[];
}> = {}) {
  return {
    identity: IDENTITY,
    memberships: [],
    assignedSocioCount: 0,
    assignedSocioOrganizationIds: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.getOrganizationIdByMentorId.mockResolvedValue(null);
  repo.createMentorProfile.mockResolvedValue({});
  repo.getMentorAnchorInputs.mockResolvedValue(inputs());
});

describe('resolveMentorOrg', () => {
  it('lets an explicit org outrank everything, without querying', async () => {
    // The creating admin's org is a deliberate act by an authorized human in a
    // known tenant — stronger evidence than anything inferable from data.
    const r = await resolveMentorOrg('m1', ORG_A);
    expect(r).toEqual({
      kind: 'resolved',
      signal: 'creating_admin',
      organizationId: ORG_A,
      detail: 'org of the admin performing the create',
    });
    expect(repo.getMentorAnchorInputs).not.toHaveBeenCalled();
  });

  it('ignores an empty explicit org and falls through', async () => {
    repo.getMentorAnchorInputs.mockResolvedValue(
      inputs({ memberships: [{ organizationId: ORG_A, role: 'member' }] }),
    );
    const r = await resolveMentorOrg('m1', null);
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.signal).toBe('membership');
  });

  it('resolves from a single membership', async () => {
    repo.getMentorAnchorInputs.mockResolvedValue(
      inputs({ memberships: [{ organizationId: ORG_A, role: 'owner' }] }),
    );
    const r = await resolveMentorOrg('m1');
    expect(r).toMatchObject({ kind: 'resolved', signal: 'membership', organizationId: ORG_A });
  });

  it('refuses when memberships span more than one org', async () => {
    repo.getMentorAnchorInputs.mockResolvedValue(
      inputs({
        memberships: [
          { organizationId: ORG_A, role: 'member' },
          { organizationId: ORG_B, role: 'member' },
        ],
      }),
    );
    const r = await resolveMentorOrg('m1');
    expect(r.kind).toBe('ambiguous');
  });

  it('resolves from assigned socios when they all share one org', async () => {
    repo.getMentorAnchorInputs.mockResolvedValue(
      inputs({ assignedSocioCount: 2, assignedSocioOrganizationIds: [ORG_A] }),
    );
    const r = await resolveMentorOrg('m1');
    expect(r).toMatchObject({ kind: 'resolved', signal: 'assigned_socios', organizationId: ORG_A });
  });

  it('refuses when assigned socios span more than one org', async () => {
    // Picking one would silently hide the rest of their caseload — the bug
    // being fixed, inverted.
    repo.getMentorAnchorInputs.mockResolvedValue(
      inputs({ assignedSocioCount: 3, assignedSocioOrganizationIds: [ORG_A, ORG_B] }),
    );
    const r = await resolveMentorOrg('m1');
    expect(r.kind).toBe('ambiguous');
  });

  it('reports no signal for a mentor with no socios and no memberships', async () => {
    const r = await resolveMentorOrg('m1');
    expect(r).toMatchObject({ kind: 'no_signal' });
  });

  it('reports no signal when socios exist but none is anchored yet', async () => {
    // Anchoring chains: this mentor becomes resolvable once their socios are.
    // Distinct from "no socios" and the message says so.
    repo.getMentorAnchorInputs.mockResolvedValue(
      inputs({ assignedSocioCount: 2, assignedSocioOrganizationIds: [] }),
    );
    const r = await resolveMentorOrg('m1');
    expect(r.kind).toBe('no_signal');
    expect(r.detail).toMatch(/none anchored/i);
  });

  it('never resolves to a default org — there is no tier 3 for mentors', async () => {
    // The socio chain has DEFAULT_ORGANIZATION_ID as a last resort. This one
    // deliberately does not: reads short-circuit on the profile, so a guessed
    // anchor is permanent and silently authoritative.
    process.env.DEFAULT_ORGANIZATION_ID = 'default-org';
    const r = await resolveMentorOrg('m1');
    expect(r.kind).toBe('no_signal');
    delete process.env.DEFAULT_ORGANIZATION_ID;
  });
});

describe('anchorMentorProfile', () => {
  it('creates the profile when an org resolves', async () => {
    repo.getMentorAnchorInputs.mockResolvedValue(
      inputs({ assignedSocioCount: 1, assignedSocioOrganizationIds: [ORG_A] }),
    );

    const outcome = await anchorMentorProfile({ mentorId: 'm1', trigger: 'admin_assign_socio' });

    expect(outcome).toBe('created');
    expect(repo.createMentorProfile).toHaveBeenCalledWith(
      { organizationId: ORG_A },
      expect.objectContaining({
        mentorId: 'm1',
        displayName: 'Verify Mentor A',
        metadata: expect.objectContaining({
          anchoredBy: 'admin_assign_socio',
          orgResolutionSignal: 'assigned_socios',
        }),
      }),
    );
  });

  it('is a no-op when the mentor is already anchored', async () => {
    repo.getOrganizationIdByMentorId.mockResolvedValue(ORG_A);
    const outcome = await anchorMentorProfile({ mentorId: 'm1', trigger: 't' });
    expect(outcome).toBe('already_anchored');
    expect(repo.createMentorProfile).not.toHaveBeenCalled();
  });

  it('writes nothing when no org signal exists, and says so in the log', async () => {
    const outcome = await anchorMentorProfile({ mentorId: 'm1', trigger: 'admin_create_mentor' });

    expect(outcome).toBe('unresolved');
    expect(repo.createMentorProfile).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith(
      'warn',
      'system',
      expect.stringContaining('not anchored'),
      expect.objectContaining({ mentorId: 'm1', trigger: 'admin_create_mentor' }),
    );
  });

  it('writes nothing when the signal is ambiguous', async () => {
    repo.getMentorAnchorInputs.mockResolvedValue(
      inputs({ assignedSocioCount: 2, assignedSocioOrganizationIds: [ORG_A, ORG_B] }),
    );
    const outcome = await anchorMentorProfile({ mentorId: 'm1', trigger: 't' });
    expect(outcome).toBe('unresolved');
    expect(repo.createMentorProfile).not.toHaveBeenCalled();
  });

  it('returns unresolved for a mentor that does not exist', async () => {
    repo.getMentorAnchorInputs.mockResolvedValue(inputs({ identity: null }));
    const outcome = await anchorMentorProfile({ mentorId: 'ghost', trigger: 't' });
    expect(outcome).toBe('unresolved');
    expect(repo.createMentorProfile).not.toHaveBeenCalled();
  });

  it('never throws when the write fails — the triggering action must survive', async () => {
    // Assigning a socio must succeed even if anchoring cannot. An unanchored
    // mentor is backfillable; a failed assignment is a dead end for the admin.
    repo.getMentorAnchorInputs.mockResolvedValue(
      inputs({ assignedSocioCount: 1, assignedSocioOrganizationIds: [ORG_A] }),
    );
    repo.createMentorProfile.mockRejectedValue(new Error('db down'));

    const outcome = await anchorMentorProfile({ mentorId: 'm1', trigger: 't' });

    expect(outcome).toBe('failed');
    expect(mockLog).toHaveBeenCalledWith(
      'error',
      'system',
      expect.stringContaining('could not anchor'),
      expect.objectContaining({ mentorId: 'm1' }),
    );
  });

  it('never throws even when the log write also fails', async () => {
    // An unreachable database fails the SystemLog write for the same reason it
    // failed the anchor, so this path must not surface either error.
    repo.getMentorAnchorInputs.mockRejectedValue(new Error('db down'));
    mockLog.mockRejectedValue(new Error('db down too'));

    await expect(
      anchorMentorProfile({ mentorId: 'm1', trigger: 't' }),
    ).resolves.toBe('failed');
  });
});
