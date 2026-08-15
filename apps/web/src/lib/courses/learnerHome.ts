import { playerRuntimeRepo } from "@/lib/repo/playerRuntimeRepo";
import { resolveDelivery } from "@/lib/journey-package/delivery";
import { lessonSchema } from "@/lib/journey-package/journey-package.schema";

export async function resolveLearnerHome(
  socioId: string,
  channel: "web" | "canvas" = "web",
  programVersionId?: string,
): Promise<string> {
  const socio = await playerRuntimeRepo.socio.findUnique({ where: { id: socioId }, select: { curriculumCollectionKey: true, participantProfile: { select: { id: true } } } });
  if (!socio?.curriculumCollectionKey) return "/join";
  const enrollment = socio.participantProfile ? await playerRuntimeRepo.enrollment.findFirst({
    where: {
      participantId: socio.participantProfile.id,
      status: "active",
      programVersion: { status: { in: ["published", "archived"] }, collection: { slug: socio.curriculumCollectionKey } },
      ...(programVersionId ? { programVersionId } : {}),
    },
    orderBy: { enrolledAt: "desc" },
    select: { programVersionId: true },
  }) : null;
  const selectedVersionId = programVersionId ?? enrollment?.programVersionId ?? undefined;
  const version = await playerRuntimeRepo.programVersion.findFirst({
    where: {
      ...(selectedVersionId ? { id: selectedVersionId } : {}),
      status: selectedVersionId ? { in: ["published", "archived"] } : "published",
      collection: { slug: socio.curriculumCollectionKey },
    },
    include: { collection: { include: { lessons: { orderBy: { orderIndex: "asc" }, include: { versions: { where: { active: true }, take: 1 } } } } } },
    orderBy: selectedVersionId ? undefined : { publishedAt: "desc" },
  });
  // AI Essentials is a versioned player course. A curriculum key without a
  // published version must not fall through resolveDelivery(undefined), whose
  // legacy default is chat, or the learner is silently sent to the wrong UI.
  if (socio.curriculumCollectionKey === "ai-essentials" && !version) {
    return "/join?error=no-published-course";
  }
  const delivery = resolveDelivery(version?.metadata);
  if (delivery.surface === "chat") return "/chat";
  if (!enrollment || enrollment.programVersionId !== version?.id) return "/join?error=not-enrolled";
  if (!delivery.supportedChannels.includes(channel)) return "/join?error=channel-not-supported";
  const courseCode = socio.curriculumCollectionKey === "ai-essentials" ? "AIESS" : socio.curriculumCollectionKey;
  if (!version?.collection) return "/join";
  const diagnosticRequired = version.config && typeof version.config === "object" && !Array.isArray(version.config)
    && (version.config as { onboarding?: { mode?: unknown } }).onboarding?.mode === "baseline_quiz";
  if (diagnosticRequired) {
    const attempts = await playerRuntimeRepo.diagnosticAttempt.count({ where: { socioId, programVersionId: version.id } });
    if (attempts === 0) return `/learn/${courseCode}/diagnostic`;
  }
  const progress = await playerRuntimeRepo.blockProgress.findMany({ where: { socioId, collectionKey: socio.curriculumCollectionKey, completedAt: { not: null } } });
  for (const row of version.collection.lessons) {
    if (!row.versions[0]) continue;
    const lesson = lessonSchema.safeParse(row.versions[0].body);
    if (!lesson.success) continue;
    const complete = lesson.data.blocks.every((block) => progress.some((item) => item.lessonKey === row.slug && item.blockId === block.id && item.contentVersion === block.contentVersion));
    if (!complete) return `/learn/${courseCode}/${row.slug}`;
  }
  return `/learn/${courseCode}/capstone`;
}
