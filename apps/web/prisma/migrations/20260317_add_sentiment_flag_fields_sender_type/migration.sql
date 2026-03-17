-- Add senderType to messages
ALTER TABLE "messages" ADD COLUMN "sender_type" TEXT;

-- Add new fields to socio_flags
ALTER TABLE "socio_flags" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'ai_marker';
ALTER TABLE "socio_flags" ADD COLUMN "resolved_by" TEXT;
ALTER TABLE "socio_flags" ADD COLUMN "message_id" TEXT;

-- Create message_sentiments table
CREATE TABLE "message_sentiments" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "confusion" INTEGER NOT NULL,
    "frustration" INTEGER NOT NULL,
    "urgency" INTEGER NOT NULL,
    "sentiment" TEXT NOT NULL,
    "topics" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_sentiments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_sentiments_message_id_key" ON "message_sentiments"("message_id");

-- AddForeignKey
ALTER TABLE "message_sentiments" ADD CONSTRAINT "message_sentiments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_sentiments" ADD CONSTRAINT "message_sentiments_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
