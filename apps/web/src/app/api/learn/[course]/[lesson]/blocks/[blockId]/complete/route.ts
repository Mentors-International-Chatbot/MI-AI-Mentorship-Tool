import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { completeBlock, PlayerError, resolvePlayerAccess } from "@/lib/player/service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ course: string; lesson: string; blockId: string }> }) {
  try {
    const identity = await resolveRequestIdentity(req);
    if (!identity) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { course, lesson, blockId } = await params;
    const body = await req.json().catch(() => ({})) as {
      response?: unknown;
      openQuestionGateEnabled?: boolean;
      acknowledgeReview?: boolean;
      interleaveAction?: "done" | "skip";
    };
    const access = await resolvePlayerAccess(identity, course);
    return NextResponse.json(await completeBlock(access, lesson, blockId, body.response, {
      openQuestionGateEnabled: body.openQuestionGateEnabled,
      acknowledgeReview: body.acknowledgeReview,
      interleaveAction: body.interleaveAction,
    }));
  } catch (error) {
    if (error instanceof PlayerError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Player block completion failed", error);
    return NextResponse.json({ error: "Unable to save block progress" }, { status: 500 });
  }
}
