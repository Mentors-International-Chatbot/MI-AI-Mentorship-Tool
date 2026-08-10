import { describe, expect, it } from "vitest";
import { selectSyntheticAiEssentialsVersion } from "../devTestLearnerRepo";

function candidate(
  id: string,
  options: {
    organizationId?: string;
    synthetic?: boolean;
    surface?: "chat" | "player";
    channels?: ("whatsapp" | "web" | "canvas")[];
    collectionOrganizationId?: string;
  } = {},
) {
  const organizationId = options.organizationId ?? "acceptance-org";
  return {
    id,
    programId: `program-${id}`,
    metadata: {
      delivery: {
        surface: options.surface ?? "player",
        supportedChannels: options.channels ?? ["web", "canvas"],
      },
    },
    program: {
      organizationId,
      organization: {
        settings: options.synthetic === false ? null : { syntheticDataOnly: true },
      },
    },
    collection: {
      organizationId: options.collectionOrganizationId ?? organizationId,
    },
  };
}

describe("selectSyntheticAiEssentialsVersion", () => {
  it("selects one web-player publication owned consistently by a synthetic organization", () => {
    const accepted = candidate("accepted");
    expect(selectSyntheticAiEssentialsVersion([accepted])).toBe(accepted);
  });

  it("rejects a non-synthetic owner", () => {
    expect(selectSyntheticAiEssentialsVersion([
      candidate("production", { synthetic: false }),
    ])).toBeNull();
  });

  it("fails closed when more than one synthetic publication is eligible", () => {
    expect(selectSyntheticAiEssentialsVersion([
      candidate("one"),
      candidate("two", { organizationId: "other-synthetic-org" }),
    ])).toBeNull();
  });

  it("rejects unsupported delivery and collection/program tenant mismatches", () => {
    expect(selectSyntheticAiEssentialsVersion([
      candidate("chat", { surface: "chat" }),
      candidate("canvas-only", { channels: ["canvas"] }),
      candidate("mismatch", { collectionOrganizationId: "different-org" }),
    ])).toBeNull();
  });
});
