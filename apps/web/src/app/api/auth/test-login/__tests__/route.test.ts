import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class ProvisionError extends Error {}
  return {
    createSession: vi.fn(),
    provisionLearner: vi.fn(),
    ProvisionError,
  };
});

vi.mock("@/lib/auth/session", () => ({
  createSession: mocks.createSession,
}));
vi.mock("@/lib/repo/devTestLearnerRepo", () => ({
  provisionDevAiEssentialsLearner: mocks.provisionLearner,
  DevTestLearnerProvisionError: mocks.ProvisionError,
}));

import { POST } from "../route";

function request(role: string) {
  return new NextRequest("http://localhost:3000/api/auth/test-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ENABLE_TEST_LOGIN", "true");
  mocks.provisionLearner.mockResolvedValue({
    socioId: "real-socio-id",
    name: "AI Essentials Test Learner",
    organizationId: "acceptance-org",
    programVersionId: "aiess-version",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/test-login", () => {
  it("hard-rejects in production before provisioning or session creation", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(request("socio"));

    expect(response.status).toBe(404);
    expect(mocks.provisionLearner).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("also requires the explicit server-side test-login flag", async () => {
    vi.stubEnv("ENABLE_TEST_LOGIN", "false");

    const response = await POST(request("socio"));

    expect(response.status).toBe(404);
    expect(mocks.provisionLearner).not.toHaveBeenCalled();
  });

  it("provisions the database-backed learner and creates its socio session", async () => {
    const response = await POST(request("socio"));

    expect(response.status).toBe(200);
    expect(mocks.provisionLearner).toHaveBeenCalledOnce();
    expect(mocks.createSession).toHaveBeenCalledWith({
      userId: "real-socio-id",
      role: "socio",
      name: "AI Essentials Test Learner",
    }, false);
    await expect(response.json()).resolves.toEqual({
      success: true,
      role: "socio",
      name: "AI Essentials Test Learner",
    });
  });

  it("returns the same learner identity on repeated idempotent provisioning", async () => {
    await POST(request("socio"));
    await POST(request("socio"));

    expect(mocks.provisionLearner).toHaveBeenCalledTimes(2);
    expect(mocks.createSession).toHaveBeenNthCalledWith(1, expect.objectContaining({
      userId: "real-socio-id",
    }), false);
    expect(mocks.createSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
      userId: "real-socio-id",
    }), false);
  });

  it("fails closed when the acceptance publication cannot be selected safely", async () => {
    mocks.provisionLearner.mockRejectedValue(
      new mocks.ProvisionError("Synthetic AI Essentials publication is ambiguous"),
    );

    const response = await POST(request("socio"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Synthetic AI Essentials publication is ambiguous",
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
