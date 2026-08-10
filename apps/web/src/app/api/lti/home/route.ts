import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { resolveLearnerHome } from "@/lib/courses/learnerHome";

export async function GET(req: NextRequest) {
  const identity = await resolveRequestIdentity(req);
  if (!identity?.socioId || identity.channel !== "canvas") return NextResponse.json({ error: "Canvas learner session required" }, { status: 401 });
  return NextResponse.json({ homePath: await resolveLearnerHome(identity.socioId, "canvas", identity.programVersionId) });
}
