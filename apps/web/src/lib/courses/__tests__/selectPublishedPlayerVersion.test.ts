import { describe, expect, it } from "vitest";
import { selectPublishedPlayerVersion } from "../selectPublishedPlayerVersion";

function candidate(id: string, organizationId: string, settings: Record<string, unknown> | null = null) {
  return {
    id,
    program: {
      organizationId,
      organization: { settings },
    },
  };
}

describe("selectPublishedPlayerVersion", () => {
  it("never exposes a synthetic verification version to an unanchored learner", () => {
    expect(selectPublishedPlayerVersion([candidate("verification", "verification-org", { syntheticDataOnly: true })])).toBeNull();
  });

  it("selects only the version owned by an anchored learner's organization", () => {
    const own = candidate("own", "org-a");
    const other = candidate("other", "org-b");
    expect(selectPublishedPlayerVersion([other, own], "org-a")).toBe(own);
  });

  it("fails closed when direct-web ownership is ambiguous", () => {
    expect(selectPublishedPlayerVersion([
      candidate("one", "org-a"),
      candidate("two", "org-b"),
    ])).toBeNull();
  });

  it("exposes a synthetic version to an unanchored learner when its org opts into open enrollment", () => {
    const openSynthetic = candidate("aiess", "aiess-org", { syntheticDataOnly: true, openEnrollment: true });
    expect(selectPublishedPlayerVersion([openSynthetic])).toBe(openSynthetic);
  });

  it("does not widen an anchored learner's eligibility, even with open enrollment set", () => {
    const own = candidate("own", "org-a");
    const openOther = candidate("other", "org-b", { openEnrollment: true });
    expect(selectPublishedPlayerVersion([openOther, own], "org-a")).toBe(own);
  });
});
