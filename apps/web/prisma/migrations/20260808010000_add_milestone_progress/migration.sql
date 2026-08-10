-- Per-participant milestone attainment.
--
-- `outcome.milestones` (ProgramVersion.config) declares which milestones a
-- course has and where each becomes checkable. This records that a specific
-- participant reached one.
--
-- Separate from lesson_progress on purpose: completing a lesson means the
-- learner was TAUGHT something; reaching a milestone means they DID something.
-- Before this table there was no signal of the second kind anywhere — the
-- system knew what a learner had been taught and how well they articulated it,
-- and nothing about whether they had attempted anything.


-- CreateTable
CREATE TABLE "milestone_progress" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "collection_key" TEXT NOT NULL,
    "milestone_key" TEXT NOT NULL,
    "reached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'ai_marker',
    "evidence" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestone_progress_organization_id_idx" ON "milestone_progress"("organization_id");

-- CreateIndex
CREATE INDEX "milestone_progress_socio_id_collection_key_idx" ON "milestone_progress"("socio_id", "collection_key");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_progress_socio_id_collection_key_milestone_key_key" ON "milestone_progress"("socio_id", "collection_key", "milestone_key");

-- AddForeignKey
ALTER TABLE "milestone_progress" ADD CONSTRAINT "milestone_progress_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

