import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";
import { signLtiJwt } from "@/lib/lti/crypto";
import { LTI_DEPLOYMENT_CLAIM, LTI_DL_CONTENT_CLAIM, LTI_DL_DATA_CLAIM, LTI_MESSAGE_TYPE_CLAIM, LTI_VERSION_CLAIM } from "@/lib/lti/constants";

export async function POST(req: NextRequest) {
  try {
    const identity = await resolveRequestIdentity(req);
    if (!identity?.ltiContextId || !identity.mentorId) return NextResponse.json({ error: "Instructor LTI session required" }, { status: 403 });
    const instructorEnrollment = await ltiRuntimeRepo.ltiEnrollment.findFirst({ where: { contextId: identity.ltiContextId, role: "instructor", identity: { mentorId: identity.mentorId } } });
    if (!instructorEnrollment) return NextResponse.json({ error: "Instructor role required" }, { status: 403 });
    const body = await req.json() as { itemIds?: unknown };
    if (!Array.isArray(body.itemIds) || body.itemIds.length === 0 || body.itemIds.some((item) => typeof item !== "string")) return NextResponse.json({ error: "itemIds must be a non-empty string array" }, { status: 400 });
    const context = await ltiRuntimeRepo.ltiContext.findUnique({ where: { id: identity.ltiContextId }, include: { deployment: { include: { platform: true } }, programVersion: { include: { collection: { include: { lessons: true } } } } } });
    const session = identity.ltiSessionId ? await ltiRuntimeRepo.ltiSession.findUnique({ where: { id: identity.ltiSessionId } }) : null;
    const settings = session?.launchData && typeof session.launchData === "object" && !Array.isArray(session.launchData) ? (session.launchData as { deepLinkingSettings?: unknown }).deepLinkingSettings : undefined;
    if (!context?.programVersion.collection || !settings || typeof settings !== "object") throw new Error("Deep Linking launch context expired");
    const returnUrl = (settings as { deep_link_return_url?: unknown }).deep_link_return_url;
    if (typeof returnUrl !== "string") throw new Error("Missing deep_link_return_url");
    const acceptMultiple = (settings as { accept_multiple?: unknown }).accept_multiple === true;
    const uniqueIds = [...new Set(body.itemIds)];
    const ids = acceptMultiple ? uniqueIds : uniqueIds.slice(0, 1);
    const lessonKeys = new Set(context.programVersion.collection.lessons.map((item) => item.slug));
    const base = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    const contentItems = ids.map((id) => {
      if (id === "capstone") return { type: "ltiResourceLink", title: "AI Essentials capstone", url: `${base}/api/lti/launch`, custom: { resource_type: "capstone" }, lineItem: { scoreMaximum: 100, label: "AI Essentials Capstone", resourceId: "aiess-capstone", tag: "aiess-capstone" } };
      if (id.startsWith("lesson:") && lessonKeys.has(id.slice(7))) return { type: "ltiResourceLink", title: `AI Essentials: ${id.slice(7)}`, url: `${base}/api/lti/launch`, custom: { resource_type: "lesson", lesson_key: id.slice(7) } };
      if (id === "course") return { type: "ltiResourceLink", title: "AI Essentials", url: `${base}/api/lti/launch`, custom: { resource_type: "course" } };
      throw new Error(`Unknown catalog item ${id}`);
    });
    const jwt = await signLtiJwt({
      [LTI_DEPLOYMENT_CLAIM]: context.deployment.deploymentId,
      [LTI_VERSION_CLAIM]: "1.3.0",
      [LTI_MESSAGE_TYPE_CLAIM]: "LtiDeepLinkingResponse",
      [LTI_DL_CONTENT_CLAIM]: contentItems,
      ...((settings as { data?: unknown }).data !== undefined ? { [LTI_DL_DATA_CLAIM]: (settings as { data: unknown }).data } : {}),
    }, context.deployment.platform.clientId, context.deployment.platform.issuer);
    return NextResponse.json({ returnUrl, jwt });
  } catch (error) {
    console.error("Deep Linking response failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create Deep Linking response" }, { status: 400 });
  }
}
