-- AlterTable
ALTER TABLE "socio_progress" ADD COLUMN "reminders_sent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "socio_progress" ADD COLUMN "last_interaction_at" TIMESTAMP(3);
