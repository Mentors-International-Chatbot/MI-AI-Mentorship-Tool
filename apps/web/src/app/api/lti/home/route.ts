import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { resolveLearnerHome } from "@/lib/courses/learnerHome";

export async function GET(req: NextRequest) {
  const identity = await resolveRequestIdentity(req);
  if (!identity?.socioId || identity.channel !== "canvas") return NextResponse.json({ error: "Canvas learner session required" }, { status: 401 });
  // A.5: always passes programVersionId (the launch's own Canvas context) —
  // resolveLearnerHome never returns 'choose' when a specific version is
  // given, so this is always a redirect in practice. Falling back to /home
  // is defensive, not a real path (an LTI session there redirects again from
  // the top per role, same as any other socio session would).
  const resolution = await resolveLearnerHome(identity.socioId, "canvas", identity.programVersionId);
  return NextResponse.json({ homePath: resolution.kind === "redirect" ? resolution.path : "/home" });
}
