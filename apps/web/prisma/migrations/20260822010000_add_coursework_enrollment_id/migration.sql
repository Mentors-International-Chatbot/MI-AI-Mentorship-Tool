-- Platform Restructure Phase A, Stage 4 (A.4).
--
-- Nullable enrollmentId on the three coursework tables cleared for backfill
-- (BlockProgress, MilestoneProgress, AssessmentSession). SocioFeedback is
-- deliberately excluded — see the comment at its writer in
-- messaging/handler.ts for why. Legacy columns (socioId, collectionKey,
-- lessonKey) are kept; drops are A.6, a later separate migration.
--
-- No data UPDATE in this file. The backfill itself runs via
-- scripts/backfill-phase-a4.ts (Prisma Client, per-row, reviewable) rather
-- than raw SQL — the AssessmentSession join (lessonKey -> ContentLesson ->
-- collection, narrowed by the owning socio's curriculumCollectionKey) is
-- complex enough that a TypeScript script is safer to verify than a single
-- multi-join UPDATE statement, matching how the A.3 socio backfill was done.

ALTER TABLE "block_progress" ADD COLUMN "enrollment_id" TEXT;
ALTER TABLE "block_progress" ADD CONSTRAINT "block_progress_enrollment_id_fkey"
  FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "block_progress_enrollment_id_idx" ON "block_progress"("enrollment_id");

ALTER TABLE "milestone_progress" ADD COLUMN "enrollment_id" TEXT;
ALTER TABLE "milestone_progress" ADD CONSTRAINT "milestone_progress_enrollment_id_fkey"
  FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "milestone_progress_enrollment_id_idx" ON "milestone_progress"("enrollment_id");

ALTER TABLE "assessment_sessions" ADD COLUMN "enrollment_id" TEXT;
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_enrollment_id_fkey"
  FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "assessment_sessions_enrollment_id_idx" ON "assessment_sessions"("enrollment_id");
