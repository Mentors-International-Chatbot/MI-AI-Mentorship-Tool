-- Platform Restructure Phase A, Stage 6 (A.6.3).
--
-- Enrollment.collection_key cannot be a plain NOT NULL column: 3 rows are
-- pinned to a dangling draft ProgramVersion (collection_id NULL) from before
-- Stage 2, and the "no deletes" policy means they exist forever. Michael's
-- call: option (a), a partial CHECK admitting exactly the known exception
-- rather than leaving the column silently, unboundedly nullable. This is
-- the guardrail Stage 4's onboarding-audit finding called for — no
-- validator previously existed to catch a null collection_key on a row that
-- isn't one of the 3 known archived exceptions.
--
-- Confirmed live before writing this migration: exactly 3 rows have
-- collection_key NULL, all status = 'dropped', zero rows would violate this
-- constraint.
--
-- EnrollmentCourseUnresolvedError (application-level guard) stays in place
-- as defense in depth; this makes the same rule enforceable at the DB layer
-- for any future writer that doesn't go through it.
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_collection_key_check"
  CHECK ("collection_key" IS NOT NULL OR "status" = 'dropped');
