-- CreateTable
CREATE TABLE "socio_progress" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "current_lesson_number" INTEGER NOT NULL DEFAULT 1,
    "current_message_index" INTEGER NOT NULL DEFAULT 0,
    "completed_lessons" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "weekly_understanding" INTEGER,
    "weekly_implementation" INTEGER,
    "last_lesson_completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "socio_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "socio_progress_socio_id_key" ON "socio_progress"("socio_id");

-- AddForeignKey
ALTER TABLE "socio_progress" ADD CONSTRAINT "socio_progress_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
