import { describe, expect, it } from "vitest";
import { buildScorePayload } from "../ags";

describe("Canvas AGS score payload", () => {
  it("uses FullyGraded for visible incremental grades", () => {
    expect(buildScorePayload({ subject: "canvas-user", scoreGiven: 20, milestoneCount: 1, timestamp: new Date("2026-08-10T00:00:00Z") })).toEqual({
      userId: "canvas-user", scoreGiven: 20, scoreMaximum: 100,
      activityProgress: "InProgress", gradingProgress: "FullyGraded", timestamp: "2026-08-10T00:00:00.000Z",
    });
  });

  it("marks the fifth milestone completed at 100 points", () => {
    expect(buildScorePayload({ subject: "canvas-user", scoreGiven: 100, milestoneCount: 5 }).activityProgress).toBe("Completed");
  });
});
