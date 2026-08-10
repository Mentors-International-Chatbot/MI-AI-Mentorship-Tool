import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { diagnosticDto, PlayerError, resolvePlayerAccess, submitDiagnostic } from "@/lib/player/service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ course: string }> }) {
  try {
    const identity = await resolveRequestIdentity(req);
    if (!identity) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const access = await resolvePlayerAccess(identity, (await params).course);
    return NextResponse.json(diagnosticDto(access));
  } catch (error) {
    if (error instanceof PlayerError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Diagnostic GET failed", error);
    return NextResponse.json({ error: "Unable to load diagnostic" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ course: string }> }) {
  try {
    const identity = await resolveRequestIdentity(req);
    if (!identity) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const access = await resolvePlayerAccess(identity, (await params).course);
    const body = await req.json().catch(() => ({})) as { answers?: unknown };
    return NextResponse.json(await submitDiagnostic(access, body.answers));
  } catch (error) {
    if (error instanceof PlayerError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Diagnostic POST failed", error);
    return NextResponse.json({ error: "Unable to score diagnostic" }, { status: 500 });
  }
}
