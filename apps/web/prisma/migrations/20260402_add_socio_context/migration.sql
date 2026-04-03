-- CreateTable
CREATE TABLE "socio_contexts" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "business_type" TEXT,
    "products" TEXT,
    "monthly_revenue" TEXT,
    "monthly_expenses" TEXT,
    "num_employees" TEXT,
    "location" TEXT,
    "challenges" TEXT,
    "goals" TEXT,
    "family_context" TEXT,
    "custom_facts" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "socio_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "socio_contexts_socio_id_key" ON "socio_contexts"("socio_id");

-- AddForeignKey
ALTER TABLE "socio_contexts" ADD CONSTRAINT "socio_contexts_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
