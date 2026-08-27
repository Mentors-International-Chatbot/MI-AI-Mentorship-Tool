#!/usr/bin/env npx tsx
/**
 * One-off test learner for a manual AI Essentials Aug-2026 run-through.
 * Not a new enrollment mechanism — creates a Socio + ParticipantProfile the
 * normal way (mirrors devTestLearnerRepo.ts's own upsert pattern) and then
 * enrolls via tenantRepo.resolveOrCreateActiveEnrollment, the same
 * self-serve-web enrollment path the real app uses (tenantPrismaRepo.ts).
 * Logs in through the real /login page with a real password — does not
 * touch /api/auth/test-login, which is hardcoded to the old "ai-essentials"
 * collection slug and refuses any other curriculum by design.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { tenantRepo, createTenantContext } from "../src/lib/repo";

const PHONE = "+10000000002";
const PASSWORD = "runthrough-2026";
const ORG_SLUG = "ai-essentials-verification";
const PROGRAM_VERSION_ID = "969dfa52-58d8-4f01-96b7-2346cedfbdee";

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Organization ${ORG_SLUG} not found`);

  const version = await prisma.programVersion.findUnique({ where: { id: PROGRAM_VERSION_ID } });
  if (!version) throw new Error(`ProgramVersion ${PROGRAM_VERSION_ID} not found`);

  const passwordHash = await hashPassword(PASSWORD);
  const socio = await prisma.socio.upsert({
    where: { whatsappPhoneNumber: PHONE },
    create: {
      whatsappPhoneNumber: PHONE, channelType: "web", externalId: "aug2026-runthrough-learner",
      language: "en", name: "Aug2026 Runthrough Learner", status: "ACTIVE", passwordHash,
      metadata: { synthetic: true, purpose: "aug2026-runthrough" },
    },
    update: { passwordHash, status: "ACTIVE" },
  });
  await prisma.socioProgress.upsert({
    where: { socioId: socio.id }, create: { socioId: socio.id }, update: {},
  });

  const participant = await prisma.participantProfile.upsert({
    where: { socioId: socio.id },
    create: { organizationId: org.id, socioId: socio.id, displayName: socio.name, preferredLang: "en", metadata: { synthetic: true } },
    update: { organizationId: org.id, displayName: socio.name, preferredLang: "en" },
  });

  const ctx = createTenantContext(org.id);
  const enrollment = await tenantRepo.resolveOrCreateActiveEnrollment(ctx, {
    participantId: participant.id, programVersionId: PROGRAM_VERSION_ID, channel: "web",
  });

  console.log(JSON.stringify({
    socioId: socio.id, participantId: participant.id, enrollmentId: enrollment.id,
    organizationId: org.id, programVersionId: PROGRAM_VERSION_ID,
    loginPhone: PHONE, loginPassword: PASSWORD,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
