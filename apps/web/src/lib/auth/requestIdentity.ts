import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";
import { verifySession } from "./session";

export type RequestIdentity = {
  userId: string;
  externalId: string;
  role: "socio" | "mentor" | "admin" | "course_lead";
  name: string;
  socioId?: string;
  mentorId?: string;
  channel: "web" | "canvas";
  ltiContextId?: string;
  ltiSessionId?: string;
  programVersionId?: string;
};

export function hashBearerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Accepts either the established OCI cookie or a four-hour LTI bearer. */
export async function resolveRequestIdentity(req: NextRequest): Promise<RequestIdentity | null> {
  const authorization = req.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7).trim();
    if (!token) return null;
    const session = await ltiRuntimeRepo.ltiSession.findUnique({
      where: { tokenHash: hashBearerToken(token) },
      include: {
        context: { select: { programVersionId: true } },
        identity: { include: { socio: true, mentor: true } },
      },
    });
    if (!session || session.expiresAt <= new Date()) return null;
    if (session.role === "learner" && session.identity.socio) {
      return {
        userId: session.identity.socio.id, externalId: session.identity.socio.externalId, role: "socio",
        name: session.identity.socio.name ?? "Learner", socioId: session.identity.socio.id,
        channel: "canvas", ltiContextId: session.contextId,
        ltiSessionId: session.id,
        programVersionId: session.context.programVersionId,
      };
    }
    if (session.role === "instructor" && session.identity.mentor) {
      const role = session.identity.mentor.role === "admin" ? "admin" : "mentor";
      return {
        userId: session.identity.mentor.id, externalId: session.identity.mentor.id, role, name: session.identity.mentor.name,
        mentorId: session.identity.mentor.id, channel: "canvas", ltiContextId: session.contextId,
        ltiSessionId: session.id,
        programVersionId: session.context.programVersionId,
      };
    }
    return null;
  }

  const session = await verifySession();
  if (!session) return null;
  return {
    userId: session.userId, externalId: session.userId, role: session.role, name: session.name,
    socioId: session.role === "socio" ? session.userId : undefined,
    mentorId: session.role !== "socio" ? session.userId : undefined,
    channel: "web",
  };
}
