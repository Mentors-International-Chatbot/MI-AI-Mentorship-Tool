import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { resolveOrCreateReteachGateSession, PlayerError, resolvePlayerAccess } from "@/lib/player/service";
import { AssessmentConfigError } from "@/lib/ai/assessment/createAssessmentSession";

export async function POST(req: NextRequest, { params }: { params: Promise<{ course: string; lesson: string; blockId: string }> }) {
  try {
    const identity = await resolveRequestIdentity(req);
    if (!identity) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { course, lesson, blockId } = await params;
    const access = await resolvePlayerAccess(identity, course);
    return NextResponse.json(await resolveOrCreateReteachGateSession(access, lesson, blockId));
  } catch (error) {
    if (error instanceof PlayerError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof AssessmentConfigError) {
      console.error("Reteach-gate session config error", error.message);
      return NextResponse.json({ error: `Assessment configuration error: ${error.message}` }, { status: 500 });
    }
    console.error("Reteach-gate session resolution failed", error);
    return NextResponse.json({ error: "Unable to resolve assessment session" }, { status: 500 });
  }
}
