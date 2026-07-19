/**
 * TenantContext - Required context for all tenant-scoped repository operations.
 *
 * This type MUST be passed as the first parameter to any repo method that
 * touches a tenant-owned table. This is a compile-time enforcement mechanism.
 *
 * Phase 2: organizationId is the primary isolation boundary.
 * Future: May extend with programId/cohortId for finer scoping.
 */
export type TenantContext = {
  /** The organization ID - required for all tenant-scoped operations */
  readonly organizationId: string;
  /** Optional program ID for program-scoped operations */
  readonly programId?: string;
  /** Optional cohort ID for cohort-scoped operations */
  readonly cohortId?: string;
};

/**
 * Creates a validated TenantContext.
 * Throws if organizationId is missing or invalid.
 */
export function createTenantContext(organizationId: string, opts?: {
  programId?: string;
  cohortId?: string;
}): TenantContext {
  if (!organizationId || typeof organizationId !== 'string') {
    throw new Error('TenantContext: organizationId is required');
  }
  return {
    organizationId,
    programId: opts?.programId,
    cohortId: opts?.cohortId,
  };
}

/**
 * Type guard to verify a value is a valid TenantContext.
 * Used at runtime boundaries (API routes, etc).
 */
export function isTenantContext(value: unknown): value is TenantContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'organizationId' in value &&
    typeof (value as TenantContext).organizationId === 'string' &&
    (value as TenantContext).organizationId.length > 0
  );
}

/**
 * Error thrown when a tenant context mismatch is detected.
 * This indicates a cross-tenant access attempt.
 */
export class TenantIsolationError extends Error {
  constructor(message: string, public readonly context?: {
    requestedOrgId?: string;
    actualOrgId?: string;
    resourceType?: string;
    resourceId?: string;
  }) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}
