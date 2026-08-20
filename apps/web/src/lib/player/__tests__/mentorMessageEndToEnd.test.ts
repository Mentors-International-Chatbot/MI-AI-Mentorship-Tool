import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End to end: a mentor's message actually reaches a player learner's thread
 * ═══════════════════════════════════════════════════════════════════════════
 * The bug this guards: `/api/dashboard/socios/[id]/message` wrote a row with
 * no metadata, `getLessonThread` requires `surface`/`collectionKey`/
 * `lessonKey` metadata to find one, and nothing in between ever errored — the
 * write succeeded, the API returned 200, and the row rendered nowhere.
 *
 * This test exercises the real, unmocked write path
 * (`resolveMentorMessageMetadata` + `repo.addMessage`) against the real,
 * unmocked read path (`getLessonThread`), sharing one fake Prisma client so a
 * mismatch between what the write stamps and what the read filters on would
 * fail here exactly as it would against a real database — a plain unit test
 * mocking `getLessonThread` itself could not catch that class of bug, because
 * it would be asserting the mock agrees with itself.
 *
 * A second scenario proves the companion claim: MI's takeover is unchanged.
 * MI messages are written with no metadata today and must still be, even
 * though (per `resolveMentorMessageMetadata.test.ts`) MI socios carry a real
 * `curriculumCollectionKey` — so the row must not become visible to a query
 * shaped like `getLessonThread`'s.
 * ═══════════════════════════════════════════════════════════════════════════
 */

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
let nextId = 0;
let programVersions: Array<{ collectionSlug: string; organizationId: string; status: string; metadata: unknown; publishedAt: Date }> = [];
let blockProgressRows: Array<{ socioId: string; collectionKey: string; lessonKey: string; updatedAt: Date }> = [];
let contentLessons: Array<{ collectionSlug: string; organizationId: string; slug: string; orderIndex: number }> = [];

function getAtPath(obj: unknown, path: string[]): unknown {
  let value = obj;
  for (const key of path) {
    if (value == null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

vi.mock("@/lib/db", () => ({
  prisma: {
    message: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: FakeMessageRow = {
          id: `msg-${++nextId}`,
          socioId: data.socioId as string,
          role: data.role as string,
          content: data.content as string,
          senderType: (data.senderType as string) ?? null,
          assessmentSessionId: (data.assessmentSessionId as string) ?? null,
          metadata: (data.metadata as Record<string, unknown>) ?? null,
          createdAt: new Date(),
        };
        messages.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return messages
          .filter((row) => {
            if (where.socioId !== undefined && row.socioId !== where.socioId) return false;
            if ("assessmentSessionId" in where && row.assessmentSessionId !== where.assessmentSessionId) return false;
            const and = where.AND as Array<{ metadata: { path: string[]; equals: unknown } }> | undefined;
            if (and && !and.every((cond) => getAtPath(row.metadata, cond.metadata.path) === cond.metadata.equals)) {
              return false;
            }
            const not = where.NOT as { metadata: { path: string[]; equals: unknown } } | undefined;
            if (not && getAtPath(row.metadata, not.metadata.path) === not.metadata.equals) return false;
            return true;
          })
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
    },
    programVersion: {
      findFirst: vi.fn(async ({ where }: { where: { status: { in: string[] }; collection: { slug: string; organizationId: string } } }) => {
        const match = programVersions
          .filter((pv) =>
            where.status.in.includes(pv.status)
            && pv.collectionSlug === where.collection.slug
            && pv.organizationId === where.collection.organizationId)
          .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())[0];
        return match ? { metadata: match.metadata } : null;
      }),
    },
    blockProgress: {
      findFirst: vi.fn(async ({ where }: { where: { socioId: string; collectionKey: string } }) => {
        const match = blockProgressRows
          .filter((r) => r.socioId === where.socioId && r.collectionKey === where.collectionKey)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
        return match ? { lessonKey: match.lessonKey } : null;
      }),
    },
    contentLesson: {
      findFirst: vi.fn(async ({ where }: { where: { collection: { slug: string; organizationId: string } } }) => {
        const match = contentLessons
          .filter((l) => l.collectionSlug === where.collection.slug && l.organizationId === where.collection.organizationId)
          .sort((a, b) => a.orderIndex - b.orderIndex)[0];
        return match ? { slug: match.slug } : null;
      }),
    },
  },
}));

const { repo } = await import("@/lib/repo");
const { getLessonThread, resolveMentorMessageMetadata } = await import("../service");

async function sendMentorDm(socioId: string, content: string, collectionKey: string | null, organizationId: string) {
  const metadata = collectionKey
    ? await resolveMentorMessageMetadata(socioId, collectionKey, organizationId)
    : undefined;
  return repo.addMessage({
    socioId,
    role: "mentor",
    content,
    senderType: "mentor",
    ...(metadata ? { metadata } : {}),
  });
}

beforeEach(() => {
  messages = [];
  nextId = 0;
  programVersions = [];
  blockProgressRows = [];
  contentLessons = [];
  vi.clearAllMocks();
});

describe("a mentor DM to a player learner reaches their lesson thread", () => {
  it("appears in getLessonThread when the learner is mid-lesson", async () => {
    programVersions.push({
      collectionSlug: "skills-tool-calls", organizationId: "org-1", status: "published",
      metadata: { delivery: { surface: "player", supportedChannels: ["web"] } }, publishedAt: new Date("2026-01-01"),
    });
    blockProgressRows.push({ socioId: "socio-1", collectionKey: "skills-tool-calls", lessonKey: "skills-and-tool-calls", updatedAt: new Date() });

    await sendMentorDm("socio-1", "Great question — here's how to think about it.", "skills-tool-calls", "org-1");

    const access = { socioId: "socio-1", collectionKey: "skills-tool-calls" } as Parameters<typeof getLessonThread>[0];
    const thread = await getLessonThread(access, "skills-and-tool-calls");

    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({ role: "mentor", senderType: "mentor", content: "Great question — here's how to think about it." });
  });

  it("still reaches the thread for a learner with no BlockProgress yet, via the first-lesson fallback", async () => {
    programVersions.push({
      collectionSlug: "skills-tool-calls", organizationId: "org-1", status: "published",
      metadata: { delivery: { surface: "player", supportedChannels: ["web"] } }, publishedAt: new Date("2026-01-01"),
    });
    contentLessons.push({ collectionSlug: "skills-tool-calls", organizationId: "org-1", slug: "lesson-01-intro", orderIndex: 0 });
    contentLessons.push({ collectionSlug: "skills-tool-calls", organizationId: "org-1", slug: "lesson-02-next", orderIndex: 1 });
    // Deliberately no blockProgressRows entry — the learner has not opened a block.

    await sendMentorDm("socio-new", "Welcome! Let's get started.", "skills-tool-calls", "org-1");

    const access = { socioId: "socio-new", collectionKey: "skills-tool-calls" } as Parameters<typeof getLessonThread>[0];
    const thread = await getLessonThread(access, "lesson-01-intro");

    expect(thread).toHaveLength(1);
    expect(thread[0].content).toBe("Welcome! Let's get started.");
  });

  it("does not leak into a lesson the message was not attached to", async () => {
    programVersions.push({
      collectionSlug: "skills-tool-calls", organizationId: "org-1", status: "published",
      metadata: { delivery: { surface: "player", supportedChannels: ["web"] } }, publishedAt: new Date("2026-01-01"),
    });
    blockProgressRows.push({ socioId: "socio-1", collectionKey: "skills-tool-calls", lessonKey: "lesson-04-pricing", updatedAt: new Date() });

    await sendMentorDm("socio-1", "Keep going on this one.", "skills-tool-calls", "org-1");

    const access = { socioId: "socio-1", collectionKey: "skills-tool-calls" } as Parameters<typeof getLessonThread>[0];
    const otherLesson = await getLessonThread(access, "lesson-05-costs");

    expect(otherLesson).toHaveLength(0);
  });
});

describe("MI's existing takeover behavior is unchanged", () => {
  it("writes an MI mentor DM with no metadata, even though the socio has a curriculumCollectionKey", async () => {
    // MI is a real published course, but its delivery surface is chat.
    programVersions.push({
      collectionSlug: "mi-colombia-curriculum", organizationId: "org-mi", status: "published",
      metadata: { delivery: { surface: "chat", supportedChannels: ["whatsapp", "web"] } }, publishedAt: new Date("2026-01-01"),
    });

    const saved = await sendMentorDm("socio-mi", "Hola, como vas?", "mi-colombia-curriculum", "org-mi");

    expect(saved.metadata).toBeNull();
  });

  it("an MI mentor DM never matches a player-shaped lesson-thread query", async () => {
    programVersions.push({
      collectionSlug: "mi-colombia-curriculum", organizationId: "org-mi", status: "published",
      metadata: { delivery: { surface: "chat", supportedChannels: ["whatsapp", "web"] } }, publishedAt: new Date("2026-01-01"),
    });
    await sendMentorDm("socio-mi", "Hola, como vas?", "mi-colombia-curriculum", "org-mi");

    const access = { socioId: "socio-mi", collectionKey: "mi-colombia-curriculum" } as Parameters<typeof getLessonThread>[0];
    const thread = await getLessonThread(access, "any-lesson");

    expect(thread).toHaveLength(0);
  });
});
