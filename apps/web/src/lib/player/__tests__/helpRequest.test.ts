/**
 * "Request help from a human" — service behaviour
 * ═══════════════════════════════════════════════════════════════════════════
 * The button tells the learner a person will follow up. Every test here guards
 * one of the ways that sentence could quietly become false: the flag not being
 * written, being written without the context a mentor needs to act on it, or a
 * second press either spawning a duplicate card or being dropped entirely.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SocioFlag } from "@/lib/repo/types";

const mocks = vi.hoisted(() => ({
  createFlag: vi.fn(),
  getActiveFlags: vi.fn(),
  recordFlagOccurrence: vi.fn(),
  getCurrentLearnerProject: vi.fn(),
}));

vi.mock("@/lib/repo", () => ({
  repo: {
    createFlag: mocks.createFlag,
    getActiveFlags: mocks.getActiveFlags,
    recordFlagOccurrence: mocks.recordFlagOccurrence,
  },
}));

vi.mock("@/lib/player/learnerProject", () => ({
  getCurrentLearnerProject: mocks.getCurrentLearnerProject,
}));

import { findOpenHelpRequest, requestHelp } from "@/lib/player/helpRequest";
import { PlayerError } from "@/lib/player/service";
import type { PlayerAccess } from "@/lib/player/service";

const NOW = new Date("2026-08-15T12:00:00Z");

function makeAccess(overrides: Partial<PlayerAccess> = {}): PlayerAccess {
  return {
    socioId: "socio-a",
    collectionKey: "ai-essentials",
    organizationId: "org-a",
    programVersionId: "pv-a",
    programVersion: "2.0",
    enrollmentId: "enrollment-a",
    config: { helpRequest: { enabled: true, maxMessageLength: 1000 } },
    ...overrides,
  } as PlayerAccess;
}

function makeFlag(overrides: Partial<SocioFlag> = {}): SocioFlag {
  return {
    id: "flag-1",
    socioId: "socio-a",
    level: "RED",
    reason: "Learner requested human help",
    source: "learner_request",
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    messageId: null,
    createdAt: NOW,
    reasonCode: "help.requested",
    reasonParams: { collectionKey: "ai-essentials" },
    status: "OPEN",
    disposition: null,
    snoozedUntil: null,
    occurrenceCount: 1,
    lastOccurredAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveFlags.mockResolvedValue([]);
  mocks.getCurrentLearnerProject.mockResolvedValue(null);
  mocks.createFlag.mockImplementation(async (data) => makeFlag({ ...data, id: "flag-new" }));
  mocks.recordFlagOccurrence.mockImplementation(async (id: string) =>
    makeFlag({ id, occurrenceCount: 2, lastOccurredAt: NOW }),
  );
});

describe("findOpenHelpRequest", () => {
  it("matches only a help request for the same course", () => {
    const mine = makeFlag({ id: "mine" });
    const otherCourse = makeFlag({
      id: "other",
      reasonParams: { collectionKey: "pbj-basics" },
    });

    expect(findOpenHelpRequest([otherCourse, mine], "ai-essentials")?.id).toBe("mine");
    expect(findOpenHelpRequest([otherCourse], "ai-essentials")).toBeNull();
  });

  it("ignores inferred flags entirely", () => {
    const sentiment = makeFlag({
      id: "sentiment",
      reasonCode: "sentiment.urgency_high",
      source: "sentiment_auto",
      reasonParams: { collectionKey: "ai-essentials" },
    });
    expect(findOpenHelpRequest([sentiment], "ai-essentials")).toBeNull();
  });

  it("does not let a legacy row with no course block a new request", () => {
    const legacy = makeFlag({ id: "legacy", reasonParams: null });
    expect(findOpenHelpRequest([legacy], "ai-essentials")).toBeNull();
  });
});

describe("requestHelp — creating the flag", () => {
  it("writes a learner-initiated flag carrying course, lesson, block and project", async () => {
    mocks.getCurrentLearnerProject.mockResolvedValue({ title: "Morning brief" });

    const result = await requestHelp(
      makeAccess(),
      { message: "I am stuck on the harness lesson", lessonKey: "ai-harness-control", blockId: "block-7" },
      NOW,
    );

    expect(result.status).toBe("created");
    expect(mocks.createFlag).toHaveBeenCalledTimes(1);
    expect(mocks.createFlag).toHaveBeenCalledWith(
      expect.objectContaining({
        socioId: "socio-a",
        level: "RED",
        source: "learner_request",
        reasonCode: "help.requested",
        reasonParams: {
          collectionKey: "ai-essentials",
          requestReason: "I am stuck on the harness lesson",
          lessonKey: "ai-harness-control",
          blockId: "block-7",
          projectTitle: "Morning brief",
        },
      }),
    );
  });

  it("accepts a request with no message at all", async () => {
    const result = await requestHelp(makeAccess(), {}, NOW);

    expect(result.status).toBe("created");
    expect(mocks.createFlag).toHaveBeenCalledWith(
      expect.objectContaining({ reasonParams: { collectionKey: "ai-essentials" } }),
    );
  });

  it("treats a whitespace-only message as no message", async () => {
    await requestHelp(makeAccess(), { message: "   " }, NOW);

    const params = mocks.createFlag.mock.calls[0][0].reasonParams;
    expect(params.requestReason).toBeUndefined();
  });

  it("truncates a message to the course's configured cap", async () => {
    const access = makeAccess({
      config: { helpRequest: { enabled: true, maxMessageLength: 10 } },
    } as Partial<PlayerAccess>);

    await requestHelp(access, { message: "a".repeat(50) }, NOW);

    expect(mocks.createFlag.mock.calls[0][0].reasonParams.requestReason).toBe("a".repeat(10));
  });

  it("still records the request when the project lookup fails", async () => {
    mocks.getCurrentLearnerProject.mockRejectedValue(new Error("db down"));

    const result = await requestHelp(makeAccess(), { message: "help" }, NOW);

    expect(result.status).toBe("created");
    expect(mocks.createFlag.mock.calls[0][0].reasonParams.projectTitle).toBeUndefined();
  });
});

describe("requestHelp — repeat presses do not duplicate", () => {
  it("bumps the open flag instead of creating a second one", async () => {
    mocks.getActiveFlags.mockResolvedValue([makeFlag({ id: "flag-open" })]);

    const result = await requestHelp(makeAccess(), { message: "still stuck" }, NOW);

    expect(result).toEqual({ status: "already_open", flagId: "flag-open", occurrenceCount: 2 });
    expect(mocks.createFlag).not.toHaveBeenCalled();
    expect(mocks.recordFlagOccurrence).toHaveBeenCalledWith("flag-open", NOW);
  });

  it("creates exactly one flag across ten consecutive presses", async () => {
    const created: SocioFlag[] = [];
    mocks.getActiveFlags.mockImplementation(async () => [...created]);
    mocks.createFlag.mockImplementation(async (data) => {
      const flag = makeFlag({ ...data, id: `flag-${created.length}` });
      created.push(flag);
      return flag;
    });

    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(await requestHelp(makeAccess(), { message: `press ${i}` }, NOW));
    }

    expect(mocks.createFlag).toHaveBeenCalledTimes(1);
    expect(results[0].status).toBe("created");
    expect(results.slice(1).every((r) => r.status === "already_open")).toBe(true);
    expect(mocks.recordFlagOccurrence).toHaveBeenCalledTimes(9);
  });

  it("lets a learner open a fresh request in a different course", async () => {
    mocks.getActiveFlags.mockResolvedValue([
      makeFlag({ id: "aiess-open", reasonParams: { collectionKey: "ai-essentials" } }),
    ]);

    const result = await requestHelp(
      makeAccess({ collectionKey: "pbj-basics" }),
      {},
      NOW,
    );

    expect(result.status).toBe("created");
    expect(mocks.createFlag.mock.calls[0][0].reasonParams.collectionKey).toBe("pbj-basics");
  });

  it("lets a learner ask again once the previous request is resolved", async () => {
    // `getActiveFlags` has already applied `activeFlagWhere`, so a resolved
    // request simply is not in the list the dedup reads.
    mocks.getActiveFlags.mockResolvedValue([]);

    const result = await requestHelp(makeAccess(), {}, NOW);
    expect(result.status).toBe("created");
  });
});

describe("requestHelp — tenant and course scoping", () => {
  it("reads and writes flags only for the resolved learner", async () => {
    await requestHelp(makeAccess({ socioId: "socio-b" }), {}, NOW);

    expect(mocks.getActiveFlags).toHaveBeenCalledWith("socio-b");
    expect(mocks.createFlag.mock.calls[0][0].socioId).toBe("socio-b");
  });

  it("never takes the course from anything but the resolved access", async () => {
    // The body has no course field at all; this is the guard that it stays that
    // way, because a learner-supplied course would write into another tenant.
    await requestHelp(makeAccess({ collectionKey: "ai-essentials" }), {
      // @ts-expect-error deliberately passing a field the schema does not allow
      collectionKey: "mi-colombia-curriculum",
    }, NOW);

    expect(mocks.createFlag.mock.calls[0][0].reasonParams.collectionKey).toBe("ai-essentials");
  });
});

describe("requestHelp — courses that have not enabled it", () => {
  it("refuses when the course has no helpRequest config (MI, PB&J)", async () => {
    await expect(requestHelp(makeAccess({ config: {} } as Partial<PlayerAccess>), {}, NOW))
      .rejects.toThrow(PlayerError);
    expect(mocks.createFlag).not.toHaveBeenCalled();
  });

  it("refuses when the course explicitly disables it", async () => {
    const access = makeAccess({
      config: { helpRequest: { enabled: false, maxMessageLength: 1000 } },
    } as Partial<PlayerAccess>);

    await expect(requestHelp(access, {}, NOW)).rejects.toMatchObject({
      status: 404,
      code: "help_request_not_configured",
    });
    expect(mocks.createFlag).not.toHaveBeenCalled();
  });

  it("refuses before reading any flags, so a disabled course costs nothing", async () => {
    await expect(requestHelp(makeAccess({ config: {} } as Partial<PlayerAccess>), {}, NOW))
      .rejects.toThrow();
    expect(mocks.getActiveFlags).not.toHaveBeenCalled();
  });
});
