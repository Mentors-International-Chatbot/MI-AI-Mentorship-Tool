/**
 * Whether the alerts page grows a zone 0 at all.
 *
 * This is the guard that MI and PB&J mentors see an unchanged page. Their
 * program configs have no `helpRequest` key, so the zone must be absent — not
 * present-and-empty, which would report a silence that was never measured.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: { programVersion: { findMany: mocks.findMany } } }));

import { organizationOffersHelpRequests } from "@/lib/journey-package/help-request-config";

beforeEach(() => vi.clearAllMocks());

describe("organizationOffersHelpRequests", () => {
  it("is true when a published version enables it", async () => {
    mocks.findMany.mockResolvedValue([
      { config: { helpRequest: { enabled: true, maxMessageLength: 1000 } } },
    ]);
    await expect(organizationOffersHelpRequests("org-a")).resolves.toBe(true);
  });

  it("is false for a config with no helpRequest key at all (MI, PB&J)", async () => {
    mocks.findMany.mockResolvedValue([
      { config: { responseStyle: { maxSentences: 3 }, trackedDimensions: [] } },
    ]);
    await expect(organizationOffersHelpRequests("org-mi")).resolves.toBe(false);
  });

  it("is false when the key is present but disabled", async () => {
    mocks.findMany.mockResolvedValue([{ config: { helpRequest: { enabled: false } } }]);
    await expect(organizationOffersHelpRequests("org-a")).resolves.toBe(false);
  });

  it("is false for an organization with no published versions", async () => {
    mocks.findMany.mockResolvedValue([]);
    await expect(organizationOffersHelpRequests("org-empty")).resolves.toBe(false);
  });

  it("is true when only one of several courses enables it", async () => {
    mocks.findMany.mockResolvedValue([
      { config: {} },
      { config: { helpRequest: { enabled: true } } },
      { config: { responseStyle: {} } },
    ]);
    await expect(organizationOffersHelpRequests("org-mixed")).resolves.toBe(true);
  });

  it("scopes to the organization and reads published versions only", async () => {
    mocks.findMany.mockResolvedValue([]);
    await organizationOffersHelpRequests("org-a");

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "published", program: { organizationId: "org-a" } },
      }),
    );
  });

  it("survives a malformed config rather than throwing on a dashboard render", async () => {
    mocks.findMany.mockResolvedValue([
      { config: null },
      { config: "not an object" },
      { config: [] },
      { config: { helpRequest: "yes" } },
      { config: { helpRequest: { enabled: "true" } } },
    ]);
    await expect(organizationOffersHelpRequests("org-a")).resolves.toBe(false);
  });
});
