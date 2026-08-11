ALTER TABLE "ai_invocations"
  ADD COLUMN "context" JSONB,
  ADD COLUMN "finish_reason" TEXT;

CREATE INDEX "ai_invocations_context_program_version_created_at_idx"
  ON "ai_invocations" (("context" ->> 'programVersionId'), "created_at");
