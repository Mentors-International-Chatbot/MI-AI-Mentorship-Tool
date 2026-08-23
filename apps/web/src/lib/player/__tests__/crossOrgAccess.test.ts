import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestIdentity } from "@/lib/auth/requestIdentity";
import { PlayerError } from "../service";

/**
 * A learner who joins AIESS from outside its organization via open enrollment
 * gets anchored into AIESS's own org (see selectPublishedPlayerVersion). This
 * proves that anchor grants nothing beyond AIESS: a request for a course owned
 * by a different organization (mentors-international) is refused the same way
 * it would be for any other unenrolled learner.
 *
 * A.5 (Platform Restructure Phase A, Stage 5): resolvePlayerAccess now checks
 * Enrollment FIRST (closes G2) instead of gating on curriculumCollectionKey
 * before ever querying it. The refusal below is no longer "the mismatch is
 * caught before any enrollment lookup runs" — the enrollment lookup itself is
 * what refuses, because its `where` clause is scoped to the REQUESTED
 * collectionKey (`programVersion.collection.slug`), and this learner's only
 * enrollment is for ai-essentials. The mock below simulates that scoping
 * explicitly (a real Prisma `where` clause enforces it; a naive
 * mockResolvedValue that ignores its arguments would not, and used to hide
 * that this test never actually exercised the enrollment query at all before
 * the gate flip).
 */

const mocks = vi.hoisted(() => ({
  socioFindUnique: vi.fn(),
  enrollmentFindFirst: vi.fn(),
  ltiContextFindUnique: vi.fn(),
}));

vi.mock("@/lib/repo/playerRuntimeRepo", () => ({
  playerRuntimeRepo: {
    socio: { findUnique: mocks.socioFindUnique },
    enrollment: { findFirst: mocks.enrollmentFindFirst },
    ltiContext: { findUnique: mocks.ltiContextFindUnique },
  },
}));

vi.mock("@/lib/journey-package/delivery", () => ({
  resolveDelivery: vi.fn(() => ({ surface: "player", supportedChannels: ["web", "canvas"] })),
}));

import { resolvePlayerAccess } from "../service";

const aiessOrgId = "aiess-org";

const aiessProgramVersion = {
  id: "aiess-version-1",
  version: "1",
  status: "published",
  config: {},
  metadata: {},
  collection: { slug: "ai-essentials" },
  program: { organizationId: aiessOrgId },
};

const crossJoinedIdentity: RequestIdentity = {
  userId: "learner-cross",
  externalId: "external-cross",
  role: "socio",
  name: "Cross-org learner",
  socioId: "learner-cross",
  channel: "web",
};

// A learner who was unanchored, joined AIESS through open enrollment, and was
// anchored into AIESS's org as a result (curriculumCollectionKey mirrors what
// the join route writes before anchoring).
const crossJoinedSocio = {
  id: "learner-cross",
  curriculumCollectionKey: "ai-essentials",
  participantProfile: {
    id: "participant-cross",
    organizationId: aiessOrgId,
    enrollments: [
      { id: "aiess-enrollment", cohortId: "direct-web-cohort", programVersionId: aiessProgramVersion.id, status: "active" },
    ],
  },
};

describe("resolvePlayerAccess does not leak across organizations after a cross-org join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.socioFindUnique.mockResolvedValue(crossJoinedSocio);
    // Simulates a real Prisma `where` clause: the socio's only enrollment
    // resolves ONLY when queried for ai-essentials, matching how
    // resolvePlayerAccess actually scopes the lookup
    // (programVersion.collection.slug: collectionKey). Any other requested
    // collectionKey correctly finds nothing, same as a real cross-collection
    // query would.
    mocks.enrollmentFindFirst.mockImplementation(async (args: { where: { programVersion: { collection: { slug: string } } } }) => {
      const requestedCollectionKey = args.where.programVersion.collection.slug;
      return requestedCollectionKey === "ai-essentials"
        ? { id: "aiess-enrollment", programVersion: aiessProgramVersion }
        : null;
    });
  });

  it("grants access to AIESS itself", async () => {
    const access = await resolvePlayerAccess(crossJoinedIdentity, "AIESS");

    expect(access.organizationId).toBe(aiessOrgId);
    expect(access.collectionKey).toBe("ai-essentials");
  });

  it("refuses a course owned by a different organization (MI2024)", async () => {
    await expect(resolvePlayerAccess(crossJoinedIdentity, "MI2024")).rejects.toMatchObject({
      status: 403,
      code: "not_enrolled",
    } satisfies Partial<PlayerError>);

    // A.5: the enrollment lookup IS what refuses now — it runs (scoped to
    // mi-colombia-curriculum) and correctly finds nothing, rather than being
    // skipped by a pre-check. Never reaches MI2024's programVersion because
    // there is no matching enrollment row, not because a gate short-circuited.
    expect(mocks.enrollmentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          programVersion: expect.objectContaining({ collection: { slug: "mi-colombia-curriculum" } }),
        }),
      }),
    );
  });

  it("refuses a course owned by a different organization (SKILLS)", async () => {
    await expect(resolvePlayerAccess(crossJoinedIdentity, "SKILLS")).rejects.toMatchObject({
      status: 403,
      code: "not_enrolled",
    } satisfies Partial<PlayerError>);

    expect(mocks.enrollmentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          programVersion: expect.objectContaining({ collection: { slug: "skills-tool-calls" } }),
        }),
      }),
    );
  });
});
