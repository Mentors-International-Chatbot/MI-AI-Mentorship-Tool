-- CreateTable
CREATE TABLE "ai_invocations" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" TEXT,
    "socio_id" TEXT,
    "assessment_session_id" TEXT,
    "operation" TEXT NOT NULL,
    "mode" TEXT,
    "model" TEXT NOT NULL,
    "prompt_tokens_approx" INTEGER,
    "response_length" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "prompt_version" JSONB NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "prompt_text" TEXT,
    "success" BOOLEAN NOT NULL,
    "error_message" TEXT,

    CONSTRAINT "ai_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_invocations_operation_created_at_idx" ON "ai_invocations"("operation", "created_at");

-- CreateIndex
CREATE INDEX "ai_invocations_socio_id_created_at_idx" ON "ai_invocations"("socio_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_invocations_organization_id_created_at_idx" ON "ai_invocations"("organization_id", "created_at");
