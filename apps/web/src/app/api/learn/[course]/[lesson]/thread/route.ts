import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { getLessonThread, PlayerError, resolvePlayerAccess } from "@/lib/player/service";
import { toClientMessage } from "@/app/api/chat/toClientMessage";

/**
 * The player's tutor thread for one lesson.
 *
 * A player route rather than a reuse of `/api/chat/history`, for two reasons
 * that both bite in production: that endpoint is not lesson-scoped, so a
 * learner who ever used the chat surface would see MI turns inside this thread;
 * and it authenticates through `verifySession()` alone, while player requests
 * may arrive with an LTI bearer token that only `resolveRequestIdentity`
 * understands.
 *
 * Serialization is shared with the chat surface on purpose — `toClientMessage`
 * is the one place that decides which rows are displayable and that metadata
 * survives the round trip.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ course: string; lesson: string }> }) {
  try {
    const identity = await resolveRequestIdentity(req);
    if (!identity) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { course, lesson } = await params;
    const access = await resolvePlayerAccess(identity, course);
    const rows = await getLessonThread(access, lesson);
    return NextResponse.json({
      messages: rows
        // Prisma types `metadata` as JsonValue, which admits scalars.
        // `toClientMessage` wants an object or null, and a scalar here would
        // mean a row nothing in this codebase wrote.
        .map((row) => toClientMessage({
          ...row,
          metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? row.metadata as Record<string, unknown>
            : null,
        }))
        .filter((message): message is NonNullable<typeof message> => message !== null),
    });
  } catch (error) {
    if (error instanceof PlayerError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Player thread load failed", error);
    return NextResponse.json({ error: "Unable to load the lesson thread" }, { status: 500 });
  }
}
