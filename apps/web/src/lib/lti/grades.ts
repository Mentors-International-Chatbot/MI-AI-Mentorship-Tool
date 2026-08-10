import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";

/** Queue visible 20-point increments without putting Canvas on the learner path. */
export async function queueMilestoneGrade(socioId: string, collectionKey: string) {
  const count = await ltiRuntimeRepo.milestoneProgress.count({ where: { socioId, collectionKey } });
  if (count < 1 || count > 5) return;
  const identity = await ltiRuntimeRepo.ltiIdentity.findFirst({
    where: { socioId },
    include: { enrollments: { include: { context: { include: { resourceLinks: true, programVersion: { include: { collection: true } } } } } } },
  });
  const learnerContext = identity?.enrollments.find((item) => item.role === "learner" && item.context.programVersion.collection?.slug === collectionKey)?.context;
  const resourceLink = learnerContext?.resourceLinks.find((link) => link.resourceType === "capstone");
  if (!resourceLink?.lineItemUrl) return;
  await ltiRuntimeRepo.ltiGradeDelivery.upsert({
    where: { resourceLinkId_socioId_milestoneCount: { resourceLinkId: resourceLink.id, socioId, milestoneCount: count } },
    create: { resourceLinkId: resourceLink.id, socioId, milestoneCount: count, scoreGiven: count * 20 },
    update: {},
  });
}
