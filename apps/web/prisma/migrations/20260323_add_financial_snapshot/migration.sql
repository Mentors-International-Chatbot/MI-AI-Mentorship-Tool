-- CreateTable
CREATE TABLE "financial_snapshots" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "week_start_date" TIMESTAMP(3) NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL,
    "net_profit" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai_marker',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_snapshot_socio_week_key" ON "financial_snapshots"("socio_id", "week_start_date");

-- AddForeignKey
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
