-- DropIndex
DROP INDEX "assessment_sessions_enrollment_id_lesson_key_attempt_number_key";

-- CreateIndex
CREATE UNIQUE INDEX "assessment_sessions_enrollment_id_lesson_key_block_id_attem_key" ON "assessment_sessions"("enrollment_id", "lesson_key", "block_id", "attempt_number");

-- NOTE: `prisma migrate diff` also generated two statements unrelated to
-- this change, from pre-existing drift between schema.prisma and this dev
-- branch's actual DB (not introduced by this session — schema.prisma
-- already declares Socio.language @default("en") on HEAD, with no migration
-- in this repo's history that ever applied it; the live column is still
-- 'es' from 00000000000000_init). Deliberately NOT included here — an
-- unreviewed live-column-default change and an index rename have nothing to
-- do with the AssessmentSession fix and were stripped by hand:
--   ALTER TABLE "socios" ALTER COLUMN "language" SET DEFAULT 'en';
--   ALTER INDEX "lti_grade_deliveries_resource_link_id_socio_id_milestone_count_" RENAME TO "lti_grade_deliveries_resource_link_id_socio_id_milestone_co_key";
