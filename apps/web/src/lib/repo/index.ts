import { prismaRepo } from "./prismaRepo";
import { tenantPrismaRepo } from "./tenantPrismaRepo";

// Legacy repo - does NOT enforce tenant isolation
// Use only for legacy Socio/Message flows until migrated to Phase 1 domain model
export const repo = prismaRepo;

// Tenant-scoped repo - ENFORCES tenant isolation at app layer
// All Phase 1 domain model operations MUST go through this
export const tenantRepo = tenantPrismaRepo;

// Re-export tenant context utilities
export { createTenantContext, isTenantContext, TenantIsolationError } from "./tenantContext";
export type { TenantContext } from "./tenantContext";
