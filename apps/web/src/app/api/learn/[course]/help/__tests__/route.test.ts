import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveRequestIdentity: vi.fn(),
  resolvePlayerAccess: vi.fn(),
  requestHelp: vi.fn(),
}));

vi.mock("@/lib/auth/requestIdentity", () => ({ resolveRequestIdentity: mocks.resolveRequestIdentity }));
vi.mock("@/lib/player/service", () => ({
  PlayerError: class PlayerError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
  resolvePlayerAccess: mocks.resolvePlayerAccess,
}));
vi.mock("@/lib/player/helpRequest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/player/helpRequest")>();
  return { ...actual, requestHelp: mocks.requestHelp };
});

import { POST } from "../route";
import { PlayerError } from "@/lib/player/service";

const routeParams = { params: Promise.resolve({ course: "AIESS" }) };
const identity = { role: "socio", socioId: "socio-a", channel: "web" };
const access = { socioId: "socio-a", collectionKey: "ai-essentials", organizationId: "org-a" };

function post(body: unknown) {
  return new NextRequest("http://localhost/api/learn/AIESS/help", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveRequestIdentity.mockResolvedValue(identity);
  mocks.resolvePlayerAccess.mockResolvedValue(access);
  mocks.requestHelp.mockResolvedValue({ status: "created", flagId: "flag-1", occurrenceCount: 1 });
});

describe("POST /api/learn/[course]/help", () => {
  it("rejects an unauthenticated caller before touching anything else", async () => {
    mocks.resolveRequestIdentity.mockResolvedValue(null);

    const response = await POST(post({}), routeParams);

    expect(response.status).toBe(401);
    expect(mocks.resolvePlayerAccess).not.toHaveBeenCalled();
    expect(mocks.requestHelp).not.toHaveBeenCalled();
  });

  it("resolves the course from the route, never from the body", async () => {
    await POST(post({ course: "mi-colombia-curriculum", message: "help" }), routeParams);

    expect(mocks.resolvePlayerAccess).toHaveBeenCalledWith(identity, "AIESS");
    // The body's course field is not in the schema and so is stripped.
    expect(mocks.requestHelp.mock.calls[0][1]).toEqual({ message: "help" });
  });

  it("passes lesson and block through and returns the created result", async () => {
    const response = await POST(
      post({ message: "stuck", lessonKey: "ai-harness-control", blockId: "block-7" }),
      routeParams,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "created",
      flagId: "flag-1",
      occurrenceCount: 1,
    });
    expect(mocks.requestHelp.mock.calls[0][1]).toEqual({
      message: "stuck",
      lessonKey: "ai-harness-control",
      blockId: "block-7",
    });
  });

  it("accepts an empty body — pressing the button is the whole request", async () => {
    const response = await POST(post({}), routeParams);

    expect(response.status).toBe(200);
    expect(mocks.requestHelp).toHaveBeenCalledTimes(1);
  });

  it("returns 200, not an error, when a request is already open", async () => {
    mocks.requestHelp.mockResolvedValue({
      status: "already_open",
      flagId: "flag-1",
      occurrenceCount: 3,
    });

    const response = await POST(post({ message: "still stuck" }), routeParams);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "already_open" });
  });

  it("surfaces a cross-tenant refusal as the PlayerError's own status", async () => {
    mocks.resolvePlayerAccess.mockRejectedValue(
      new PlayerError(403, "not_enrolled", "You are not enrolled in this course"),
    );

    const response = await POST(post({}), routeParams);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "not_enrolled" });
    expect(mocks.requestHelp).not.toHaveBeenCalled();
  });

  it("refuses a mentor or admin caller — the player surface is learners only", async () => {
    mocks.resolvePlayerAccess.mockRejectedValue(
      new PlayerError(403, "learner_required", "Learner access required"),
    );

    const response = await POST(post({}), routeParams);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "learner_required" });
  });

  it("reports a course with the feature off as 404", async () => {
    mocks.requestHelp.mockRejectedValue(
      new PlayerError(404, "help_request_not_configured", "This course does not offer help requests"),
    );

    const response = await POST(post({}), routeParams);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "help_request_not_configured",
    });
  });

  it("rejects a message longer than the schema's hard ceiling", async () => {
    const response = await POST(post({ message: "a".repeat(5_000) }), routeParams);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_help_request" });
    expect(mocks.requestHelp).not.toHaveBeenCalled();
  });

  it("does not leak an unexpected failure to the learner", async () => {
    mocks.requestHelp.mockRejectedValue(new Error("connection terminated: secret-host:5432"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(post({}), routeParams);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("secret-host");
    consoleError.mockRestore();
  });
});
