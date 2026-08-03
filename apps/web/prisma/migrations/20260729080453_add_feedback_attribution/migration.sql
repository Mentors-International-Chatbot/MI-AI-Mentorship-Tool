-- AlterTable
ALTER TABLE "feedback" ADD COLUMN     "organization_id" TEXT,
ADD COLUMN     "page_path" TEXT,
ADD COLUMN     "role" TEXT,
ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE INDEX "feedback_organization_id_created_at_idx" ON "feedback"("organization_id", "created_at");
