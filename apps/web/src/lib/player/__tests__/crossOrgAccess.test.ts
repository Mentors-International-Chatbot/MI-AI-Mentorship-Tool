import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestIdentity } from "@/lib/auth/requestIdentity";
import { PlayerError } from "../service";

/**
 * A learner who joins AIESS from outside its organization via open enrollment
 * gets anchored into AIESS's own org (see selectPublishedPlayerVersion). This
 * proves that anchor grants nothing beyond AIESS: a request for a course owned
 * by a different organization (mentors-international) is refused the same way
 * it would be for any other unenrolled learner, with no organizationId check
 * ever coming into it — `resolvePlayerAccess` never even reaches the
 * mentors-international programVersion because the socio's curriculum key
 * does not match.
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
  });

  it("grants access to AIESS itself", async () => {
    mocks.enrollmentFindFirst.mockResolvedValue({ id: "aiess-enrollment", programVersion: aiessProgramVersion });

    const access = await resolvePlayerAccess(crossJoinedIdentity, "AIESS");

    expect(access.organizationId).toBe(aiessOrgId);
    expect(access.collectionKey).toBe("ai-essentials");
  });

  it("refuses a course owned by a different organization (MI2024), never reaching its programVersion", async () => {
    await expect(resolvePlayerAccess(crossJoinedIdentity, "MI2024")).rejects.toMatchObject({
      status: 403,
      code: "not_enrolled",
    } satisfies Partial<PlayerError>);

    // The mismatch is caught by curriculumCollectionKey before any enrollment
    // lookup runs, so MI2024's programVersion is never even queried.
    expect(mocks.enrollmentFindFirst).not.toHaveBeenCalled();
  });

  it("refuses a course owned by a different organization (SKILLS), never reaching its programVersion", async () => {
    await expect(resolvePlayerAccess(crossJoinedIdentity, "SKILLS")).rejects.toMatchObject({
      status: 403,
      code: "not_enrolled",
    } satisfies Partial<PlayerError>);
    expect(mocks.enrollmentFindFirst).not.toHaveBeenCalled();
  });
});
