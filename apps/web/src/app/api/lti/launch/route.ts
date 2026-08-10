import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";
import { consumeOneTimeToken } from "@/lib/lti/crypto";
import { createLtiSession, provisionLaunch } from "@/lib/lti/provision";
import { resolveDelivery } from "@/lib/journey-package/delivery";
import { LTI_AGS_CLAIM, LTI_CONTEXT_CLAIM, LTI_CUSTOM_CLAIM, LTI_DEPLOYMENT_CLAIM, LTI_DL_SETTINGS_CLAIM, LTI_MESSAGE_TYPE_CLAIM, LTI_RESOURCE_LINK_CLAIM, LTI_ROLES_CLAIM, LTI_TARGET_LINK_CLAIM, LTI_VERSION_CLAIM } from "@/lib/lti/constants";

function bootstrapHtml(token: string, exchangeToken: string, destination: string) {
  const safeToken = JSON.stringify(token).replace(/</g, "\\u003c");
  const safeDestination = JSON.stringify(destination).replace(/</g, "\\u003c");
  const fallback = `/lti/exchange?code=${encodeURIComponent(exchangeToken)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Opening OCI</title></head><body><p>Opening AI Essentials…</p><p><a id="fallback" href="${fallback}" target="_blank" hidden>Open AI Essentials in a new window</a></p><script>try{sessionStorage.setItem("oci_lti_token",${safeToken});location.replace(${safeDestination});}catch(e){document.getElementById("fallback").hidden=false;}</script><noscript><a href="${fallback}" target="_blank">Open AI Essentials in a new window</a></noscript></body></html>`;
}

export async function POST(req: NextRequest) {
  try {
    const form = new URLSearchParams(await req.text());
    const stateValue = form.get("state"); const idToken = form.get("id_token");
    if (!stateValue || !idToken) return NextResponse.json({ error: "Missing launch state or id_token" }, { status: 400 });
    const state = await consumeOneTimeToken(stateValue, "state");
    if (!state?.deployment?.platform) return NextResponse.json({ error: "Invalid or replayed launch state" }, { status: 401 });
    const platform = await ltiRuntimeRepo.ltiPlatform.findUnique({ where: { id: state.deployment.platform.id }, include: { deployments: { where: { active: true } } } });
    if (!platform) throw new Error("LTI platform is inactive or unavailable");
    const verified = await jwtVerify(idToken, createRemoteJWKSet(new URL(platform.jwksUrl)), { issuer: platform.issuer, audience: platform.clientId });
    const claims = verified.payload as Record<string, unknown>;
    if (claims[LTI_VERSION_CLAIM] !== "1.3.0") throw new Error("Unsupported LTI version");
    const messageType = claims[LTI_MESSAGE_TYPE_CLAIM];
    if (messageType !== "LtiResourceLinkRequest" && messageType !== "LtiDeepLinkingRequest") throw new Error("Unsupported LTI message type");
    const deploymentId = claims[LTI_DEPLOYMENT_CLAIM];
    const deployment = typeof deploymentId === "string" ? platform.deployments.find((item) => item.deploymentId === deploymentId) : undefined;
    if (!deployment) throw new Error("Deployment mismatch");
    if (claims[LTI_TARGET_LINK_CLAIM] !== state.targetLinkUri) throw new Error("Target link mismatch");
    if (typeof claims.nonce !== "string") throw new Error("Invalid or replayed nonce");
    const nonce = await consumeOneTimeToken(claims.nonce, "nonce");
    if (!nonce || nonce.deployment?.platformId !== platform.id || nonce.targetLinkUri !== state.targetLinkUri) throw new Error("Invalid or replayed nonce");
    const contextClaim = claims[LTI_CONTEXT_CLAIM];
    const canvasContextId = contextClaim && typeof contextClaim === "object" ? (contextClaim as { id?: unknown }).id : undefined;
    if (typeof canvasContextId !== "string") throw new Error("Missing LTI context id");
    const context = await ltiRuntimeRepo.ltiContext.findUnique({
      where: { deploymentId_contextId: { deploymentId: deployment.id, contextId: canvasContextId } },
      include: { programVersion: { include: { collection: { include: { lessons: { select: { slug: true } } } } } } },
    });
    if (!context) throw new Error("Canvas context is not configured for an OCI tenant");
    const delivery = resolveDelivery(context.programVersion.metadata);
    if (context.programVersion.status !== "published" || delivery.surface !== "player" || !delivery.supportedChannels.includes("canvas")) throw new Error("This course version is not available in Canvas");
    const roles = Array.isArray(claims[LTI_ROLES_CLAIM]) ? (claims[LTI_ROLES_CLAIM] as unknown[]).filter((item): item is string => typeof item === "string") : [];
    const hasInstructorRole = roles.some((role) => role.endsWith("/Instructor") || role.endsWith("/TeachingAssistant"));
    if (messageType === "LtiDeepLinkingRequest" && !hasInstructorRole) throw new Error("Deep Linking requires an instructor role");
    if (typeof claims.sub !== "string") throw new Error("Missing platform subject");
    const identity = await provisionLaunch({ platformId: platform.id, subject: claims.sub, contextId: context.id, roles, claims });

    let destination = "/home";
    let launchData: Record<string, unknown> | undefined;
    if (messageType === "LtiDeepLinkingRequest") {
      const settings = claims[LTI_DL_SETTINGS_CLAIM];
      if (!settings || typeof settings !== "object" || typeof (settings as { deep_link_return_url?: unknown }).deep_link_return_url !== "string") throw new Error("Missing Deep Linking return URL");
      launchData = { deepLinkingSettings: settings };
      destination = "/lti/deep-link";
    } else {
      const resource = claims[LTI_RESOURCE_LINK_CLAIM];
      if (!resource || typeof resource !== "object" || typeof (resource as { id?: unknown }).id !== "string") throw new Error("Missing resource link id");
      const custom = claims[LTI_CUSTOM_CLAIM] && typeof claims[LTI_CUSTOM_CLAIM] === "object" ? claims[LTI_CUSTOM_CLAIM] as Record<string, unknown> : {};
      const resourceType = custom.resource_type === "lesson" || custom.resource_type === "capstone" ? custom.resource_type : "course";
      const lessonKey = resourceType === "lesson" && typeof custom.lesson_key === "string" ? custom.lesson_key : null;
      if (resourceType === "lesson" && (!lessonKey || !context.programVersion.collection?.lessons.some((lesson) => lesson.slug === lessonKey))) throw new Error("Lesson resource is not part of this course version");
      const ags = claims[LTI_AGS_CLAIM] && typeof claims[LTI_AGS_CLAIM] === "object" ? claims[LTI_AGS_CLAIM] as { lineitem?: unknown } : {};
      await ltiRuntimeRepo.ltiResourceLink.upsert({
        where: { contextId_resourceLinkId: { contextId: context.id, resourceLinkId: (resource as { id: string }).id } },
        create: { contextId: context.id, resourceLinkId: (resource as { id: string }).id, resourceType, lessonKey, lineItemUrl: typeof ags.lineitem === "string" ? ags.lineitem : null },
        update: { resourceType, lessonKey, lineItemUrl: typeof ags.lineitem === "string" ? ags.lineitem : null },
      });
      destination = resourceType === "lesson" && lessonKey ? `/learn/AIESS/${encodeURIComponent(lessonKey)}` : resourceType === "capstone" ? "/learn/AIESS/capstone" : "/lti/continue";
      if (!identity.socioId && identity.mentorId) destination = "/lti/instructor";
    }
    const sessionRole = messageType === "LtiDeepLinkingRequest" || (!identity.socioId && !!identity.mentorId) ? "instructor" : "learner";
    const session = await createLtiSession(identity.id, context.id, sessionRole, destination, launchData);
    return new NextResponse(bootstrapHtml(session.bearerToken, session.exchangeToken, destination), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("LTI launch rejected", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid LTI launch" }, { status: 401 });
  }
}
