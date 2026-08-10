import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const identity = await resolveRequestIdentity(req);
  if (!identity || (identity.role !== "admin" && identity.role !== "mentor")) return NextResponse.json({ error: "Instructor or admin required" }, { status: 403 });
  const id = (await params).id;
  const delivery = await ltiRuntimeRepo.ltiGradeDelivery.findUnique({ where: { id }, include: { resourceLink: true } });
  if (!delivery) return NextResponse.json({ error: "Grade delivery not found" }, { status: 404 });
  if (identity.role !== "admin") {
    if (!identity.ltiContextId || delivery.resourceLink.contextId !== identity.ltiContextId) return NextResponse.json({ error: "Not authorized for this Canvas context" }, { status: 403 });
    const enrollment = await ltiRuntimeRepo.ltiEnrollment.findFirst({ where: { contextId: identity.ltiContextId, role: "instructor", identity: { mentorId: identity.mentorId } } });
    if (!enrollment) return NextResponse.json({ error: "Instructor role required" }, { status: 403 });
  }
  await ltiRuntimeRepo.ltiGradeDelivery.update({ where: { id }, data: { status: "pending", attemptCount: 0, nextAttemptAt: new Date(), lastError: null } });
  return NextResponse.json({ success: true });
}
