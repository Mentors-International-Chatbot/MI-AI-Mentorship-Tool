import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { TenantIsolationError } from "@/lib/repo/tenantContext";

const mocks = vi.hoisted(() => ({
  resolveRequestIdentity: vi.fn(),
  resolvePlayerAccess: vi.fn(),
  getProjectSetupDto: vi.fn(),
  saveProjectSetupInterests: vi.fn(),
  saveProjectSetupLifeContext: vi.fn(),
  stageProjectSetup: vi.fn(),
  confirmProjectSetup: vi.fn(),
  generateProjectProposals: vi.fn(),
  generateProjectScope: vi.fn(),
  finalizeProjectScope: vi.fn(),
}));

vi.mock("@/lib/auth/requestIdentity", () => ({ resolveRequestIdentity: mocks.resolveRequestIdentity }));
vi.mock("@/lib/player/service", () => ({
  PlayerError: class PlayerError extends Error {},
  resolvePlayerAccess: mocks.resolvePlayerAccess,
}));
vi.mock("@/lib/repo/tenantPrismaRepo", () => ({
  LearnerProjectTransitionError: class LearnerProjectTransitionError extends Error {},
  tenantPrismaRepo: {},
}));
vi.mock("@/lib/player/learnerProject", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/player/learnerProject")>();
  return {
    ...actual,
    getProjectSetupDto: mocks.getProjectSetupDto,
    saveProjectSetupInterests: mocks.saveProjectSetupInterests,
    saveProjectSetupLifeContext: mocks.saveProjectSetupLifeContext,
    stageProjectSetup: mocks.stageProjectSetup,
    confirmProjectSetup: mocks.confirmProjectSetup,
  };
});
vi.mock("@/lib/ai/project-selection/service", async (importOriginal) => ({
  // The error class is a real export the route does `instanceof` against, so it
  // has to come from the module rather than be stubbed.
  ProjectSelectionOutputError: (await importOriginal<typeof import("@/lib/ai/project-selection/service")>()).ProjectSelectionOutputError,
  generateProjectProposals: mocks.generateProjectProposals,
  generateProjectScope: mocks.generateProjectScope,
  finalizeProjectScope: mocks.finalizeProjectScope,
}));

import { LearnerProjectInputError } from "@/lib/player/learnerProject";
import { ProjectSelectionOutputError } from "@/lib/ai/project-selection/service";
import { GET, POST, PUT } from "../route";

const params = { params: Promise.resolve({ course: "AIESS" }) };
const access = { organizationId: "org-a", enrollmentId: "enrollment-a", config: { projectSelection: {} } };
const draft = {
  id: "project-a", status: "DRAFT", interests: ["one", "two", "three", "four", "five"],
  lifeContext: "I write the same club update every week.", automationValidatedAt: null,
};

function request(method = "GET", body?: unknown) {
  return new NextRequest("http://localhost/api/learn/AIESS/project-setup", {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveRequestIdentity.mockResolvedValue({ role: "socio", socioId: "socio-a", channel: "web" });
  mocks.resolvePlayerAccess.mockResolvedValue(access);
  mocks.getProjectSetupDto.mockResolvedValue({ interestTopics: [], project: draft });
  mocks.saveProjectSetupInterests.mockResolvedValue(draft);
  mocks.saveProjectSetupLifeContext.mockResolvedValue(draft);
  mocks.confirmProjectSetup.mockResolvedValue({ ...draft, status: "ACTIVE", confirmedAt: new Date() });
});

describe("/api/learn/[course]/project-setup", () => {
  it("returns 404 when projectSelection is absent", async () => {
    mocks.getProjectSetupDto.mockRejectedValueOnce(new LearnerProjectInputError(
      "project_selection_not_configured", "This course does not configure project selection",
    ));
    const response = await GET(request(), params);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "project_selection_not_configured" });
  });

  it("requires exactly five interests before creating the draft", async () => {
    const response = await POST(request("POST", { action: "select_interests", interests: ["one", "two", "three", "four"] }), params);
    expect(response.status).toBe(400);
    expect(mocks.saveProjectSetupInterests).not.toHaveBeenCalled();
  });

  it("creates the DRAFT when five interests are selected", async () => {
    const interests = ["one", "two", "three", "four", "five"];
    const response = await POST(request("POST", { action: "select_interests", interests }), params);
    expect(response.status).toBe(200);
    expect(mocks.saveProjectSetupInterests).toHaveBeenCalledWith(access, interests);
  });

  it("persists turn one before generating proposals", async () => {
    mocks.generateProjectProposals.mockResolvedValue({ message: "Three ideas.", proposals: [] });
    const response = await POST(request("POST", { action: "proposals", lifeContext: draft.lifeContext }), params);
    expect(response.status).toBe(200);
    expect(mocks.saveProjectSetupLifeContext).toHaveBeenCalledWith(access, draft.lifeContext);
    expect(mocks.generateProjectProposals).toHaveBeenCalledWith(expect.objectContaining({ lifeContext: draft.lifeContext }));
  });

  it("confirms through PUT and returns an ACTIVE project with confirmedAt", async () => {
    const response = await PUT(request("PUT", { title: "My weekly club update" }), params);
    expect(response.status).toBe(200);
    expect(mocks.confirmProjectSetup).toHaveBeenCalledWith(access, "My weekly club update");
    await expect(response.json()).resolves.toMatchObject({ project: { status: "ACTIVE" } });
  });

  it("separates a bad request body from a bad model response", async () => {
    // Request body: the caller's fault, 400.
    const badRequest = await POST(request("POST", { action: "proposals", lifeContext: "" }), params);
    expect(badRequest.status).toBe(400);
    await expect(badRequest.json()).resolves.toMatchObject({ code: "invalid_project_setup" });

    // Model output: not the caller's fault. These were the same 400 with the
    // same message, which is what made the failure take a full investigation.
    mocks.generateProjectProposals.mockRejectedValueOnce(new ProjectSelectionOutputError(
      "proposals",
      [{ code: "custom", path: ["message"], message: "must end with exactly one question" }] as never,
      '{"message":"Here are three ideas."}',
    ));
    const badOutput = await POST(request("POST", { action: "proposals", lifeContext: draft.lifeContext }), params);
    expect(badOutput.status).toBe(502);
    await expect(badOutput.json()).resolves.toMatchObject({ code: "invalid_model_output", phase: "proposals" });
  });

  it("returns 403 when enrollment resolution rejects cross-organization access", async () => {
    mocks.resolvePlayerAccess.mockRejectedValueOnce(new TenantIsolationError("Cross-tenant access denied"));
    const response = await GET(request(), params);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "project_access_denied" });
  });
});
