-- Course scoping for program config and system prompts.
--
-- Both tables were global singletons: program_config.key was unique
-- platform-wide, and system_prompts had no tenant column at all. Scope columns
-- are nullable so that null means "applies more broadly", and resolution walks
--   (org, collection) -> (org, null) -> (null, null) -> code constant.
-- Every existing row lands on the third tier, so behaviour is unchanged until
-- somebody deliberately adds a narrower override.

-- ── program_config ──────────────────────────────────────────────────────────
DROP INDEX "program_config_key_key";

ALTER TABLE "program_config" ADD COLUMN     "collection_key" TEXT,
ADD COLUMN     "organization_id" TEXT;

-- NULLS NOT DISTINCT (Postgres 15+; this database is 17) is required, not
-- cosmetic. A plain UNIQUE treats every NULL as distinct, so the platform tier
-- (NULL, NULL, key) would accept unlimited duplicate rows for the same key and
-- the reader would pick one arbitrarily. The dropped `key` unique index used to
-- prevent exactly that, and this restores the guarantee at every tier.
CREATE UNIQUE INDEX "program_config_scope_key"
  ON "program_config" ("organization_id", "collection_key", "key") NULLS NOT DISTINCT;

CREATE INDEX "program_config_organization_id_collection_key_idx"
  ON "program_config" ("organization_id", "collection_key");

-- ── system_prompts ──────────────────────────────────────────────────────────
ALTER TABLE "system_prompts" ADD COLUMN     "collection_key" TEXT,
ADD COLUMN     "organization_id" TEXT;

CREATE INDEX "system_prompts_organization_id_collection_key_category_active_idx"
  ON "system_prompts" ("organization_id", "collection_key", "category", "active");

-- ── Retire the unscoped `core` duplicate ────────────────────────────────────
-- Before this migration, core.ts read ONLY `core:{collectionKey}`, so a row with
-- category = 'core' was never loaded. One exists, is marked active, and holds a
-- byte-identical copy of the MI prompt ("Eres el mentor virtual de Mentors
-- International...") — a leftover from when the `core:` convention was added.
--
-- After this migration `core` resolves through the normal tier walk, which would
-- silently promote that dead row to the PLATFORM default and start telling every
-- other course's learners they are talking to Mentors International. Deactivating
-- it is what preserves current behaviour; leaving it is what would change it.
--
-- Runs BEFORE the rename below so it can only ever match the old row.
UPDATE "system_prompts" SET "active" = false
WHERE "category" = 'core' AND "active" = true;

-- ── Promote `category = "core:{collectionKey}"` to real scope columns ────────
-- Postgres evaluates every SET expression against the pre-update row, so reading
-- "category" here still sees the namespaced value.
UPDATE "system_prompts" sp
SET "collection_key" = split_part(sp."category", ':', 2),
    "category"       = split_part(sp."category", ':', 1),
    "organization_id" = (
      SELECT cc."organization_id"
      FROM "content_collections" cc
      WHERE cc."slug" = split_part(sp."category", ':', 2)
      LIMIT 1
    )
WHERE sp."category" LIKE '%:%';

-- NOTE: the remaining unscoped rows (lesson_delivery, freeform, reteach,
-- sentiment, name_extraction) hold MI Spanish text and are deliberately left on
-- the platform tier. They are read globally today, so scoping them here would
-- change what every non-MI course sees. That pre-existing leak is a separate
-- decision for a course lead to make through the UI, not a silent migration.

-- ── program_memberships ─────────────────────────────────────────────────────
CREATE TABLE "program_memberships" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_memberships_program_id_user_id_key"
  ON "program_memberships" ("program_id", "user_id");
CREATE INDEX "program_memberships_user_id_idx" ON "program_memberships" ("user_id");
CREATE INDEX "program_memberships_program_id_idx" ON "program_memberships" ("program_id");

ALTER TABLE "program_memberships"
  ADD CONSTRAINT "program_memberships_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
