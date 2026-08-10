-- Drop MentoringRelationship.
--
-- Vestigial, not future: 10 rows, written in a single batch by backfill-phase1
-- on 2026-07-16 and untouched since, with ZERO application readers. Its three
-- repo methods (getMentoringRelationships / createMentoringRelationship /
-- endMentoringRelationship) had no callers outside tenantPrismaRepo.ts.
--
-- The table looked live — role column, activeFrom/activeUntil, a unique
-- constraint — which is precisely the hazard: anyone reading schema.prisma
-- would reasonably assume mentor assignment flows through it. It does not.
-- `Socio.mentorId` is what every authorization path and every mentor-facing
-- list actually reads, and two data-integrity remediations (the
-- ParticipantProfile and MentorProfile backfills) both anchored through
-- mentorId without needing this table at all.
--
-- Leaving it in place while a third socio-creation path (LTI, §6) gets built is
-- how the next batch of invisible learners would have been created.
--
-- The 10 rows are snapshotted at
-- prisma/snapshots/mentoring_relationships_2026-08-08.json before this runs.

-- DropForeignKey
ALTER TABLE "mentoring_relationships" DROP CONSTRAINT "mentoring_relationships_mentor_profile_id_fkey";

-- DropForeignKey
ALTER TABLE "mentoring_relationships" DROP CONSTRAINT "mentoring_relationships_participant_id_fkey";

-- DropTable
DROP TABLE "mentoring_relationships";
