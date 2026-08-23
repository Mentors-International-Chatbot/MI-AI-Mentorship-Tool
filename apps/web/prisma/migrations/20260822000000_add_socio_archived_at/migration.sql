-- Platform Restructure Phase A, Stage 3 (A.3).
--
-- Soft-archive marker for Socio. Not a Socio.status (OnboardingStatus enum)
-- value: that enum is the onboarding funnel (NEW..ACTIVE), a closed set
-- exhaustively matched by switch statements elsewhere (onboarding/service.ts).
-- Account-lifecycle archival is a separate concern from onboarding progress,
-- so it gets its own nullable timestamp -- the same soft-state convention
-- already used throughout this schema (completedAt, resolvedAt, reachedAt).
ALTER TABLE "socios" ADD COLUMN "archived_at" TIMESTAMP(3);
