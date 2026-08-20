export type PublishedPlayerVersionCandidate = {
  program: {
    organizationId: string;
    organization: { settings: unknown };
  };
};

function orgSetting(candidate: PublishedPlayerVersionCandidate, key: string): boolean {
  const settings = candidate.program.organization.settings;
  return !!settings && typeof settings === "object" && !Array.isArray(settings)
    && (settings as Record<string, unknown>)[key] === true;
}

function isSynthetic(candidate: PublishedPlayerVersionCandidate): boolean {
  return orgSetting(candidate, "syntheticDataOnly");
}

/**
 * An org opts a course into cross-tenant self-serve testing by setting this on
 * its own `settings`. It only ever widens the unanchored branch below — an
 * already-anchored learner's eligibility is untouched, so it cannot be used to
 * move a learner out of their home organization.
 */
function isOpenEnrollment(candidate: PublishedPlayerVersionCandidate): boolean {
  return orgSetting(candidate, "openEnrollment");
}

/**
 * Selects the sole tenant-safe published candidate.
 *
 * Anchored learners may see only their organization. Unanchored direct-web
 * learners may see only non-synthetic versions, or a synthetic version whose
 * org has explicitly opted into open enrollment, and ambiguity fails closed.
 */
export function selectPublishedPlayerVersion<T extends PublishedPlayerVersionCandidate>(
  candidates: readonly T[],
  participantOrganizationId?: string,
): T | null {
  const eligible = candidates.filter((candidate) => participantOrganizationId
    ? candidate.program.organizationId === participantOrganizationId
    : !isSynthetic(candidate) || isOpenEnrollment(candidate));
  return eligible.length === 1 ? eligible[0] : null;
}
