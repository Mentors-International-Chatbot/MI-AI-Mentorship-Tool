import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  return NextResponse.json({
    title: "OCI AI Essentials",
    description: "AI Essentials course player and graded capstone",
    oidc_initiation_url: `${base}/api/lti/login`,
    target_link_uri: `${base}/api/lti/launch`,
    public_jwk_url: `${base}/api/lti/jwks`,
    scopes: ["https://purl.imsglobal.org/spec/lti-ags/scope/score"],
    extensions: [{
      platform: "canvas.instructure.com",
      domain: new URL(base).host,
      settings: {
        placements: [
          { placement: "course_navigation", message_type: "LtiResourceLinkRequest", target_link_uri: `${base}/api/lti/launch`, text: "AI Essentials" },
          { placement: "link_selection", message_type: "LtiDeepLinkingRequest", target_link_uri: `${base}/api/lti/launch`, text: "AI Essentials content" },
        ],
      },
    }],
  });
}
