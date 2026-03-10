-- Add AWAITING_LANGUAGE to the OnboardingStatus enum
ALTER TYPE "OnboardingStatus" ADD VALUE 'AWAITING_LANGUAGE' BEFORE 'AWAITING_CONSENT';

-- Add language column with default 'es' for existing rows
ALTER TABLE "socios" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'es';
