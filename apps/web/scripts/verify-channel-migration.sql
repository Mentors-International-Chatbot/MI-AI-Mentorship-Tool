-- Verification script for 20260724000000_add_assessment_channel
-- Run this on a clean Neon branch after applying all migrations

-- 1. Verify column exists with correct properties
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'assessment_sessions' AND column_name = 'channel';

-- Expected: channel | text | NO | 'web'::text

-- 2. Verify no NULL values exist
SELECT COUNT(*) AS null_count
FROM assessment_sessions
WHERE channel IS NULL;

-- Expected: 0

-- 3. Verify all sessions have valid channel values
SELECT channel, COUNT(*) AS session_count
FROM assessment_sessions
GROUP BY channel;

-- Expected: whatsapp and/or web with counts

-- 4. Verify backfill worked (sessions match their socio's channel type)
SELECT
  COUNT(*) FILTER (WHERE a.channel = s.channel_type) AS matching,
  COUNT(*) FILTER (WHERE a.channel != s.channel_type) AS mismatched
FROM assessment_sessions a
JOIN socios s ON a.socio_id = s.id;

-- Expected: all matching, no mismatched (unless orphan sessions defaulted to 'web')
