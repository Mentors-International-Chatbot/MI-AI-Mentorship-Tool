import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";

/**
 * The Canvas capstone grade formula, in full — not written down anywhere
 * else. `scoreMaximum` is 100 (`ags.ts`'s `buildScorePayload`); each reached
 * milestone is worth a flat 20 points (`count * 20` below), so the grade is
 * entirely milestone-derived — it does not read lesson completion, block
 * scores, or any assessment result. `activityProgress` flips Canvas from
 * "InProgress" to "Completed" only once `count >= 5` (`ags.ts`).
 *
 * `count > 5` short-circuits to a no-op below, and the `>= 5` "Completed"
 * check in `ags.ts` — both hardcode "this course has exactly 5 milestones."
 * True for AI Essentials Aug 2026, the only course this has ever run
 * against, but it is a per-course assumption baked into shared code, not a
 * config value: a course with a different milestone count would either
 * never show "Completed" (fewer than 5) or stop grading past its own last
 * milestone (more than 5, silently, since `count > 5` returns before
 * queueing anything). Flagged, not fixed here — filed alongside Track 0's
 * other config-over-custom-code gaps, not part of this stage's scope.
 *
 * Queues visible 20-point increments without putting Canvas on the learner
 * path.
 */
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
