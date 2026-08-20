import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyMentorOwnership: vi.fn(),
  getSocioById: vi.fn(),
  addMessage: vi.fn(),
  resolveOrganizationForSocio: vi.fn(),
  resolveMentorMessageMetadata: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@/lib/auth/ownership", () => ({ verifyMentorOwnership: mocks.verifyMentorOwnership }));
vi.mock("@/lib/repo", () => ({
  repo: { getSocioById: mocks.getSocioById, addMessage: mocks.addMessage },
  tenantRepo: { resolveOrganizationForSocio: mocks.resolveOrganizationForSocio },
}));
vi.mock("@/lib/player/service", () => ({ resolveMentorMessageMetadata: mocks.resolveMentorMessageMetadata }));
vi.mock("@/lib/delivery", () => ({
  WhatsAppChannel: vi.fn().mockImplementation(() => ({ sendMessage: mocks.sendMessage })),
}));

import { POST } from "../route";

const routeParams = { params: Promise.resolve({ id: "socio-1" }) };

function post(body: unknown) {
  return new NextRequest("http://localhost/api/dashboard/socios/socio-1/message", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function baseSocio(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "socio-1",
    name: "Learner",
    channelType: "web",
    whatsappPhoneNumber: null,
    language: "es",
    curriculumCollectionKey: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyMentorOwnership.mockResolvedValue({ authorized: true, session: { userId: "mentor-1", role: "mentor" } });
  mocks.addMessage.mockImplementation(async (data) => ({ id: "msg-1", createdAt: new Date(), ...data }));
  mocks.resolveOrganizationForSocio.mockResolvedValue({ organizationId: "org-1", source: "collection_key" });
});

describe("POST /api/dashboard/socios/[id]/message — reachability gate", () => {
  it("returns the ownership check's own response when unauthorized", async () => {
    const denied = { authorized: false as const, response: new Response(JSON.stringify({ error: "Not found" }), { status: 404 }) };
    mocks.verifyMentorOwnership.mockResolvedValue(denied);

    const response = await POST(post({ content: "hi" }), routeParams);

    expect(response.status).toBe(404);
    expect(mocks.getSocioById).not.toHaveBeenCalled();
  });
});

describe("POST /api/dashboard/socios/[id]/message — socio with no curriculum at all", () => {
  it("writes no metadata and never consults the resolver", async () => {
    mocks.getSocioById.mockResolvedValue(baseSocio({ curriculumCollectionKey: null }));

    await POST(post({ content: "Hola, como vas?" }), routeParams);

    expect(mocks.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ socioId: "socio-1", role: "mentor", senderType: "mentor", content: "Hola, como vas?" }),
    );
    const written = mocks.addMessage.mock.calls[0][0];
    expect(written).not.toHaveProperty("metadata");
    expect(mocks.resolveOrganizationForSocio).not.toHaveBeenCalled();
    expect(mocks.resolveMentorMessageMetadata).not.toHaveBeenCalled();
  });
});

describe("POST /api/dashboard/socios/[id]/message — MI (chat-surface) socio, unchanged behavior", () => {
  it("writes no metadata when curriculumCollectionKey resolves to a chat-surface course", async () => {
    // MI socios carry a real curriculumCollectionKey (e.g. from the frozen MI
    // fixture) — the resolver itself, not this route, is what tells chat and
    // player surfaces apart. Simulated here by the resolver returning
    // undefined, exactly as it does for a chat-surface course.
    mocks.getSocioById.mockResolvedValue(baseSocio({ curriculumCollectionKey: "mi-colombia-curriculum" }));
    mocks.resolveMentorMessageMetadata.mockResolvedValue(undefined);

    await POST(post({ content: "Hola, como vas?" }), routeParams);

    expect(mocks.resolveMentorMessageMetadata).toHaveBeenCalledWith("socio-1", "mi-colombia-curriculum", "org-1");
    const written = mocks.addMessage.mock.calls[0][0];
    expect(written).not.toHaveProperty("metadata");
  });
});

describe("POST /api/dashboard/socios/[id]/message — player-surface socio", () => {
  it("stamps whatever the resolver returns onto the written message", async () => {
    mocks.getSocioById.mockResolvedValue(baseSocio({ curriculumCollectionKey: "skills-tool-calls" }));
    mocks.resolveMentorMessageMetadata.mockResolvedValue({
      surface: "player",
      collectionKey: "skills-tool-calls",
      lessonKey: "lesson-04-pricing",
    });

    await POST(post({ content: "Great question, here is how to think about it." }), routeParams);

    expect(mocks.resolveMentorMessageMetadata).toHaveBeenCalledWith("socio-1", "skills-tool-calls", "org-1");
    expect(mocks.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { surface: "player", collectionKey: "skills-tool-calls", lessonKey: "lesson-04-pricing" },
      }),
    );
  });

  it("still writes the message, without a lessonKey, when the resolver could not guess one", async () => {
    // The learner never opened a block; the first-lesson fallback that lets
    // this still resolve is exercised in `resolveMentorMessageMetadata`'s own
    // tests. Here the route only needs to pass whatever comes back straight
    // through — the original bug was the route dropping metadata entirely.
    mocks.getSocioById.mockResolvedValue(baseSocio({ curriculumCollectionKey: "skills-tool-calls" }));
    mocks.resolveMentorMessageMetadata.mockResolvedValue({
      surface: "player",
      collectionKey: "skills-tool-calls",
    });

    const response = await POST(post({ content: "Welcome! Let's get started." }), routeParams);

    expect(response.status).toBe(200);
    expect(mocks.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { surface: "player", collectionKey: "skills-tool-calls" } }),
    );
  });

  it("still writes the message, with no metadata, when organization resolution fails outright", async () => {
    mocks.getSocioById.mockResolvedValue(baseSocio({ curriculumCollectionKey: "skills-tool-calls" }));
    mocks.resolveOrganizationForSocio.mockRejectedValue(new Error("no resolvable tenant"));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await POST(post({ content: "Hang in there!" }), routeParams);

    expect(response.status).toBe(200);
    expect(mocks.resolveMentorMessageMetadata).not.toHaveBeenCalled();
    const written = mocks.addMessage.mock.calls[0][0];
    expect(written).not.toHaveProperty("metadata");
    consoleWarn.mockRestore();
  });
});

describe("POST /api/dashboard/socios/[id]/message — validation", () => {
  it("rejects empty content before loading the socio", async () => {
    const response = await POST(post({ content: "   " }), routeParams);

    expect(response.status).toBe(400);
    expect(mocks.getSocioById).not.toHaveBeenCalled();
  });

  it("404s when the socio does not exist", async () => {
    mocks.getSocioById.mockResolvedValue(null);

    const response = await POST(post({ content: "hi" }), routeParams);

    expect(response.status).toBe(404);
  });
});
