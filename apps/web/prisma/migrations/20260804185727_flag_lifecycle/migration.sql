-- AlterTable
ALTER TABLE "socio_flags" ADD COLUMN     "disposition" TEXT,
ADD COLUMN     "last_occurred_at" TIMESTAMP(3),
ADD COLUMN     "occurrence_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "reason_code" TEXT,
ADD COLUMN     "reason_params" JSONB,
ADD COLUMN     "snoozed_until" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "flag_events" (
    "id" TEXT NOT NULL,
    "flag_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "disposition" TEXT,
    "note" TEXT,
    "linked_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flag_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flag_events_flag_id_created_at_idx" ON "flag_events"("flag_id", "created_at");

-- CreateIndex
CREATE INDEX "socio_flags_status_level_created_at_idx" ON "socio_flags"("status", "level", "created_at");

-- AddForeignKey
ALTER TABLE "flag_events" ADD CONSTRAINT "flag_events_flag_id_fkey" FOREIGN KEY ("flag_id") REFERENCES "socio_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "system_prompts_organization_id_collection_key_category_active_i" RENAME TO "system_prompts_organization_id_collection_key_category_acti_idx";

