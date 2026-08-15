import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { projectSelectionSchema } from "@/lib/journey-package/journey-package.schema";
import { buildProjectSelectionSystemPrompt } from "../prompt";
import { generateProjectProposals, selectProposalCandidates } from "../service";

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
        socioId: "socio-1", collectionKey: "ai-essentials", organizationId: "org-1",
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
