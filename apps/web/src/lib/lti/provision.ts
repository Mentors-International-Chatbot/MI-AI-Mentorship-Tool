import { createHash, randomBytes } from "node:crypto";
import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";
import { hashBearerToken } from "@/lib/auth/requestIdentity";

type LaunchClaims = Record<string, unknown>;
const learnerRole = (roles: string[]) => roles.some((role) => role.endsWith("/Learner"));
const instructorRole = (roles: string[]) => roles.some((role) => role.endsWith("/Instructor") || role.endsWith("/TeachingAssistant"));

export async function provisionLaunch(params: {
  platformId: string; subject: string; contextId: string; roles: string[]; claims: LaunchClaims;
}) {
  const { platformId, subject, contextId, roles, claims } = params;
  const context = await ltiRuntimeRepo.ltiContext.findUnique({ where: { id: contextId }, include: { programVersion: { include: { collection: true } } } });
  if (!context?.programVersion.collection) throw new Error("Configured LTI context has no collection");
  const names = claims.name ?? claims.given_name ?? "Canvas user";
  const displayName = typeof names === "string" ? names : "Canvas user";
  let identity = await ltiRuntimeRepo.ltiIdentity.upsert({
    where: { platformId_subject: { platformId, subject } },
    create: { platformId, subject }, update: {},
  });
  if (learnerRole(roles)) {
    if (!identity.socioId) {
      const externalId = `${platformId}:${subject}`;
      const socio = await ltiRuntimeRepo.socio.upsert({
        where: { channelType_externalId: { channelType: "canvas", externalId } },
        create: { channelType: "canvas", externalId, language: String(claims.locale ?? "en").split(/[-_]/)[0], name: displayName, status: "ACTIVE", curriculumCollectionKey: context.programVersion.collection.slug },
        update: { name: displayName, status: "ACTIVE", curriculumCollectionKey: context.programVersion.collection.slug },
      });
      identity = await ltiRuntimeRepo.ltiIdentity.update({ where: { id: identity.id }, data: { socioId: socio.id } });
    }
    const socioId = identity.socioId!;
    await ltiRuntimeRepo.socio.update({ where: { id: socioId }, data: { curriculumCollectionKey: context.programVersion.collection.slug, name: displayName, status: "ACTIVE" } });
    const existingParticipant = await ltiRuntimeRepo.participantProfile.findUnique({ where: { socioId } });
    if (existingParticipant && existingParticipant.organizationId !== context.organizationId) throw new Error("Canvas identity is already bound to another OCI tenant");
    const participant = existingParticipant ?? await ltiRuntimeRepo.participantProfile.create({
      data: { organizationId: context.organizationId, socioId, displayName, preferredLang: String(claims.locale ?? "en").split(/[-_]/)[0] },
    });
    await ltiRuntimeRepo.enrollment.upsert({
      where: { participantId_cohortId: { participantId: participant.id, cohortId: context.cohortId } },
      create: { participantId: participant.id, cohortId: context.cohortId, programVersionId: context.programVersionId, metadata: { channel: "canvas" } },
      update: { status: "active", programVersionId: context.programVersionId },
    });
  }
  if (instructorRole(roles) && !identity.mentorId) {
    const identityHash = createHash("sha256").update(`${platformId}:${subject}`).digest("hex").slice(0, 32);
    const syntheticEmail = `lti-${identityHash}@invalid.local`;
    const mentor = await ltiRuntimeRepo.mentor.create({ data: { name: displayName, email: syntheticEmail, role: "mentor" } });
    await ltiRuntimeRepo.mentorProfile.create({ data: { organizationId: context.organizationId, mentorId: mentor.id, displayName, metadata: { lti: true } } });
    identity = await ltiRuntimeRepo.ltiIdentity.update({ where: { id: identity.id }, data: { mentorId: mentor.id } });
  }
  if (!identity.socioId && !identity.mentorId) throw new Error("Launch has no supported learner or instructor role");
  await Promise.all([
    ...(learnerRole(roles) ? [ltiRuntimeRepo.ltiEnrollment.upsert({ where: { identityId_contextId_role: { identityId: identity.id, contextId, role: "learner" } }, create: { identityId: identity.id, contextId, role: "learner" }, update: {} })] : []),
    ...(instructorRole(roles) ? [ltiRuntimeRepo.ltiEnrollment.upsert({ where: { identityId_contextId_role: { identityId: identity.id, contextId, role: "instructor" } }, create: { identityId: identity.id, contextId, role: "instructor" }, update: {} })] : []),
  ]);
  return identity;
}

export async function createLtiSession(identityId: string, contextId: string, role: "learner" | "instructor", destination: string, launchData?: object) {
  const bearerToken = randomBytes(32).toString("base64url");
  const exchangeToken = randomBytes(32).toString("base64url");
  await ltiRuntimeRepo.ltiSession.create({ data: {
    tokenHash: hashBearerToken(bearerToken), exchangeTokenHash: hashBearerToken(exchangeToken),
    identityId, contextId, role, destination, expiresAt: new Date(Date.now() + 4 * 60 * 60_000), launchData,
  } });
  return { bearerToken, exchangeToken };
}

export async function exchangeLtiSession(exchangeToken: string) {
  const row = await ltiRuntimeRepo.ltiSession.findUnique({ where: { exchangeTokenHash: hashBearerToken(exchangeToken) } });
  if (!row || row.exchangedAt || row.expiresAt <= new Date()) return null;
  const bearerToken = randomBytes(32).toString("base64url");
  const claimed = await ltiRuntimeRepo.ltiSession.updateMany({
    where: { id: row.id, exchangedAt: null, expiresAt: { gt: new Date() } },
    data: { exchangedAt: new Date(), tokenHash: hashBearerToken(bearerToken) },
  });
  return claimed.count === 1 ? { bearerToken, destination: row.destination } : null;
}
