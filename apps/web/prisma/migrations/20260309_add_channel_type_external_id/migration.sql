-- Make whatsapp_phone_number optional (nullable)
ALTER TABLE "socios" ALTER COLUMN "whatsapp_phone_number" DROP NOT NULL;

-- Add channel_type and external_id columns
ALTER TABLE "socios" ADD COLUMN "channel_type" TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE "socios" ADD COLUMN "external_id" TEXT NOT NULL DEFAULT '';

-- Backfill external_id from whatsapp_phone_number for existing rows
UPDATE "socios" SET "external_id" = "whatsapp_phone_number" WHERE "whatsapp_phone_number" IS NOT NULL;

-- Add compound unique constraint
CREATE UNIQUE INDEX "socios_channel_external_id_key" ON "socios"("channel_type", "external_id");
