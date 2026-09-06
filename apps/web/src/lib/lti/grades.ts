import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";
import { resolveCourseMilestones } from "@/lib/ai/prompts/courseOutcome";

/**
 * The Canvas capstone grade formula, in full — not written down anywhere
 * else. `scoreMaximum` is 100 (`ags.ts`'s `buildScorePayload`); each reached
 * milestone is worth a flat `100 / total` points (`count * pointsPerMilestone`
 * below), so the grade is entirely milestone-derived — it does not read
 * lesson completion, block scores, or any assessment result.
 * `activityProgress` flips Canvas from "InProgress" to "Completed" once
 * `count >= total` (`ags.ts`, reading the `milestoneTotal` frozen on this row
 * at queue time — see that column's schema comment for why it isn't
 * re-resolved at delivery time).
 *
 * `total` is `outcome.milestones.length` for this specific course
 * (`resolveCourseMilestones`), not a hardcoded assumption — this used to be a
 * bare `5` here and in `ags.ts`, correct only because AI Essentials Aug 2026
 * was the only course that had ever driven this pipeline. Phase E's importer
 * exists specifically to let someone author a course with a different
 * milestone count, so this had to stop being shared-code trivia before E.1.
 *
 * Queues visible fractional-of-100 increments without putting Canvas on the
 * learner path.
 */
export async function queueMilestoneGrade(socioId: string, collectionKey: string) {
  const identity = await ltiRuntimeRepo.ltiIdentity.findFirst({
    where: { socioId },
    include: { enrollments: { include: { context: { include: { resourceLinks: true, programVersion: { include: { collection: true } } } } } } },
  });
  const learnerContext = identity?.enrollments.find((item) => item.role === "learner" && item.context.programVersion.collection?.slug === collectionKey)?.context;
  const resourceLink = learnerContext?.resourceLinks.find((link) => link.resourceType === "capstone");
  if (!resourceLink?.lineItemUrl) return;

  const organizationId = learnerContext?.programVersion.collection?.organizationId;
  if (!organizationId) return;
  const milestones = await resolveCourseMilestones({ organizationId, collectionKey });
  const total = milestones.length;
  // A course with no declared milestones has nothing this pipeline can grade
  // — correctly a no-op, not a divide-by-zero, since every LTI-connected
  // course that reaches this point is expected to have outcome.milestones
  // populated (a capstone grade without a milestone list to derive it from
  // was never a supported combination).
  if (total < 1) return;

  const count = await ltiRuntimeRepo.milestoneProgress.count({ where: { socioId, collectionKey } });
  if (count < 1 || count > total) return;

  await ltiRuntimeRepo.ltiGradeDelivery.upsert({
    where: { resourceLinkId_socioId_milestoneCount: { resourceLinkId: resourceLink.id, socioId, milestoneCount: count } },
    create: { resourceLinkId: resourceLink.id, socioId, milestoneCount: count, milestoneTotal: total, scoreGiven: (count / total) * 100 },
    update: {},
  });
}
