import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenantIsolationError, createTenantContext } from "../tenantContext";
import type { LearnerProjectStatus, PutLearnerProjectInput } from "../tenantRepo.types";

type Row = {
  id: string;
  organizationId: string;
  enrollmentId: string;
  socioId: string;
  presetKey: string | null;
  title: string | null;
  oneLiner: string | null;
  context: string | null;
  automationLevel: string | null;
  interests: string[];
  status: LearnerProjectStatus;
  lifeContext: string | null;
  reframedAt: Date | null;
  automationValidatedAt: Date | null;
  createdAt: Date;
  confirmedAt: Date | null;
  updatedAt: Date;
};

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  owners: new Map<string, { organizationId: string; socioId: string }>(),
  sequence: 0,
}));

const mockPrisma = vi.hoisted(() => ({
  enrollment: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const owner = state.owners.get(where.id);
      return owner ? {
        participant: { socioId: owner.socioId },
        cohort: { program: { organizationId: owner.organizationId } },
      } : null;
    }),
  },
  learnerProject: {
    findFirst: vi.fn(async ({ where }: { where: { enrollmentId: string; status?: { in: LearnerProjectStatus[] } } }) => {
      const matches = state.rows.filter((row) => row.enrollmentId === where.enrollmentId
        && (!where.status || where.status.in.includes(row.status)));
      return matches.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Partial<Row> & Pick<Row, "organizationId" | "enrollmentId" | "socioId" | "interests" | "status"> }) => {
      const now = new Date(Date.now() + state.sequence);
      const row = {
        presetKey: null, title: null, oneLiner: null, context: null, automationLevel: null,
        lifeContext: null, reframedAt: null, automationValidatedAt: null, confirmedAt: null,
        ...data, id: `project-${++state.sequence}`, createdAt: now, updatedAt: now,
      } as Row;
      state.rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = state.rows.find((item) => item.id === where.id);
      if (!row) throw new Error("missing project");
      Object.assign(row, data, { updatedAt: new Date(row.updatedAt.getTime() + 1) });
      return row;
    }),
  },
  $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import {
  isLearnerProjectStatusTransitionAllowed,
  LearnerProjectTransitionError,
  tenantPrismaRepo,
} from "../tenantPrismaRepo";

const ORG_A = "org-a";
const ORG_B = "org-b";
const ENROLLMENT_A = "enrollment-a";
const ENROLLMENT_A_2 = "enrollment-a-2";
const ENROLLMENT_B = "enrollment-b";
const ctxA = createTenantContext(ORG_A);

function input(overrides: Partial<PutLearnerProjectInput> = {}): PutLearnerProjectInput {
  return {
    presetKey: "morning-brief",
    title: "My morning brief",
    oneLiner: "Schedule and deadlines in one place",
    context: "Five classes and a job",
    automationLevel: "L3",
    interests: ["one", "two", "three", "four", "five"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rows.length = 0;
  state.sequence = 0;
  state.owners.clear();
  state.owners.set(ENROLLMENT_A, { organizationId: ORG_A, socioId: "socio-a" });
  state.owners.set(ENROLLMENT_A_2, { organizationId: ORG_A, socioId: "socio-a" });
  state.owners.set(ENROLLMENT_B, { organizationId: ORG_B, socioId: "socio-b" });
});

describe("LearnerProject tenant isolation", () => {
  it("rejects cross-organization reads before querying projects", async () => {
    await expect(tenantPrismaRepo.getCurrentLearnerProject(ctxA, ENROLLMENT_B)).rejects.toThrow(TenantIsolationError);
    expect(mockPrisma.learnerProject.findFirst).not.toHaveBeenCalled();
  });

  it("rejects cross-organization writes before querying or mutating projects", async () => {
    await expect(tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_B, input())).rejects.toThrow(TenantIsolationError);
    expect(mockPrisma.learnerProject.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.learnerProject.create).not.toHaveBeenCalled();
  });

  it("rejects cross-organization picker writes", async () => {
    await expect(tenantPrismaRepo.saveLearnerProjectInterests(ctxA, ENROLLMENT_B, ["one", "two", "three", "four", "five"]))
      .rejects.toThrow(TenantIsolationError);
    expect(mockPrisma.learnerProject.create).not.toHaveBeenCalled();
  });
});

describe("LearnerProject status transitions", () => {
  it("implements exactly the declared transition matrix", () => {
    const statuses: LearnerProjectStatus[] = ["DRAFT", "ACTIVE", "CHANGED", "ABANDONED"];
    const allowed = new Set([
      "none:DRAFT",
      "DRAFT:DRAFT", "DRAFT:ACTIVE", "DRAFT:ABANDONED",
      "ACTIVE:ACTIVE", "ACTIVE:CHANGED", "ACTIVE:ABANDONED",
      "ABANDONED:DRAFT",
    ]);
    for (const from of [null, ...statuses] as const) {
      for (const to of statuses) {
        expect(isLearnerProjectStatusTransitionAllowed(from, to), `${from ?? "none"}:${to}`)
          .toBe(allowed.has(`${from ?? "none"}:${to}`));
      }
    }
  });

  it("confirms, preserves on switch, and returns a new draft", async () => {
    const draft = await tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input());
    await tenantPrismaRepo.stageLearnerProject(ctxA, ENROLLMENT_A, {
      ...input(), lifeContext: "Five classes and a job", reframed: false,
    });
    const active = await tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input({ status: "ACTIVE" }));
    expect(active.id).toBe(draft.id);
    expect(active.confirmedAt).toBeInstanceOf(Date);

    const replacement = await tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input({
      status: "CHANGED",
      presetKey: "study-guide",
      title: "Study guide",
      automationLevel: "L1",
    }));
    expect(replacement).toMatchObject({ status: "DRAFT", title: "Study guide", confirmedAt: null });
    expect(replacement.id).not.toBe(active.id);
    expect(state.rows.find((row) => row.id === active.id)?.status).toBe("CHANGED");
    expect(state.rows).toHaveLength(2);
  });

  it("requires the automation gate before confirming", async () => {
    await tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input());
    await expect(tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input({ status: "ACTIVE" })))
      .rejects.toThrow("automation gate");
  });

  it("does not let confirmation replace the project that passed the gate", async () => {
    await tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input());
    await tenantPrismaRepo.stageLearnerProject(ctxA, ENROLLMENT_A, {
      ...input(), lifeContext: "Five classes and a job", reframed: false,
    });
    await expect(tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input({
      status: "ACTIVE", presetKey: "study-guide",
    }))).rejects.toThrow("preserve the project");
  });

  it("reopens an abandoned row instead of creating another row", async () => {
    const draft = await tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input());
    await tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input({ status: "ABANDONED" }));
    const reopened = await tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input({ status: "DRAFT", title: "Returned project" }));
    expect(reopened).toMatchObject({ id: draft.id, status: "DRAFT", title: "Returned project", confirmedAt: null });
    expect(state.rows).toHaveLength(1);
  });

  it("rejects an undeclared transition without writing", async () => {
    await tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input());
    await expect(tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input({ status: "CHANGED" })))
      .rejects.toThrow(LearnerProjectTransitionError);
    expect(mockPrisma.learnerProject.update).not.toHaveBeenCalled();
  });
});

describe("LearnerProject enrollment scope", () => {
  it("keeps two projects distinct for one learner's two enrollments", async () => {
    const first = await tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input({ title: "First course project" }));
    const second = await tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A_2, input({ title: "Retake project" }));
    expect(first.enrollmentId).toBe(ENROLLMENT_A);
    expect(second.enrollmentId).toBe(ENROLLMENT_A_2);
    expect(first.id).not.toBe(second.id);
    await expect(tenantPrismaRepo.getCurrentLearnerProject(ctxA, ENROLLMENT_A)).resolves.toMatchObject({ title: "First course project" });
    await expect(tenantPrismaRepo.getCurrentLearnerProject(ctxA, ENROLLMENT_A_2)).resolves.toMatchObject({ title: "Retake project" });
  });
});

describe("LearnerProject setup state", () => {
  it("creates an interest-only draft and persists turn-one life context", async () => {
    const interests = ["one", "two", "three", "four", "five"];
    const draft = await tenantPrismaRepo.saveLearnerProjectInterests(ctxA, ENROLLMENT_A, interests);
    expect(draft).toMatchObject({ status: "DRAFT", interests, presetKey: null, title: null, automationValidatedAt: null });

    const withContext = await tenantPrismaRepo.saveLearnerProjectLifeContext(ctxA, ENROLLMENT_A, "I turn club notes into a weekly update.");
    expect(withContext.lifeContext).toBe("I turn club notes into a weekly update.");
  });

  it("records a passed gate and measurable reframe without inventing a title", async () => {
    const interests = ["one", "two", "three", "four", "five"];
    await tenantPrismaRepo.saveLearnerProjectInterests(ctxA, ENROLLMENT_A, interests);
    await tenantPrismaRepo.saveLearnerProjectLifeContext(ctxA, ENROLLMENT_A, "I rebuild the same club update each week.");
    const staged = await tenantPrismaRepo.stageLearnerProject(ctxA, ENROLLMENT_A, {
      presetKey: "weekly-recap",
      oneLiner: "Form responses become a weekly club update.",
      context: "Student club",
      automationLevel: "L2",
      interests,
      lifeContext: "I rebuild the same club update each week.",
      reframed: true,
    });
    expect(staged).toMatchObject({ title: null, presetKey: "weekly-recap", automationLevel: "L2" });
    expect(staged.automationValidatedAt).toBeInstanceOf(Date);
    expect(staged.reframedAt).toBeInstanceOf(Date);
  });

  it("reopens an abandoned picker draft as the same recoverable row", async () => {
    const interests = ["one", "two", "three", "four", "five"];
    const draft = await tenantPrismaRepo.saveLearnerProjectInterests(ctxA, ENROLLMENT_A, interests);
    await tenantPrismaRepo.putLearnerProject(ctxA, ENROLLMENT_A, input({ status: "ABANDONED" }));
    const reopened = await tenantPrismaRepo.saveLearnerProjectInterests(ctxA, ENROLLMENT_A, interests);
    expect(reopened).toMatchObject({ id: draft.id, status: "DRAFT", interests });
    expect(state.rows).toHaveLength(1);
  });
});
