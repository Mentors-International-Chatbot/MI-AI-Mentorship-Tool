export type PublishedPlayerVersionCandidate = {
  program: {
    organizationId: string;
    organization: { settings: unknown };
  };
};

function isSynthetic(candidate: PublishedPlayerVersionCandidate): boolean {
  const settings = candidate.program.organization.settings;
  return !!settings && typeof settings === "object" && !Array.isArray(settings)
    && (settings as Record<string, unknown>).syntheticDataOnly === true;
}

/**
 * Selects the sole tenant-safe published candidate.
 *
 * Anchored learners may see only their organization. Unanchored direct-web
 * learners may see only non-synthetic versions, and ambiguity fails closed.
 */
export function selectPublishedPlayerVersion<T extends PublishedPlayerVersionCandidate>(
  candidates: readonly T[],
  participantOrganizationId?: string,
): T | null {
  const eligible = candidates.filter((candidate) => participantOrganizationId
    ? candidate.program.organizationId === participantOrganizationId
    : !isSynthetic(candidate));
  return eligible.length === 1 ? eligible[0] : null;
}
