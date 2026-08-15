import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ required: vi.fn() }));

vi.mock("@/lib/repo", () => ({
  tenantRepo: { learnerProjectSelectionRequired: mocks.required },
}));

import { learnerProjectSelectionRequired } from "../learnerProject";
import { programVersionConfigSchema } from "@/lib/journey-package/program-version-config.schema";

const base = {
  organizationId: "org-1",
  enrollmentId: "enrollment-1",
  collectionKey: "course-one",
};
const legacyConfig = programVersionConfigSchema.parse({});
const configured = {
  ...legacyConfig,
  projectSelection: { presets: [], interestTopics: [] },
};

describe("learnerProjectSelectionRequired config gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not consult project state when projectSelection is absent", async () => {
    await expect(learnerProjectSelectionRequired({ ...base, config: legacyConfig })).resolves.toBe(false);
    expect(mocks.required).not.toHaveBeenCalled();
  });

  it("uses enrollment-scoped project state when projectSelection is configured", async () => {
    mocks.required.mockResolvedValue(true);
    await expect(learnerProjectSelectionRequired({
      ...base,
      config: configured,
    })).resolves.toBe(true);
    expect(mocks.required).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }), "enrollment-1", "course-one");
  });
});
