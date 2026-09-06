import { describe, expect, it } from "vitest";
import { buildScorePayload } from "../ags";

describe("Canvas AGS score payload", () => {
  it("uses FullyGraded for visible incremental grades", () => {
    expect(buildScorePayload({ subject: "canvas-user", scoreGiven: 20, milestoneCount: 1, milestoneTotal: 5, timestamp: new Date("2026-08-10T00:00:00Z") })).toEqual({
      userId: "canvas-user", scoreGiven: 20, scoreMaximum: 100,
      activityProgress: "InProgress", gradingProgress: "FullyGraded", timestamp: "2026-08-10T00:00:00.000Z",
    });
  });

  it("marks the final milestone completed at 100 points", () => {
    expect(buildScorePayload({ subject: "canvas-user", scoreGiven: 100, milestoneCount: 5, milestoneTotal: 5 }).activityProgress).toBe("Completed");
  });

  // milestoneTotal is config-driven (resolveCourseMilestones), not a
  // hardcoded 5 — this is exactly the case that hardcoding got wrong: a
  // 3-milestone course completing its 3rd milestone.
  it("is config-driven: a 3-milestone course completes at its own 3rd milestone, not at 5", () => {
    expect(buildScorePayload({ subject: "canvas-user", scoreGiven: 100, milestoneCount: 3, milestoneTotal: 3 }).activityProgress).toBe("Completed");
  });

  it("does not complete a 3-milestone course early just because count reached 3 of some other total", () => {
    expect(buildScorePayload({ subject: "canvas-user", scoreGiven: 60, milestoneCount: 3, milestoneTotal: 5 }).activityProgress).toBe("InProgress");
  });
});
