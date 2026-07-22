/**
 * Backfill Curriculum Collection Key
 * ═══════════════════════════════════════════════════════════════════════════
 * One-time script to set curriculumCollectionKey = 'mi-colombia-curriculum'
 * for all socios who currently have NULL.
 *
 * This enables removing the DEFAULT_COLLECTION_KEY fallback in the codebase,
 * converting missing-key from silent MI behavior to an explicit error.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/backfill-curriculum-key.ts
 *
 * Idempotent: safe to run multiple times.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Configure Neon for Node.js environment
neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  console.error('[Backfill] DATABASE_URL not set. Check your .env file.');
  process.exit(1);
}

const DEFAULT_COLLECTION_KEY = 'mi-colombia-curriculum';

async function main() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    // Count socios without curriculum key
    const countBefore = await prisma.socio.count({
      where: { curriculumCollectionKey: null },
    });

    console.log(`[Backfill] Found ${countBefore} socios with NULL curriculumCollectionKey`);

    if (countBefore === 0) {
      console.log('[Backfill] Nothing to backfill. All socios already have a curriculum key.');
      return;
    }

    // Update all NULL to default
    const result = await prisma.socio.updateMany({
      where: { curriculumCollectionKey: null },
      data: { curriculumCollectionKey: DEFAULT_COLLECTION_KEY },
    });

    console.log(`[Backfill] Updated ${result.count} socios to '${DEFAULT_COLLECTION_KEY}'`);

    // Verify
    const countAfter = await prisma.socio.count({
      where: { curriculumCollectionKey: null },
    });

    console.log(`[Backfill] Remaining socios with NULL: ${countAfter}`);

    if (countAfter === 0) {
      console.log('[Backfill] Success! All socios now have a curriculum key.');
    } else {
      console.warn('[Backfill] Warning: Some socios still have NULL. Check for concurrent inserts.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
