import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { projectSelectionSchema } from "@/lib/journey-package/journey-package.schema";
import { buildProjectSelectionSystemPrompt } from "../prompt";
import { generateProjectProposals, ProjectSelectionOutputError, selectProposalCandidates } from "../service";

vi.mock("@/lib/ai/trace/invokeTraced", () => ({
  invokeTraced: vi.fn((params: { invoke: () => Promise<unknown> }) => params.invoke()),
}));

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "../../content/ai-essentials-v2-manifest.json"), "utf8"));
const selection = projectSelectionSchema.parse(manifest.projectSelection);

describe("project-selection prompt isolation", () => {
  it("contains the automation gate, free stack, unavailable tools, L1 rule, and response policy", () => {
    const prompt = buildProjectSelectionSystemPrompt({
      selection,
      responseStyle: { maxSentences: 3, maxOutputTokens: 240, markdown: "none", maxQuestions: 1 },
    });
    expect(prompt).toContain("Does this run again without the learner rebuilding it?");
    expect(prompt).toContain("Google Apps Script");
    expect(prompt).toContain("time-based triggers");
    expect(prompt).toContain("free-tier chat models");
    expect(prompt).toContain("Cursor");
    expect(prompt).toContain("Claude Code");
    expect(prompt).toContain("paid Replit");
    expect(prompt).toContain("Vercel deploys");
    expect(prompt).toContain("API key with billing");
    expect(prompt).toContain("saved prompt plus a template plus a checklist");
    expect(prompt).toContain("Never exceed 3 complete sentences");
    expect(prompt).toContain("Use no self-reference");
  });
});

describe("project proposal selection", () => {
  it("weights authored affinities but always returns one candidate per family", () => {
    const candidates = selectProposalCandidates(selection, [
      "stop-repeating-myself",
      "build-for-others",
      "better-answers",
      "spot-made-up",
      "under-the-hood",
    ]);
    expect(candidates).toHaveLength(3);
    expect(new Set(candidates.map((candidate) => candidate.family))).toEqual(new Set(["routine", "messy-input", "handoff"]));
    expect(candidates.map((candidate) => candidate.key)).toContain("social-posts");
  });

  it("accepts only the exact three server-selected proposal keys", async () => {
    const candidates = selectProposalCandidates(selection, [
      "stop-repeating-myself", "better-answers", "spot-made-up", "build-for-others", "connect-real-data",
    ]);
    const message = "These three ideas connect directly to the recurring work already in your week. Each starts with one small input and produces one useful output without rebuilding the workflow. Which one would remove the most friction from a real task you already do?";
    const model = {
      invoke: vi.fn(async () => ({ content: JSON.stringify({
        message,
        proposals: candidates.map((candidate) => ({
          presetKey: candidate.key,
          idea: `Small ${candidate.label}`,
          tieBack: "This uses the recurring work in the learner's own description.",
        })),
      }) })),
    };
    const result = await generateProjectProposals({
      access: {
        socioId: "socio-1", courseCode: "AIESS", collectionKey: "ai-essentials", organizationId: "org-1",
        programVersionId: "version-1", programVersion: "2", enrollmentId: "enrollment-1",
        config: { trackedDimensions: [], alertRules: [], projectSelection: selection },
      },
      lifeContext: "I turn club notes into an update every Friday.",
      interests: ["stop-repeating-myself", "better-answers", "spot-made-up", "build-for-others", "connect-real-data"],
      model,
    });
    expect(result.proposals.map((proposal) => proposal.presetKey)).toEqual(candidates.map((candidate) => candidate.key));
    expect(model.invoke).toHaveBeenCalledTimes(1);
  });
});

const INTERESTS = ["stop-repeating-myself", "better-answers", "spot-made-up", "build-for-others", "connect-real-data"];
const CLEAN_MESSAGE = "These three ideas connect directly to the recurring work already in your week. Each starts with one small input and produces one useful output. Which one would remove the most friction from a real task?";

function proposalPayload(message: string) {
  const candidates = selectProposalCandidates(selection, INTERESTS);
  return JSON.stringify({
    message,
    proposals: candidates.map((candidate) => ({
      presetKey: candidate.key,
      idea: `Small ${candidate.label}`,
      tieBack: "This uses the recurring work in the learner's own description.",
    })),
  });
}

function callProposals(model: { invoke: ReturnType<typeof vi.fn> }) {
  return generateProjectProposals({
    access: {
      socioId: "socio-1", courseCode: "AIESS", collectionKey: "ai-essentials", organizationId: "org-1",
      programVersionId: "version-1", programVersion: "2", enrollmentId: "enrollment-1",
      config: { trackedDimensions: [], alertRules: [], projectSelection: selection },
    },
    lifeContext: "I turn club notes into an update every Friday.",
    interests: INTERESTS,
    model: model as unknown as Parameters<typeof generateProjectProposals>[0]["model"],
  });
}

describe("project-selection output validation", () => {
  it("retries once when the model output fails the schema, then succeeds", async () => {
    const model = { invoke: vi.fn() };
    // No trailing question, so `learnerMessageSchema` rejects it.
    model.invoke.mockResolvedValueOnce({ content: proposalPayload("Here are three ideas drawn from your week.") });
    model.invoke.mockResolvedValueOnce({ content: proposalPayload(CLEAN_MESSAGE) });

    const result = await callProposals(model);

    expect(result.message).toBe(CLEAN_MESSAGE);
    expect(model.invoke).toHaveBeenCalledTimes(2);
    // The retry quotes the failure back rather than resending the bare contract.
    const retryPrompt = String(model.invoke.mock.calls[1][0][1].content);
    expect(retryPrompt).toContain("failed output validation");
    expect(retryPrompt).toContain("end with exactly one question");
  });

  it("throws ProjectSelectionOutputError carrying the response body once the retry also fails", async () => {
    const bad = proposalPayload("Here are three ideas drawn from your week.");
    const model = { invoke: vi.fn(async () => ({ content: bad })) };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(callProposals(model)).rejects.toBeInstanceOf(ProjectSelectionOutputError);
    expect(model.invoke).toHaveBeenCalledTimes(2);

    // The body is logged both times, which is what was missing during the
    // investigation that produced this test.
    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(String(consoleError.mock.calls[0][1])).toContain("Here are three ideas drawn from your week.");
    consoleError.mockRestore();
  });

  it("keeps the failing text and the failing field on the error", async () => {
    const bad = proposalPayload("Here are three ideas drawn from your week.");
    const model = { invoke: vi.fn(async () => ({ content: bad })) };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const error = await callProposals(model).catch((reason) => reason);
    expect(error).toBeInstanceOf(ProjectSelectionOutputError);
    expect(error.phase).toBe("proposals");
    expect(error.responseText).toContain("Here are three ideas");
    expect(error.issues.map((issue: { path: PropertyKey[] }) => issue.path.join("."))).toContain("message");
    vi.restoreAllMocks();
  });

  it("states the trailing-question requirement in the style repair prompt", async () => {
    const model = { invoke: vi.fn() };
    // Passes the schema but self-references, which is what triggers the repair.
    model.invoke.mockResolvedValueOnce({ content: proposalPayload("I picked three ideas from your week. Which one helps most?") });
    model.invoke.mockResolvedValueOnce({ content: proposalPayload(CLEAN_MESSAGE) });

    await callProposals(model);

    expect(model.invoke).toHaveBeenCalledTimes(2);
    const repairPrompt = String(model.invoke.mock.calls[1][0][1].content);
    expect(repairPrompt).toContain("Repair only the learner-visible message");
    // The regression: the shared tutor rules cap questions but never require
    // one, so the repair used to talk the model out of the trailing question.
    expect(repairPrompt).toContain("must end with exactly one question");
  });
});
