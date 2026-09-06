import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hydrateBlockProgress } from "../LessonPlayer";

const playerSource = readFileSync(resolve(process.cwd(), "src/components/player/LessonPlayer.tsx"), "utf8");
const serviceSource = readFileSync(resolve(process.cwd(), "src/lib/player/service.ts"), "utf8");

describe("hydrateBlockProgress", () => {
  it("keeps incomplete blocks out of both client sets", () => {
    const result = hydrateBlockProgress([{ blockId: "b1", completedAt: null }]);
    expect([...result.completed]).toEqual([]);
    expect([...result.submittedComplete]).toEqual([]);
    expect(result.feedback).toEqual({});
  });

  it("restores an ordinary completed block as history", () => {
    const result = hydrateBlockProgress([{ blockId: "b1", completedAt: "2026-01-01T00:00:00Z" }]);
    expect([...result.completed]).toEqual(["b1"]);
    expect([...result.submittedComplete]).toEqual([]);
  });

  it("restores a completed-but-unreviewed block as current", () => {
    const result = hydrateBlockProgress([{
      blockId: "b1",
      completedAt: "2026-01-01T00:00:00Z",
      state: { reviewPending: true },
    }]);
    expect([...result.completed]).toEqual([]);
    expect([...result.submittedComplete]).toEqual(["b1"]);
  });

  it("does not let a false review flag hold a block open", () => {
    const result = hydrateBlockProgress([{
      blockId: "b1",
      completedAt: "2026-01-01T00:00:00Z",
      state: { reviewPending: false },
    }]);
    expect([...result.completed]).toEqual(["b1"]);
    expect([...result.submittedComplete]).toEqual([]);
  });

  it("restores saved feedback with a pending review", () => {
    const feedback = { kind: "quiz", correct: true };
    const result = hydrateBlockProgress([{
      blockId: "b1",
      completedAt: "2026-01-01T00:00:00Z",
      state: { reviewPending: true },
      feedback,
    }]);
    expect(result.feedback).toEqual({ b1: feedback });
  });
});

describe("server-authoritative open-question review", () => {
  it("checks the latest persisted exchange for the exact learner, lesson, and block", () => {
    const fn = serviceSource.slice(
      serviceSource.indexOf("async function persistedBlockHoldsOpenQuestion"),
      serviceSource.indexOf("export async function completeBlock"),
    );
    expect(fn).toContain('socioId: access.socioId');
    expect(fn).toContain('{ metadata: { path: ["collectionKey"], equals: access.collectionKey } }');
    expect(fn).toContain('{ metadata: { path: ["lessonKey"], equals: lessonKey } }');
    expect(fn).toContain('{ metadata: { path: ["blockId"], equals: blockId } }');
    expect(fn).toMatch(/latest\?\.role === "assistant" && metadata\.endsWithQuestion === true/);
  });

  it("persists reviewPending and returns it in the completion response", () => {
    const fn = serviceSource.slice(
      serviceSource.indexOf("export async function completeBlock"),
      serviceSource.indexOf("export async function getCourseProgress"),
    );
    expect(fn).toMatch(/const boundedReturnReview = grade\.complete && block\.assessment !== undefined;/);
    expect(fn).toMatch(/const reviewPending = grade\.complete && \(!!grade\.feedback \|\| openQuestionReview \|\| boundedReturnReview\);/);
    expect(fn).toMatch(/\.\.\.\(reviewPending \? \{ reviewPending: true \} : \{\}\)/);
    // C.1: reformatted multi-line to add `interleave`; reviewPending is still
    // one of the returned fields, which is what this test actually pins.
    expect(fn).toMatch(/return \{\s*blockId,\s*completed: grade\.complete,\s*score: grade\.score,\s*feedback: grade\.feedback,\s*reviewPending,\s*lessonComplete,/);
  });

  it("persists the same review hold for completed teach-backs", () => {
    const fn = serviceSource.slice(
      serviceSource.indexOf("export async function recordPlayerTutorSuccess"),
      serviceSource.indexOf("async function getLessonDashboard"),
    );
    expect(fn).toMatch(/\.\.\.\(completedAt \? \{ reviewPending: true \} : \{\}\)/);
  });
});

describe("client review lifecycle", () => {
  it("hydrates both completed and submittedComplete from durable progress", () => {
    expect(playerSource).toMatch(/const hydrated = hydrateBlockProgress\(result\.progress\);/);
    expect(playerSource).toMatch(/setCompleted\(hydrated\.completed\);/);
    expect(playerSource).toMatch(/setSubmittedComplete\(hydrated\.submittedComplete\);/);
    expect(playerSource).toMatch(/setFeedback\(hydrated\.feedback\);/);
  });

  it("lets the server decide whether the completed block needs review", () => {
    const fn = playerSource.slice(playerSource.indexOf("async function complete("), playerSource.indexOf("async function advance("));
    expect(fn).toMatch(/openQuestionGateEnabled: gatedStreak < OPEN_QUESTION_GATE_CAP/);
    expect(fn).toMatch(/if \(result\.reviewPending\) \{/);
    expect(fn).not.toMatch(/blockHoldsOpenQuestion/);
  });

  it("acknowledges review on the server before advancing locally", () => {
    const fn = playerSource.slice(playerSource.indexOf("async function advanceReviewedBlock"), playerSource.indexOf("async function askTutor"));
    expect(fn).toMatch(/await playerFetch[\s\S]*acknowledgeReview: true/);
    expect(fn.indexOf("await playerFetch")).toBeLessThan(fn.indexOf("setCompleted"));
  });

  it("keeps the cap as a backstop", () => {
    expect(playerSource).toMatch(/const OPEN_QUESTION_GATE_CAP = 5;/);
  });
});

describe("primary controls hide while review is pending", () => {
  it("suppresses the teach, quiz, and drag controls", () => {
    expect(playerSource).toMatch(/current\.blockType === "teach" && !submittedComplete\.has\(current\.id\)/);
    expect(playerSource).toMatch(/current\.blockType === "quiz_checkpoint" && !submittedComplete\.has\(current\.id\)/);
    expect(playerSource).toMatch(/current\.blockType === "drag_order" && !submittedComplete\.has\(current\.id\)/);
  });
});

describe("authored flow copy", () => {
  it("derives handoff verbatim and renders quiz titles", () => {
    expect(playerSource).toMatch(/content: block\.handoff/);
    expect(playerSource).toMatch(/\{\(current as Quiz\)\.title && <h2>\{\(current as Quiz\)\.title\}<\/h2>\}/);
  });
});
