import { describe, expect, it } from "vitest";
import { selectPublishedPlayerVersion } from "../selectPublishedPlayerVersion";

function candidate(id: string, organizationId: string, syntheticDataOnly = false) {
  return {
    id,
    program: {
      organizationId,
      organization: { settings: syntheticDataOnly ? { syntheticDataOnly: true } : null },
    },
  };
}

describe("selectPublishedPlayerVersion", () => {
  it("never exposes a synthetic verification version to an unanchored learner", () => {
    expect(selectPublishedPlayerVersion([candidate("verification", "verification-org", true)])).toBeNull();
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
});
