-- L1.a (Auth & Login Restructure): Principal + both resolvers. See
-- src/lib/auth/principal.ts for the resolvers and the explicit decision on
-- how claim-less (pre-Principal) sessions resolve.
--
-- Additive only — no existing column changes, no drops. Nothing reads or
-- writes this table yet; session issuance starts populating it at L1.b
-- (provider interface), and `resolvePrincipalForSession`'s on-the-fly
-- backfill (also L1.a) starts populating it the first time an existing
-- claim-less session is resolved.

CREATE TABLE "principals" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "socio_id" TEXT,
  "mentor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "principals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "principals_socio_id_fkey"
    FOREIGN KEY ("socio_id") REFERENCES "socios"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "principals_mentor_id_fkey"
    FOREIGN KEY ("mentor_id") REFERENCES "mentors"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "principals_provider_subject_key" ON "principals"("provider", "subject");
CREATE INDEX "principals_socio_id_idx" ON "principals"("socio_id");
CREATE INDEX "principals_mentor_id_idx" ON "principals"("mentor_id");
