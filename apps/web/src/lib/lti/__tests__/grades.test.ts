/**
 * queueMilestoneGrade — the config-driven fix ahead of E.1.
 * ----------------------------------------------------------------------------
 * Previously hardcoded ">5"/"5" as "this course has exactly 5 milestones,"
 * true only because AI Essentials Aug 2026 was the only course that had ever
 * driven this pipeline. These pin that the total now comes from the course's
 * own outcome.milestones (resolveCourseMilestones), not a bare constant, and
 * that a course with no milestones declared is a safe no-op, not a
 * divide-by-zero.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ltiIdentityFindFirst: vi.fn(),
  milestoneProgressCount: vi.fn(),
  ltiGradeDeliveryUpsert: vi.fn(),
  resolveCourseMilestones: vi.fn(),
}));

vi.mock("@/lib/repo/ltiRuntimeRepo", () => ({
  ltiRuntimeRepo: {
    ltiIdentity: { findFirst: mocks.ltiIdentityFindFirst },
    milestoneProgress: { count: mocks.milestoneProgressCount },
    ltiGradeDelivery: { upsert: mocks.ltiGradeDeliveryUpsert },
  },
}));

vi.mock("@/lib/ai/prompts/courseOutcome", () => ({
  resolveCourseMilestones: mocks.resolveCourseMilestones,
}));

import { queueMilestoneGrade } from "../grades";

function identityWithResourceLink(overrides: Record<string, unknown> = {}) {
  return {
    enrollments: [
      {
        role: "learner",
        context: {
          programVersion: { collection: { slug: "ai-essentials", organizationId: "org-a" } },
          resourceLinks: [{ id: "link-1", resourceType: "capstone", lineItemUrl: "https://canvas.example/line_items/1" }],
        },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ltiIdentityFindFirst.mockResolvedValue(identityWithResourceLink());
  mocks.ltiGradeDeliveryUpsert.mockResolvedValue({});
});

describe("queueMilestoneGrade — config-driven total", () => {
  it("uses outcome.milestones.length as the total, not a hardcoded 5", async () => {
    mocks.resolveCourseMilestones.mockResolvedValue([{ key: "m1" }, { key: "m2" }, { key: "m3" }]);
    mocks.milestoneProgressCount.mockResolvedValue(3);

    await queueMilestoneGrade("socio-a", "ai-essentials");

    expect(mocks.resolveCourseMilestones).toHaveBeenCalledWith({ organizationId: "org-a", collectionKey: "ai-essentials" });
    expect(mocks.ltiGradeDeliveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ milestoneCount: 3, milestoneTotal: 3, scoreGiven: 100 }),
    }));
  });

  it("does not complete a 3-milestone course's grade at count=3 against a different course's total of 5", async () => {
    // Regression guard for the exact bug the hardcode would have caused:
    // a 3-milestone course reaching its own maximum must score 100, not 60.
    mocks.resolveCourseMilestones.mockResolvedValue([{ key: "m1" }, { key: "m2" }, { key: "m3" }]);
    mocks.milestoneProgressCount.mockResolvedValue(3);

    await queueMilestoneGrade("socio-a", "ai-essentials");

    const call = mocks.ltiGradeDeliveryUpsert.mock.calls[0][0];
    expect(call.create.scoreGiven).toBe(100);
    expect(call.create.scoreGiven).not.toBe(60);
  });

  it("still computes the 20-point increments for a real 5-milestone course", async () => {
    mocks.resolveCourseMilestones.mockResolvedValue([{ key: "m1" }, { key: "m2" }, { key: "m3" }, { key: "m4" }, { key: "m5" }]);
    mocks.milestoneProgressCount.mockResolvedValue(2);

    await queueMilestoneGrade("socio-a", "ai-essentials");

    expect(mocks.ltiGradeDeliveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ milestoneCount: 2, milestoneTotal: 5, scoreGiven: 40 }),
    }));
  });

  it("is a no-op, not a divide-by-zero, for a course with no declared milestones", async () => {
    mocks.resolveCourseMilestones.mockResolvedValue([]);
    mocks.milestoneProgressCount.mockResolvedValue(1);

    await queueMilestoneGrade("socio-a", "ai-essentials");

    expect(mocks.ltiGradeDeliveryUpsert).not.toHaveBeenCalled();
  });

  it("is a no-op once count exceeds this course's own total", async () => {
    mocks.resolveCourseMilestones.mockResolvedValue([{ key: "m1" }, { key: "m2" }, { key: "m3" }]);
    mocks.milestoneProgressCount.mockResolvedValue(4);

    await queueMilestoneGrade("socio-a", "ai-essentials");

    expect(mocks.ltiGradeDeliveryUpsert).not.toHaveBeenCalled();
  });

  it("is a no-op with no matching Canvas resourceLink, same as before", async () => {
    mocks.ltiIdentityFindFirst.mockResolvedValue(identityWithResourceLink({
      enrollments: [{ role: "learner", context: { programVersion: { collection: { slug: "ai-essentials", organizationId: "org-a" } }, resourceLinks: [] } }],
    }));

    await queueMilestoneGrade("socio-a", "ai-essentials");

    expect(mocks.resolveCourseMilestones).not.toHaveBeenCalled();
    expect(mocks.ltiGradeDeliveryUpsert).not.toHaveBeenCalled();
  });
});
