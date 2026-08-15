CREATE TYPE "LearnerProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CHANGED', 'ABANDONED');

CREATE TABLE "learner_projects" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "enrollment_id" TEXT NOT NULL,
  "socio_id" TEXT NOT NULL,
  "preset_key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "one_liner" TEXT NOT NULL,
  "context" TEXT,
  "automation_level" TEXT NOT NULL,
  "interests" TEXT[] NOT NULL,
  "status" "LearnerProjectStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "learner_projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "learner_projects_enrollment_id_fkey"
    FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "learner_projects_organization_id_idx" ON "learner_projects"("organization_id");
CREATE INDEX "learner_projects_socio_id_idx" ON "learner_projects"("socio_id");
CREATE INDEX "learner_projects_enrollment_id_idx" ON "learner_projects"("enrollment_id");

-- Prisma schema syntax cannot represent this partial unique index. Keep it in
-- migration SQL: it preserves history while preventing two current projects.
CREATE UNIQUE INDEX "learner_projects_current_enrollment_key"
  ON "learner_projects"("enrollment_id")
  WHERE "status" IN ('DRAFT', 'ACTIVE');
