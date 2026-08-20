import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyMentorOwnership: vi.fn(),
  getSocioById: vi.fn(),
  addMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@/lib/auth/ownership", () => ({ verifyMentorOwnership: mocks.verifyMentorOwnership }));
vi.mock("@/lib/repo", () => ({
  repo: { getSocioById: mocks.getSocioById, addMessage: mocks.addMessage },
}));
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

describe("POST /api/dashboard/socios/[id]/message — canonical persistence", () => {
  it.each([null, "mi-colombia-curriculum", "skills-tool-calls"])(
    "writes the same metadata-free mentor row for curriculum %s",
    async (curriculumCollectionKey) => {
      mocks.getSocioById.mockResolvedValue(baseSocio({ curriculumCollectionKey }));

      await POST(post({ content: "  Hola, como vas?  " }), routeParams);

      expect(mocks.addMessage).toHaveBeenCalledWith({
        socioId: "socio-1",
        role: "mentor",
        senderType: "mentor",
        content: "Hola, como vas?",
      });
    },
  );

  it("does not invoke a non-WhatsApp transport branch", async () => {
    mocks.getSocioById.mockResolvedValue(baseSocio({ channelType: "web" }));

    await POST(post({ content: "Hello" }), routeParams);

    expect(mocks.sendMessage).not.toHaveBeenCalled();
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
