import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const shell = readFileSync(resolve(process.cwd(), "src/components/player/BoundedAssessmentContainer.tsx"), "utf8");
const lessonPlayer = readFileSync(resolve(process.cwd(), "src/components/player/LessonPlayer.tsx"), "utf8");
const reteach = readFileSync(resolve(process.cwd(), "src/components/player/ReteachGateExperience.tsx"), "utf8");
const quiz = readFileSync(resolve(process.cwd(), "src/components/player/WebQuizExperience.tsx"), "utf8");

describe("bounded assessment container", () => {
  it("owns only the shared entry, attempt, completion, verdict, and return phases", () => {
    expect(shell).toMatch(/phase === "entry"/);
    expect(shell).toMatch(/phase === "active"/);
    expect(shell).toMatch(/phase === "verdict"/);
    expect(shell).toMatch(/onEnter/);
    expect(shell).toMatch(/onComplete/);
    expect(shell).toMatch(/onReturn/);
    expect(shell).not.toMatch(/api\/assessment|gradePlayerBlock|questions\.map|sendTurn/);
  });

  it("selects payload components at one player seam and removes the normal tutor box", () => {
    expect(lessonPlayer).toMatch(/boundedMode === "reteach_gate"/);
    expect(lessonPlayer).toMatch(/boundedMode === "web_quiz"/);
    expect(lessonPlayer).toMatch(/<ReteachGateExperience/);
    expect(lessonPlayer).toMatch(/<WebQuizExperience/);
    expect(lessonPlayer).toMatch(/\{!boundedMode && <aside className="player-card">/);
  });

  it("keeps reteach on AssessmentSession and writes its terminal result to BlockProgress", () => {
    expect(reteach).toMatch(/assessment-session/);
    expect(reteach).toMatch(/\/api\/assessment\/\$\{sessionId\}\/message/);
    expect(reteach).toMatch(/\/api\/assessment\/\$\{sessionId\}\/complete/);
    expect(reteach).toMatch(/onWriteBlockCompletion/);
  });

  it("keeps web_quiz on the deterministic player completion adapter", () => {
    expect(quiz).toMatch(/onSubmit\(answers\)/);
    expect(quiz).not.toMatch(/AssessmentSession|\/api\/assessment/);
  });
});
