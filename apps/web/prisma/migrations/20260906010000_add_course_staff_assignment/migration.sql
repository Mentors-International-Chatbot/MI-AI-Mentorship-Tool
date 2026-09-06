-- L5 (Auth & Login Restructure) stage 1 of 5 (see
-- reports/l0.2.6-mentorid-reader-classification.md): table + backfill only.
-- Nothing in the application reads this table yet — that is stages 2-4,
-- deliberately separate commits so a wrong roster after the eventual
-- semantic swap tells you which half broke it.
--
-- CourseStaffAssignment is the mirror of Enrollment for mentors: a mentor's
-- membership in a course. Visibility under L10b is the join Enrollment
-- (learner, course) join CourseStaffAssignment(mentor, course) — computed,
-- never a stored pointer. This table is one side of that join.
--
-- MENTOR-only, per L5.2b: an earlier draft carried a role column
-- (MENTOR | COURSE_ADMIN) on "one relation, two roles" reasoning that turned
-- out to be exactly the second-mechanism hazard L5.1 warns against —
-- ProgramMembership already is the course-admin-scope mechanism. See the
-- model's own doc comment in schema.prisma.

CREATE TABLE "course_staff_assignments" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "mentor_id" TEXT NOT NULL,
  "collection_key" TEXT NOT NULL,
  "assigned_by" TEXT NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),

  CONSTRAINT "course_staff_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "course_staff_assignments_mentor_id_fkey"
    FOREIGN KEY ("mentor_id") REFERENCES "mentors"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "course_staff_assignments_organization_id_idx" ON "course_staff_assignments"("organization_id");
CREATE INDEX "course_staff_assignments_collection_key_idx" ON "course_staff_assignments"("collection_key");
CREATE INDEX "course_staff_assignments_mentor_id_idx" ON "course_staff_assignments"("mentor_id");

-- Prisma schema syntax cannot represent this partial unique index. One
-- active assignment per (mentor, course) — an ended assignment (ended_at
-- set) never collides with a fresh one, same "end, don't delete" shape as
-- Enrollment's own history-preserving rule.
CREATE UNIQUE INDEX "course_staff_assignments_active_key"
  ON "course_staff_assignments"("mentor_id", "collection_key")
  WHERE "ended_at" IS NULL;
