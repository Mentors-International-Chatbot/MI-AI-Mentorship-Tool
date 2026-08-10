import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";
import { lessonSchema } from "@/lib/journey-package/journey-package.schema";

export async function GET(req: NextRequest) {
  const identity = await resolveRequestIdentity(req);
  if (!identity?.ltiContextId || !identity.mentorId) return NextResponse.json({ error: "Instructor LTI session required" }, { status: 403 });
  const enrollment = await ltiRuntimeRepo.ltiEnrollment.findFirst({ where: { contextId: identity.ltiContextId, role: "instructor", identity: { mentorId: identity.mentorId } } });
  if (!enrollment) return NextResponse.json({ error: "Instructor role required" }, { status: 403 });
  const context = await ltiRuntimeRepo.ltiContext.findUnique({ where: { id: identity.ltiContextId }, include: { programVersion: { include: { collection: { include: { lessons: { orderBy: { orderIndex: "asc" }, include: { versions: true } } } } } } } });
  if (!context?.programVersion.collection) return NextResponse.json({ error: "Course not configured" }, { status: 404 });
  return NextResponse.json({
    items: [
      { id: "course", type: "course", title: "AI Essentials — complete course" },
      ...context.programVersion.collection.lessons.map((row) => {
        const version = row.versions.find((item) => item.version === context.programVersion.version);
        return { id: `lesson:${row.slug}`, type: "lesson", lessonKey: row.slug, title: version ? lessonSchema.parse(version.body).title : row.slug };
      }),
      { id: "capstone", type: "capstone", title: "AI Essentials capstone (100 points)" },
    ],
  });
}
