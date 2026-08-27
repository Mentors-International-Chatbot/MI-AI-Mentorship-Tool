import { prisma } from './src/lib/db';

async function main() {
  console.log('DB host:', new URL(process.env.DATABASE_URL as string).host);

  const rows = await prisma.contentCollection.findMany({
    where: { slug: 'ai-essentials-aug2026' },
    include: {
      organization: { select: { slug: true, settings: true } },
      programVersions: { select: { version: true, status: true, publishedAt: true } },
      _count: { select: { lessons: true } },
    },
  });

  console.log(JSON.stringify(rows, null, 2));
}

main().finally(() => prisma.$disconnect());
