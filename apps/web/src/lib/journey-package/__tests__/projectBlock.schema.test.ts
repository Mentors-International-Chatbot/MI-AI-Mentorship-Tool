import { describe, expect, it } from "vitest";
import { lessonBlockSchema, resolveProjectBlocking } from "../journey-package.schema";

function block(overrides: Record<string, unknown> = {}) {
  return {
    id: "brief", order: 1, blockType: "project", content: "Go do the thing, then come back.",
    ...overrides,
  };
}

describe("project block schema", () => {
  it("accepts a block with requiresSubmission omitted (defaults false)", () => {
    const result = lessonBlockSchema.safeParse(block());
    expect(result.success).toBe(true);
    if (result.success && result.data.blockType === "project") {
      expect(result.data.requiresSubmission).toBe(false);
      expect(resolveProjectBlocking(result.data)).toBe(false);
    }
  });

  it("accepts requiresSubmission: true, blocking: true", () => {
    const result = lessonBlockSchema.safeParse(block({ requiresSubmission: true, blocking: true }));
    expect(result.success).toBe(true);
    if (result.success && result.data.blockType === "project") {
      expect(resolveProjectBlocking(result.data)).toBe(true);
    }
  });

  it("rejects requiresSubmission: true, blocking: false — not supported until non-blocking submissions are persisted", () => {
    const result = lessonBlockSchema.safeParse(block({ requiresSubmission: true, blocking: false }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("does not persist a non-blocking submission");
  });

  it("defaults blocking to requiresSubmission's value when omitted", () => {
    const result = lessonBlockSchema.safeParse(block({ requiresSubmission: true }));
    expect(result.success).toBe(true);
    if (result.success && result.data.blockType === "project") {
      expect(result.data.blocking).toBeUndefined();
      expect(resolveProjectBlocking(result.data)).toBe(true);
    }
  });

  it("rejects blocking: true with requiresSubmission: false", () => {
    const result = lessonBlockSchema.safeParse(block({ requiresSubmission: false, blocking: true }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("cannot set blocking: true while requiresSubmission is false");
  });

  it("inherits handoff and assessment slots from blockBase", () => {
    const result = lessonBlockSchema.safeParse(block({ handoff: "Now go apply it." }));
    expect(result.success).toBe(true);
    if (result.success && result.data.blockType === "project") {
      expect(result.data.handoff).toBe("Now go apply it.");
    }
  });
});
