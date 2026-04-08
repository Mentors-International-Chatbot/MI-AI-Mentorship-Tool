-- CreateTable
CREATE TABLE "socio_feedback" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "lesson_num" INTEGER NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "socio_feedback_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "socio_feedback" ADD CONSTRAINT "socio_feedback_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
