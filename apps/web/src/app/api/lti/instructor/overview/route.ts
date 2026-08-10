import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";
import { lessonSchema } from "@/lib/journey-package/journey-package.schema";

export async function GET(req: NextRequest) {
  const identity = await resolveRequestIdentity(req);
  if (!identity?.ltiContextId || !identity.mentorId) return NextResponse.json({ error: "Instructor LTI session required" }, { status: 403 });
  const role = await ltiRuntimeRepo.ltiEnrollment.findFirst({
    where: { contextId: identity.ltiContextId, role: "instructor", identity: { mentorId: identity.mentorId } },
    select: { id: true },
  });
  if (!role) return NextResponse.json({ error: "Instructor role required" }, { status: 403 });
  const context = await ltiRuntimeRepo.ltiContext.findUnique({
    where: { id: identity.ltiContextId },
    include: {
      programVersion: { include: { collection: { include: { lessons: { orderBy: { orderIndex: "asc" }, include: { versions: true } } } } } },
      cohort: { include: { enrollments: { where: { status: "active" }, include: { participant: { include: { socio: true } } } } } },
    },
  });
  const collection = context?.programVersion.collection;
  if (!context || !collection) return NextResponse.json({ error: "Course context unavailable" }, { status: 404 });
  const lessons = collection.lessons.flatMap((row) => {
    const version = row.versions.find((item) => item.version === context.programVersion.version);
    const parsed = version ? lessonSchema.safeParse(version.body) : null;
    return parsed?.success ? [{ key: row.slug, blocks: parsed.data.blocks }] : [];
  });
  const socios = context.cohort.enrollments.flatMap((item) => item.participant.socio ? [item.participant.socio] : []);
  const socioIds = socios.map((item) => item.id);
  const [blocks, milestones] = await Promise.all([
    ltiRuntimeRepo.blockProgress.findMany({ where: { socioId: { in: socioIds }, collectionKey: collection.slug, completedAt: { not: null } } }),
    ltiRuntimeRepo.milestoneProgress.findMany({ where: { socioId: { in: socioIds }, collectionKey: collection.slug } }),
  ]);
  return NextResponse.json({
    course: collection.name,
    context: context.title,
    lessonCount: lessons.length,
    learners: socios.map((socio) => ({
      id: socio.id,
      name: socio.name ?? "Canvas learner",
      completedLessons: lessons.filter((lesson) => lesson.blocks.every((block) => blocks.some((item) => item.socioId === socio.id && item.lessonKey === lesson.key && item.blockId === block.id && item.contentVersion === block.contentVersion))).length,
      completedMilestones: milestones.filter((item) => item.socioId === socio.id).length,
    })),
  });
}
