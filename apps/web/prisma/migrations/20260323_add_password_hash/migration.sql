-- Add password_hash to socios and mentors
ALTER TABLE "socios" ADD COLUMN "password_hash" TEXT;
ALTER TABLE "mentors" ADD COLUMN "password_hash" TEXT;
