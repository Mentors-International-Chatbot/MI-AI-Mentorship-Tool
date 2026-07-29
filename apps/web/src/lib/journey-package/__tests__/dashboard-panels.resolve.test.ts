/**
 * resolveDashboardPanels — fail-closed on an unresolved tenant
 * ----------------------------------------------------------------------------
 * A tier-3 org resolution names DEFAULT_ORGANIZATION_ID, not the socio's
 * organization. Looking up a collection by slug inside it would read a
 * different tenant's panel config, so the resolver must decline before issuing
 * any query. Generic panels are an acceptable degradation; cross-tenant config
 * is not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  contentCollection: {
    findUnique: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

// Import AFTER mocking
import { resolveDashboardPanels, DEFAULT_DASHBOARD_PANELS } from "../dashboard-panels";

const ORG_ID = "org-0000-0000-0000-000000000001";
const SOCIO_ID = "soci-0000-0000-0000-000000000001";
const SLUG = "intro-course";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("resolveDashboardPanels — source 'default' fails closed", () => {
  it("returns the default panels without querying the collection", async () => {
    const result = await resolveDashboardPanels(
      { organizationId: ORG_ID, source: "default", socioId: SOCIO_ID },
      SLUG,
    );

    expect(result.panels).toEqual(DEFAULT_DASHBOARD_PANELS);
    expect(result.lessonCount).toBe(0);
    expect(mockPrisma.contentCollection.findUnique).not.toHaveBeenCalled();
  });

  it("declines even when a collection key is present and would have matched", async () => {
    mockPrisma.contentCollection.findUnique.mockResolvedValue({
      _count: { lessons: 28 },
      programVersions: [
        { config: { dashboard: { panels: [{ type: "financial_snapshots" }] } } },
      ],
    });

    const result = await resolveDashboardPanels(
      { organizationId: ORG_ID, source: "default", socioId: SOCIO_ID },
      SLUG,
    );

    // The other tenant's financial_snapshots panel must not leak through.
    expect(result.panels).toEqual(DEFAULT_DASHBOARD_PANELS);
    expect(mockPrisma.contentCollection.findUnique).not.toHaveBeenCalled();
  });

  it("warns with the socio id so the mis-resolution is visible", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await resolveDashboardPanels(
      { organizationId: ORG_ID, source: "default", socioId: SOCIO_ID },
      SLUG,
    );

    const message = warn.mock.calls.map((args) => String(args[0])).join("\n");
    expect(message).toContain(SOCIO_ID);
    expect(message).toContain("unresolved");
  });
});

describe("resolveDashboardPanels — authoritative sources still query", () => {
  it("reads the collection when the org came from a ParticipantProfile", async () => {
    mockPrisma.contentCollection.findUnique.mockResolvedValue({
      _count: { lessons: 28 },
      programVersions: [
        { config: { dashboard: { panels: [{ type: "weekly_summary" }] } } },
      ],
    });

    const result = await resolveDashboardPanels(
      { organizationId: ORG_ID, source: "participant_profile", socioId: SOCIO_ID },
      SLUG,
    );

    expect(mockPrisma.contentCollection.findUnique).toHaveBeenCalledTimes(1);
    expect(result.panels).toEqual([{ type: "weekly_summary" }]);
    expect(result.lessonCount).toBe(28);
  });

  it("scopes the lookup by the organizationId_slug composite", async () => {
    mockPrisma.contentCollection.findUnique.mockResolvedValue(null);

    await resolveDashboardPanels(
      { organizationId: ORG_ID, source: "collection_key", socioId: SOCIO_ID },
      SLUG,
    );

    expect(mockPrisma.contentCollection.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_slug: { organizationId: ORG_ID, slug: SLUG } },
      }),
    );
  });

  it("falls back to defaults but keeps lessonCount when nothing is published", async () => {
    mockPrisma.contentCollection.findUnique.mockResolvedValue({
      _count: { lessons: 12 },
      programVersions: [],
    });

    const result = await resolveDashboardPanels(
      { organizationId: ORG_ID, source: "collection_key", socioId: SOCIO_ID },
      SLUG,
    );

    expect(result.panels).toEqual(DEFAULT_DASHBOARD_PANELS);
    expect(result.lessonCount).toBe(12);
  });

  it("falls back to defaults and warns when the stored config is malformed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPrisma.contentCollection.findUnique.mockResolvedValue({
      _count: { lessons: 5 },
      programVersions: [
        { config: { dashboard: { panels: [{ type: "not_a_real_panel" }] } } },
      ],
    });

    const result = await resolveDashboardPanels(
      { organizationId: ORG_ID, source: "collection_key", socioId: SOCIO_ID },
      SLUG,
    );

    expect(result.panels).toEqual(DEFAULT_DASHBOARD_PANELS);
    expect(result.lessonCount).toBe(5);
    expect(warn.mock.calls.map((args) => String(args[0])).join("\n")).toContain(SLUG);
  });
});
