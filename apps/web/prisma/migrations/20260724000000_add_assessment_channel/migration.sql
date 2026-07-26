-- Add channel column to assessment_sessions
-- Records the delivery channel (whatsapp/web) at session creation time
-- Used for score context in MetricObservation.evidenceRefs

-- Step 1: Add nullable column
ALTER TABLE "assessment_sessions" ADD COLUMN "channel" TEXT;

-- Step 2: Backfill from socio's channelType for existing sessions
UPDATE "assessment_sessions" AS a
SET "channel" = s."channel_type"
FROM "socios" AS s
WHERE a."socio_id" = s."id"
  AND a."channel" IS NULL;

-- Step 3: Set default for any remaining NULL (edge case: orphan sessions)
UPDATE "assessment_sessions"
SET "channel" = 'web'
WHERE "channel" IS NULL;

-- Step 4: Make column NOT NULL now that all rows have values
ALTER TABLE "assessment_sessions" ALTER COLUMN "channel" SET NOT NULL;

-- Step 5: Add default for future inserts
ALTER TABLE "assessment_sessions" ALTER COLUMN "channel" SET DEFAULT 'web';
