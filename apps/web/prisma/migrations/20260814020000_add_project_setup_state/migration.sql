ALTER TABLE "learner_projects"
  ALTER COLUMN "preset_key" DROP NOT NULL,
  ALTER COLUMN "title" DROP NOT NULL,
  ALTER COLUMN "one_liner" DROP NOT NULL,
  ALTER COLUMN "automation_level" DROP NOT NULL,
  ADD COLUMN "life_context" TEXT,
  ADD COLUMN "reframed_at" TIMESTAMP(3),
  ADD COLUMN "automation_validated_at" TIMESTAMP(3);

-- A picker-complete DRAFT knows only its interests. Once a project is active
-- (or retained as changed history), every learner-visible project field must
-- be present. The tenant repo separately requires the server-owned automation
-- gate for new DRAFT -> ACTIVE transitions, without invalidating older rows.
ALTER TABLE "learner_projects"
  ADD CONSTRAINT "learner_projects_complete_when_committed_check"
  CHECK (
    "status" NOT IN ('ACTIVE', 'CHANGED')
    OR (
      "preset_key" IS NOT NULL
      AND length(btrim("preset_key")) > 0
      AND "title" IS NOT NULL
      AND length(btrim("title")) > 0
      AND "one_liner" IS NOT NULL
      AND length(btrim("one_liner")) > 0
      AND "automation_level" IN ('L1', 'L2', 'L3')
    )
  ) NOT VALID;
