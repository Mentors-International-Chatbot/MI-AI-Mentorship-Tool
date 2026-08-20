import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeMessageRow = {
  id: string;
  socioId: string;
  role: string;
  content: string;
  senderType: string | null;
  assessmentSessionId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

let messages: FakeMessageRow[] = [];

vi.mock("@/lib/db", () => ({
  prisma: {
    message: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: FakeMessageRow = {
          id: `msg-${messages.length + 1}`,
          socioId: data.socioId as string,
          role: data.role as string,
          content: data.content as string,
          senderType: (data.senderType as string) ?? null,
          assessmentSessionId: (data.assessmentSessionId as string) ?? null,
          metadata: (data.metadata as Record<string, unknown>) ?? null,
          createdAt: new Date(Date.UTC(2026, 7, 20, 12, messages.length)),
        };
        messages.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where }: { where: { socioId: string } }) => messages
        .filter((row) => row.socioId === where.socioId)
        .filter((row) => row.senderType === "mentor")
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())),
    },
  },
}));

const { repo } = await import("@/lib/repo");
const { getLessonThread } = await import("../service");

const access = {
  socioId: "socio-1",
  collectionKey: "skills-tool-calls",
} as Parameters<typeof getLessonThread>[0];

beforeEach(() => {
  messages = [];
  vi.clearAllMocks();
});

describe("canonical mentor DM reaches the player thread", () => {
  it("reads a metadata-free mentor row in any lesson for the learner", async () => {
    await repo.addMessage({
      socioId: "socio-1",
      role: "mentor",
      content: "Great question — here is how to think about it.",
      senderType: "mentor",
    });

    const thread = await getLessonThread(access, "lesson-with-no-message-metadata");

    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({
      role: "mentor",
      senderType: "mentor",
      metadata: null,
      content: "Great question — here is how to think about it.",
    });
  });

  it("never returns another learner's mentor row", async () => {
    await repo.addMessage({
      socioId: "socio-2",
      role: "mentor",
      content: "Private to somebody else",
      senderType: "mentor",
    });

    expect(await getLessonThread(access, "lesson-1")).toEqual([]);
  });
});
