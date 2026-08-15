import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveRequestIdentity: vi.fn(),
  resolvePlayerAccess: vi.fn(),
  getCurrentLearnerProject: vi.fn(),
  putCurrentLearnerProject: vi.fn(),
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
    getCurrentLearnerProject: mocks.getCurrentLearnerProject,
    putCurrentLearnerProject: mocks.putCurrentLearnerProject,
  };
});

import { GET, PUT } from "../route";

const routeParams = { params: Promise.resolve({ course: "AIESS" }) };
const identity = { role: "socio", socioId: "socio-a", channel: "web" };
const access = { organizationId: "org-a", enrollmentId: "enrollment-a", config: {} };
const project = {
  id: "project-a",
  organizationId: "org-a",
  enrollmentId: "enrollment-a",
  socioId: "socio-a",
  presetKey: "morning-brief",
  title: "Morning brief",
  oneLiner: "Know what is due",
  context: null,
  automationLevel: "L3",
  interests: ["one", "two", "three", "four", "five"],
  status: "DRAFT",
  createdAt: new Date("2026-08-14T00:00:00Z"),
  confirmedAt: null,
  updatedAt: new Date("2026-08-14T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveRequestIdentity.mockResolvedValue(identity);
  mocks.resolvePlayerAccess.mockResolvedValue(access);
  mocks.getCurrentLearnerProject.mockResolvedValue(project);
  mocks.putCurrentLearnerProject.mockResolvedValue(project);
});

describe("/api/learn/[course]/project", () => {
  it("returns the current learner's project", async () => {
    const response = await GET(new NextRequest("http://localhost/api/learn/AIESS/project"), routeParams);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "project-a", enrollmentId: "enrollment-a" });
    expect(mocks.getCurrentLearnerProject).toHaveBeenCalledWith(access);
  });

  it("returns a stable 404 when the enrollment has no current project", async () => {
    mocks.getCurrentLearnerProject.mockResolvedValueOnce(null);
    const response = await GET(new NextRequest("http://localhost/api/learn/AIESS/project"), routeParams);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "project_not_found" });
  });

  it("validates and saves a complete PUT body", async () => {
    const body = {
      presetKey: "morning-brief",
      title: "Morning brief",
      oneLiner: "Know what is due",
      automationLevel: "L3",
      interests: ["one", "two", "three", "four", "five"],
      status: "DRAFT",
    };
    const response = await PUT(new NextRequest("http://localhost/api/learn/AIESS/project", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), routeParams);
    expect(response.status).toBe(200);
    expect(mocks.putCurrentLearnerProject).toHaveBeenCalledWith(access, body);
  });

  it("rejects malformed interests before calling the write service", async () => {
    const response = await PUT(new NextRequest("http://localhost/api/learn/AIESS/project", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        presetKey: "custom",
        title: "Custom",
        oneLiner: "A custom workflow",
        automationLevel: "L2",
        interests: ["only-one"],
      }),
    }), routeParams);
    expect(response.status).toBe(400);
    expect(mocks.putCurrentLearnerProject).not.toHaveBeenCalled();
  });
});
