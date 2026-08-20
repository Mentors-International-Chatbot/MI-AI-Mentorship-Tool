import { describe, expect, it } from "vitest";
import { mergePlayerMessages, type PlayerThreadMessage } from "../usePlayerThread";

function message(id: string, createdAt: string, content = id): PlayerThreadMessage {
  return { id, createdAt, content, role: "assistant", senderType: "mentor", metadata: null };
}

describe("mergePlayerMessages", () => {
  it("deduplicates by database id and replaces the matching row", () => {
    const result = mergePlayerMessages(
      [message("same-id", "2026-08-20T10:00:00.000Z", "old")],
      [message("same-id", "2026-08-20T10:00:00.000Z", "new")],
    );

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("new");
  });

  it("does not deduplicate different ids that have identical content", () => {
    const result = mergePlayerMessages(
      [message("first", "2026-08-20T10:00:00.000Z", "Same words")],
      [message("second", "2026-08-20T10:01:00.000Z", "Same words")],
    );

    expect(result.map((row) => row.id)).toEqual(["first", "second"]);
  });

  it("sorts the merged transcript by createdAt", () => {
    const result = mergePlayerMessages(
      [message("later", "2026-08-20T10:02:00.000Z")],
      [message("earlier", "2026-08-20T10:01:00.000Z")],
    );

    expect(result.map((row) => row.id)).toEqual(["earlier", "later"]);
  });
});
