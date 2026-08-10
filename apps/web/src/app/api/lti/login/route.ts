import { NextRequest, NextResponse } from "next/server";
import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";
import { createOneTimeToken } from "@/lib/lti/crypto";

async function initiate(req: NextRequest, input: URLSearchParams) {
  const issuer = input.get("iss");
  const loginHint = input.get("login_hint");
  const targetLinkUri = input.get("target_link_uri");
  const clientId = input.get("client_id");
  if (!issuer || !loginHint || !targetLinkUri) return NextResponse.json({ error: "Missing OIDC login parameters" }, { status: 400 });
  let parsedTarget: URL;
  try { parsedTarget = new URL(targetLinkUri); } catch { return NextResponse.json({ error: "Invalid target_link_uri" }, { status: 400 }); }
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin : req.nextUrl.origin;
  if (parsedTarget.origin !== req.nextUrl.origin && parsedTarget.origin !== configuredOrigin) return NextResponse.json({ error: "Unapproved target_link_uri" }, { status: 400 });
  const platforms = await ltiRuntimeRepo.ltiPlatform.findMany({ where: { issuer, active: true, ...(clientId ? { clientId } : {}) }, include: { deployments: { where: { active: true } } }, take: 2 });
  if (platforms.length !== 1 || platforms[0].deployments.length === 0) return NextResponse.json({ error: "Unknown or ambiguous LTI platform" }, { status: 403 });
  const platform = platforms[0];
  const requestedDeployment = input.get("lti_deployment_id");
  // Canvas normally omits deployment_id during OIDC initiation. In that case
  // any active deployment on the platform can anchor the one-time tokens; the
  // signed launch claim selects and validates the exact deployment below.
  const deployment = requestedDeployment ? platform.deployments.find((item) => item.deploymentId === requestedDeployment) : platform.deployments[0];
  if (!deployment) return NextResponse.json({ error: "LTI deployment is unknown" }, { status: 403 });
  const [state, nonce] = await Promise.all([
    createOneTimeToken("state", targetLinkUri, deployment.id),
    createOneTimeToken("nonce", targetLinkUri, deployment.id),
  ]);
  const url = new URL(platform.authorizationUrl);
  url.searchParams.set("scope", "openid"); url.searchParams.set("response_type", "id_token");
  url.searchParams.set("response_mode", "form_post"); url.searchParams.set("prompt", "none");
  url.searchParams.set("client_id", platform.clientId); url.searchParams.set("redirect_uri", targetLinkUri);
  url.searchParams.set("login_hint", loginHint); url.searchParams.set("state", state); url.searchParams.set("nonce", nonce);
  const messageHint = input.get("lti_message_hint"); if (messageHint) url.searchParams.set("lti_message_hint", messageHint);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) { return initiate(req, req.nextUrl.searchParams); }
export async function POST(req: NextRequest) { return initiate(req, new URLSearchParams(await req.text())); }
