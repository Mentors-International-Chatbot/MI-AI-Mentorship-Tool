import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { helpRequestPostSchema, requestHelp } from "@/lib/player/helpRequest";
import { PlayerError, resolvePlayerAccess } from "@/lib/player/service";

export const dynamic = "force-dynamic";

/**
 * Learner presses "request help from a human" on the player.
 *
 * Course, learner and organization all come from `resolvePlayerAccess`, never
 * from the body — the body carries only what the server cannot know, which is
 * where in the lesson the learner was standing and what they typed.
 *
 * A repeat press is a 200, not a 409. The learner did nothing wrong, and the
 * only honest thing to tell them is that their request is already in.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ course: string }> }) {
  try {
    const identity = await resolveRequestIdentity(req);
    if (!identity) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const access = await resolvePlayerAccess(identity, (await params).course);
    const body = helpRequestPostSchema.parse(await req.json().catch(() => ({})));
    const result = await requestHelp(access, body);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PlayerError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid help request", code: "invalid_help_request", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Player help request failed", error);
    return NextResponse.json({ error: "Unable to send help request" }, { status: 500 });
  }
}
