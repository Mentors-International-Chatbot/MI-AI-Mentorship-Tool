import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `select bp.enrollment_id, bp.socio_id, bp.lesson_key, count(*) from block_progress bp where bp.lesson_key = 'lesson-1' group by 1,2,3`,
  );
  console.log("lesson-1 groups", rows);

  const enrollmentIds = [...new Set(rows.map((r) => r.enrollment_id).filter(Boolean))];
  for (const id of enrollmentIds) {
    const e = await prisma.enrollment.findUnique({ where: { id }, include: { participant: { include: { socio: true } } } });
    console.log(id, "->", e?.participant.socio?.whatsappPhoneNumber, e?.participant.socio?.name);
  }
}
main().finally(() => prisma.$disconnect());
