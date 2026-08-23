-- Platform Restructure Phase A, Stage 2 (A.2).
--
-- Denormalized course identity on enrollments, derived from
-- program_version_id -> program_versions.collection_id -> content_collections.slug.
-- The FK chain is direct (program_versions.collection_id points straight at
-- content_collections; it does NOT pass through programs) and confirmed live
-- 2026-08-21: 11 program_version rows across 4 real collections (2, 2, 5, 1
-- versions respectively) plus one dangling draft with collection_id NULL.
--
-- Kept in sync going forward exclusively by
-- resolveOrCreateActiveEnrollment (src/lib/repo/tenantPrismaRepo.ts) — the
-- one shared enrollment-creation path from Stage 1. No other writer may set
-- this column.
ALTER TABLE "enrollments" ADD COLUMN "collection_key" TEXT;

-- One-time backfill for the 10 enrollment rows that predate this column.
-- The 3 rows pinned to the dangling draft ProgramVersion (collection_id
-- NULL) get collection_key = NULL, same as their programVersionId is
-- already an orphaned pointer — this migration does not attempt to repair
-- them. That is Michael's explicit decision, deferred to A.3.
UPDATE "enrollments" e
SET "collection_key" = cc."slug"
FROM "program_versions" pv
LEFT JOIN "content_collections" cc ON cc."id" = pv."collection_id"
WHERE e."program_version_id" = pv."id";

-- Prisma schema syntax cannot represent a partial unique index. Keep it in
-- migration SQL, following the learner_projects_current_enrollment_key
-- precedent (20260814010000_add_learner_projects/migration.sql).
--
-- Enforces one ACTIVE enrollment per (learner, course) -- D2 -- not per
-- (learner, program_version). A course spans multiple published/archived
-- ProgramVersion rows over time, and enrollments are version-PINNED
-- (Platform Restructure Phase A, Stage 2 addendum: program_version_id is the
-- authoritative version for that enrollment's lifetime; a learner never
-- floats to a newer version implicitly -- resolvePlayerAccess,
-- resolveLearnerHome, and resolveLearnerDelivery all already resolve through
-- the pinned enrollment row, never a "latest published" query, for anyone
-- who has an active enrollment). Indexing on (participant_id,
-- program_version_id) instead would incorrectly permit two simultaneously
-- ACTIVE enrollments in the same course, one per version -- exactly the gap
-- this index exists to close.
--
-- participant_id, not a separate learner_id: Enrollment has no learner_id
-- column, and ParticipantProfile (participant_id) already identifies the
-- learner within an organization uniquely (Socio.id is @unique on
-- ParticipantProfile.socioId) -- adding a redundant alias column would only
-- create a second name for the same fact.
--
-- No CONCURRENTLY: Prisma's migrate deploy executes each migration file
-- inside a single transaction, and CREATE INDEX CONCURRENTLY cannot run
-- inside one. enrollments has 10 rows as of this migration (confirmed live,
-- 2026-08-21, and confirmed zero (participant_id, collection_key) duplicate
-- ACTIVE pairs before creating this index) -- the brief lock from a plain
-- CREATE UNIQUE INDEX is immaterial at this scale, matching the same
-- non-concurrent choice the learner_projects precedent made.
CREATE UNIQUE INDEX "enrollments_active_participant_course_key"
  ON "enrollments"("participant_id", "collection_key")
  WHERE "status" = 'active';
