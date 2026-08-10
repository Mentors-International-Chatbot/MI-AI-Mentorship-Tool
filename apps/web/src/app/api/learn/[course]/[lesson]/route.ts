import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { getLessonDto, PlayerError, resolvePlayerAccess } from "@/lib/player/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ course: string; lesson: string }> }) {
  try {
    const identity = await resolveRequestIdentity(req);
    if (!identity) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { course, lesson } = await params;
    const access = await resolvePlayerAccess(identity, course);
    return NextResponse.json(await getLessonDto(access, lesson));
  } catch (error) {
    if (error instanceof PlayerError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Player lesson GET failed", error);
    return NextResponse.json({ error: "Unable to load lesson" }, { status: 500 });
  }
}
