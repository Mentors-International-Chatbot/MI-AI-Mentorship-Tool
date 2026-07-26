-- CreateEnum
CREATE TYPE "AssessmentSessionStatus" AS ENUM ('pending', 'in_progress', 'completed');

-- CreateTable
CREATE TABLE "assessment_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "lesson_key" TEXT NOT NULL,
    "block_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'teach_back',
    "status" "AssessmentSessionStatus" NOT NULL DEFAULT 'pending',
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "turn_count" INTEGER NOT NULL DEFAULT 0,
    "live_state" JSONB,
    "scores" JSONB,
    "passed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "config_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_sessions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "assessment_session_id" TEXT;
ALTER TABLE "messages" ADD COLUMN "metadata" JSONB;

-- CreateIndex
CREATE INDEX "assessment_sessions_socio_id_status_idx" ON "assessment_sessions"("socio_id", "status");

-- CreateIndex
CREATE INDEX "assessment_sessions_organization_id_idx" ON "assessment_sessions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_sessions_socio_id_lesson_key_attempt_number_key" ON "assessment_sessions"("socio_id", "lesson_key", "attempt_number");

-- CreateIndex
CREATE INDEX "messages_assessment_session_id_created_at_idx" ON "messages"("assessment_session_id", "created_at");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_assessment_session_id_fkey" FOREIGN KEY ("assessment_session_id") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
