-- CreateTable
CREATE TABLE "socio_flags" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "socio_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "lesson_number" INTEGER NOT NULL,
    "understanding" INTEGER,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_socio_lesson_key" ON "lesson_progress"("socio_id", "lesson_number");

-- AddForeignKey
ALTER TABLE "socio_flags" ADD CONSTRAINT "socio_flags_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
