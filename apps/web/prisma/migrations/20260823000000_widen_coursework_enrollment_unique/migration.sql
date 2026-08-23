-- Platform Restructure Phase A, Stage 6 (A.6.1, A.6.2).
--
-- Widens the identity/uniqueness of BlockProgress, MilestoneProgress, and
-- AssessmentSession from (socioId, collectionKey, ...) to (enrollmentId,
-- ...), dropping socioId/collectionKey from each constraint entirely rather
-- than appending enrollmentId to the existing shape. enrollmentId's FK chain
-- (Enrollment -> ParticipantProfile -> Socio, Enrollment -> collectionKey)
-- already implies both, so this is a narrowing of the identity key, not an
-- independent new fact.
--
-- Legacy socioId/collectionKey columns are NOT dropped here — that is A.6's
-- FINAL step, after 6.1-6.6 all land and their own verifications pass.
--
-- Pre-migration check confirmed zero NULL enrollment_id rows across all
-- three tables (BlockProgress 70/70, MilestoneProgress 0/0, AssessmentSession
-- 9/9 populated), so this widening does not strand any existing row.
--
-- Verified as of this migration: every live write path (player surface via
-- resolvePlayerAccess, which throws before returning PlayerAccess without a
-- real Enrollment) always supplies a real enrollmentId for BlockProgress and
-- AssessmentSession. MilestoneProgress's chat-surface writer
-- (recordMilestoneReached) is best-effort and can still resolve null; its
-- upsert logic (src/lib/repo/prismaRepo.ts) branches around that rather than
-- relying on this unique index when enrollmentId is null, since Postgres
-- does not treat two NULLs as colliding for uniqueness purposes.

-- ── BlockProgress ────────────────────────────────────────────────────────────
DROP INDEX "block_progress_identity_key";
CREATE UNIQUE INDEX "block_progress_identity_key"
  ON "block_progress"("enrollment_id", "lesson_key", "block_id");

-- ── MilestoneProgress ────────────────────────────────────────────────────────
DROP INDEX "milestone_progress_socio_id_collection_key_milestone_key_key";
CREATE UNIQUE INDEX "milestone_progress_enrollment_id_milestone_key_key"
  ON "milestone_progress"("enrollment_id", "milestone_key");

-- ── AssessmentSession (A.6.2) ────────────────────────────────────────────────
DROP INDEX "assessment_sessions_socio_id_lesson_key_attempt_number_key";
CREATE UNIQUE INDEX "assessment_sessions_enrollment_id_lesson_key_attempt_number_key"
  ON "assessment_sessions"("enrollment_id", "lesson_key", "attempt_number");
