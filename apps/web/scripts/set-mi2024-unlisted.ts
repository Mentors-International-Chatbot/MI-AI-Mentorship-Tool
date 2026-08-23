/**
 * D4: MI2024 is unlisted; every other course defaults to listed (see
 * `src/lib/journey-package/listed.ts`). Platform Restructure Phase A, Stage 2.
 *
 * MI2024's ProgramVersion.metadata is null on both its rows as of
 * 2026-08-21 — there is no real JourneyPackage.metadata to preserve or merge
 * into, and this script deliberately does not fabricate one (packageId,
 * title, languages, version are not ours to guess). It writes only the one
 * key this stage's D4 item concerns itself with. This never touches
 * ContentLesson/LessonVersion rows or any `teach`/`teach_back` field — MI2024
 * content stays exactly as frozen (D1).
 *
 * Idempotent: safe to re-run.
 *
 * Run: npx tsx -r dotenv/config scripts/set-mi2024-unlisted.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const collection = await prisma.contentCollection.findFirst({
    where: { slug: 'mi-colombia-curriculum' },
    include: { programVersions: { select: { id: true, version: true, status: true, metadata: true } } },
  });
  if (!collection) {
    console.log('mi-colombia-curriculum collection not found — nothing to do.');
    await prisma.$disconnect();
    return;
  }

  for (const version of collection.programVersions) {
    const existing = version.metadata && typeof version.metadata === 'object' && !Array.isArray(version.metadata)
      ? (version.metadata as Record<string, unknown>)
      : {};
    if (existing.listed === false) {
      console.log(`${version.id} (${version.version}, ${version.status}): already listed:false, skipping`);
      continue;
    }
    await prisma.programVersion.update({
      where: { id: version.id },
      data: { metadata: { ...existing, listed: false } },
    });
    console.log(`${version.id} (${version.version}, ${version.status}): set listed:false`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
