import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/adminGuard";
import { prisma } from "@/lib/db";
import { resolveDelivery } from "@/lib/journey-package/delivery";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;
  try {
    const body = await req.json() as {
      organizationId?: string; issuer?: string; clientId?: string; authorizationUrl?: string;
      tokenUrl?: string; jwksUrl?: string; deploymentId?: string; contextId?: string;
      programVersionId?: string; cohortId?: string; title?: string;
    };
    for (const field of ["organizationId", "issuer", "clientId", "authorizationUrl", "tokenUrl", "jwksUrl", "deploymentId", "contextId", "programVersionId", "cohortId"] as const) {
      if (!body[field]) return NextResponse.json({ error: `Missing ${field}` }, { status: 400 });
    }
    for (const value of [body.issuer!, body.authorizationUrl!, body.tokenUrl!, body.jwksUrl!]) new URL(value);
    const [version, cohort] = await Promise.all([
      prisma.programVersion.findUnique({ where: { id: body.programVersionId! }, include: { program: true } }),
      prisma.cohort.findUnique({ where: { id: body.cohortId! }, include: { program: true } }),
    ]);
    if (!version || !cohort || version.program.organizationId !== body.organizationId || cohort.program.organizationId !== body.organizationId || cohort.programId !== version.programId) {
      return NextResponse.json({ error: "Program version, cohort, and organization must share one tenant" }, { status: 400 });
    }
    const delivery = resolveDelivery(version.metadata);
    if (version.status !== "published" || delivery.surface !== "player" || !delivery.supportedChannels.includes("canvas")) {
      return NextResponse.json({ error: "Program version must be a published Canvas-supported player course" }, { status: 400 });
    }
    const platform = await prisma.ltiPlatform.upsert({
      where: { issuer_clientId: { issuer: body.issuer!, clientId: body.clientId! } },
      create: { organizationId: body.organizationId!, issuer: body.issuer!, clientId: body.clientId!, authorizationUrl: body.authorizationUrl!, tokenUrl: body.tokenUrl!, jwksUrl: body.jwksUrl! },
      update: { organizationId: body.organizationId!, authorizationUrl: body.authorizationUrl!, tokenUrl: body.tokenUrl!, jwksUrl: body.jwksUrl!, active: true },
    });
    const deployment = await prisma.ltiDeployment.upsert({
      where: { platformId_deploymentId: { platformId: platform.id, deploymentId: body.deploymentId! } },
      create: { platformId: platform.id, deploymentId: body.deploymentId! }, update: { active: true },
    });
    const context = await prisma.ltiContext.upsert({
      where: { deploymentId_contextId: { deploymentId: deployment.id, contextId: body.contextId! } },
      create: { deploymentId: deployment.id, contextId: body.contextId!, organizationId: body.organizationId!, programVersionId: version.id, cohortId: cohort.id, title: body.title },
      update: { organizationId: body.organizationId!, programVersionId: version.id, cohortId: cohort.id, title: body.title },
    });
    await prisma.auditLog.create({ data: { actorId: auth.session.userId, action: "configured_lti_registration", targetType: "lti_context", targetId: context.id, metadata: { platformId: platform.id, deploymentId: deployment.id } } });
    return NextResponse.json({ platformId: platform.id, deploymentId: deployment.id, contextId: context.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid LTI registration" }, { status: 400 });
  }
}
