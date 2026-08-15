import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantContext, TenantIsolationError } from "../tenantContext";
import type { LearnerProjectStatus } from "../tenantRepo.types";

type EnrollmentOwner = {
  organizationId: string;
  socioId: string;
  collectionKey: string;
  enrolledAt: Date;
  grandfatheredAt: Date | null;
};

const state = vi.hoisted(() => ({
  enrollments: new Map<string, EnrollmentOwner>(),
  projects: new Map<string, LearnerProjectStatus[]>(),
  completedAt: [] as Date[],
}));

const mockPrisma = vi.hoisted(() => ({
  enrollment: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const owner = state.enrollments.get(where.id);
      return owner ? {
        enrolledAt: owner.enrolledAt,
        projectSelectionGrandfatheredAt: owner.grandfatheredAt,
        participant: { socioId: owner.socioId },
        cohort: { program: { organizationId: owner.organizationId } },
        programVersion: { collection: { slug: owner.collectionKey } },
      } : null;
    }),
    updateMany: vi.fn(async ({ where, data }: {
      where: { id: string; projectSelectionGrandfatheredAt: null };
      data: { projectSelectionGrandfatheredAt: Date };
    }) => {
      const owner = state.enrollments.get(where.id);
      if (!owner || owner.grandfatheredAt) return { count: 0 };
      owner.grandfatheredAt = data.projectSelectionGrandfatheredAt;
      return { count: 1 };
    }),
  },
  learnerProject: {
    findFirst: vi.fn(async ({ where }: {
      where: { enrollmentId: string; status?: { in: LearnerProjectStatus[] } };
    }) => {
      const statuses = state.projects.get(where.enrollmentId) ?? [];
      const match = where.status ? statuses.find((status) => where.status!.in.includes(status)) : statuses[0];
      return match ? { id: `${where.enrollmentId}-${match}` } : null;
    }),
  },
  blockProgress: {
    findFirst: vi.fn(async ({ where }: {
      where: { completedAt: { gte: Date } };
    }) => state.completedAt.some((completedAt) => completedAt >= where.completedAt.gte) ? { id: "progress-1" } : null),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { tenantPrismaRepo } from "../tenantPrismaRepo";

const ctx = createTenantContext("org-1");
const enrolledAt = new Date("2026-08-01T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  state.enrollments.clear();
  state.projects.clear();
  state.completedAt.length = 0;
  state.enrollments.set("enrollment-1", {
    organizationId: "org-1",
    socioId: "learner-1",
    collectionKey: "ai-essentials",
    enrolledAt,
    grandfatheredAt: null,
  });
});

describe("enrollment-scoped project routing", () => {
  it("rejects a cross-organization gate read before checking progress", async () => {
    await expect(tenantPrismaRepo.learnerProjectSelectionRequired(
      createTenantContext("org-2"), "enrollment-1", "ai-essentials",
    )).rejects.toThrow(TenantIsolationError);
    expect(mockPrisma.learnerProject.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.blockProgress.findFirst).not.toHaveBeenCalled();
  });

  it("does not gate an enrollment with an ACTIVE project", async () => {
    state.projects.set("enrollment-1", ["ACTIVE"]);
    await expect(tenantPrismaRepo.learnerProjectSelectionRequired(ctx, "enrollment-1", "ai-essentials"))
      .resolves.toBe(false);
    expect(mockPrisma.blockProgress.findFirst).not.toHaveBeenCalled();
  });

  it.each(["DRAFT", "ABANDONED", "CHANGED"] as const)("does not grandfather %s project history", async (status) => {
    state.projects.set("enrollment-1", [status]);
    state.completedAt.push(new Date("2026-08-02T00:00:00.000Z"));
    await expect(tenantPrismaRepo.learnerProjectSelectionRequired(ctx, "enrollment-1", "ai-essentials"))
      .resolves.toBe(true);
    expect(mockPrisma.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it("writes the legacy exemption once and then reads only the enrollment decision", async () => {
    state.completedAt.push(new Date("2026-08-02T00:00:00.000Z"));

    await expect(tenantPrismaRepo.learnerProjectSelectionRequired(ctx, "enrollment-1", "ai-essentials"))
      .resolves.toBe(false);
    expect(mockPrisma.enrollment.updateMany).toHaveBeenCalledTimes(1);

    state.completedAt.length = 0;
    await expect(tenantPrismaRepo.learnerProjectSelectionRequired(ctx, "enrollment-1", "ai-essentials"))
      .resolves.toBe(false);
    expect(mockPrisma.enrollment.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.blockProgress.findFirst).toHaveBeenCalledTimes(1);
  });

  it("does not let a later retake inherit collection progress from the earlier enrollment", async () => {
    state.completedAt.push(new Date("2026-08-02T00:00:00.000Z"));
    state.enrollments.set("retake-enrollment", {
      organizationId: "org-1",
      socioId: "learner-1",
      collectionKey: "ai-essentials",
      enrolledAt: new Date("2026-09-01T00:00:00.000Z"),
      grandfatheredAt: null,
    });

    await expect(tenantPrismaRepo.learnerProjectSelectionRequired(ctx, "retake-enrollment", "ai-essentials"))
      .resolves.toBe(true);
    expect(mockPrisma.enrollment.updateMany).not.toHaveBeenCalled();
  });
});
