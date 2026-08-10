import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { getCapstoneDto, PlayerError, resolvePlayerAccess } from "@/lib/player/service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ course: string }> }) {
  try {
    const identity = await resolveRequestIdentity(req);
    if (!identity) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const access = await resolvePlayerAccess(identity, (await params).course);
    return NextResponse.json(await getCapstoneDto(access));
  } catch (error) {
    if (error instanceof PlayerError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Capstone GET failed", error);
    return NextResponse.json({ error: "Unable to load capstone" }, { status: 500 });
  }
}
