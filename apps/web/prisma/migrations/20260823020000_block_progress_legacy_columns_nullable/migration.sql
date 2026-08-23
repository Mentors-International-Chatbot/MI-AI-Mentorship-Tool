-- Platform Restructure Phase A, Stage 6 (A.6 closing cleanup).
--
-- A.6's FINAL-step investigation found BlockProgress.socioId/collectionKey
-- are NOT safe to drop yet — learnerProjectSelectionRequired's grandfathering
-- check and the LTI instructor overview both still read them directly.
-- Deferred to Phase A.7.
--
-- What IS safe now: BlockProgress has exactly one writer in the whole
-- codebase (recordPlayerTutorSuccess/completeBlock/markTeachBackComplete in
-- player/service.ts — confirmed by a full-codebase grep, no chat-surface
-- writer exists for this table), and that writer's own reads moved to
-- enrollmentId in A.6.1's addendum. So it can stop populating these two
-- columns on new rows without touching anything load-bearing. Old rows keep
-- whatever value they already had — this is a going-forward change only.
--
-- socioId's FK (block_progress_socio_id_fkey) already allows null by default
-- once the column itself does; no separate constraint change needed there.
ALTER TABLE "block_progress" ALTER COLUMN "socio_id" DROP NOT NULL;
ALTER TABLE "block_progress" ALTER COLUMN "collection_key" DROP NOT NULL;
