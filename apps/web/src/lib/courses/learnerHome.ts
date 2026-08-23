import { playerRuntimeRepo } from "@/lib/repo/playerRuntimeRepo";
import { resolveDelivery } from "@/lib/journey-package/delivery";
import { lessonSchema } from "@/lib/journey-package/journey-package.schema";
import { programVersionConfigSchema } from "@/lib/journey-package/program-version-config.schema";
import { learnerProjectSelectionRequired } from "@/lib/player/learnerProject";
import { resolveListed } from "@/lib/journey-package/listed";
import { courseCodeForCollectionKey } from "./resolver";

/**
 * A.5 (Platform Restructure Phase A, Stage 5). resolveLearnerHome used to
 * return a single destination string, silently picking whichever course
 * `Socio.curriculumCollectionKey` happened to name and leaving any other
 * ACTIVE enrollment unreachable from /home. This is the tie-break decision
 * from the Stage 5 report: no "most recently enrolled" default — that just
 * re-implements the single-course model with a nicer fallback. Zero or one
 * ACTIVE enrollment still resolves straight through (today's UX, unchanged).
 * More than one returns the list; the caller decides how to render it.
 */
export type LearnerHomeResolution =
  | { kind: "redirect"; path: string }
  | { kind: "choose"; courses: { courseCode: string; path: string }[] };

type ActiveEnrollment = { id: string; programVersionId: string | null; collectionKey: string | null };

/**
 * Resolves the next-step path for ONE specific enrollment. This is the full
 * per-course logic (project setup / diagnostic / next incomplete lesson /
 * capstone) that resolveLearnerHome used to run against the single
 * curriculumCollectionKey-derived course; it is now parameterized by a real
 * Enrollment row so it produces the right destination for whichever course
 * this is, independent of what curriculumCollectionKey currently names.
 */
async function resolveCoursePath(
  socioId: string,
  channel: "web" | "canvas",
  enrollment: ActiveEnrollment,
): Promise<string> {
  const collectionKey = enrollment.collectionKey;
  // Should not happen for an ACTIVE enrollment (the A.4 write-time guard
  // refuses to create one with a null collectionKey; the only null rows are
  // the pre-Stage-2 dangling-draft ones, all 'dropped' after A.3, never
  // 'active'). Defensive rather than a crash if it ever does.
  if (!collectionKey || !enrollment.programVersionId) return "/join?error=not-enrolled";

  const version = await playerRuntimeRepo.programVersion.findFirst({
    where: { id: enrollment.programVersionId, status: { in: ["published", "archived"] } },
    include: {
      program: { select: { organizationId: true } },
      collection: { include: { lessons: { orderBy: { orderIndex: "asc" }, include: { versions: { where: { active: true }, take: 1 } } } } },
    },
  });
  // AI Essentials is a versioned player course. A curriculum key without a
  // published version must not fall through resolveDelivery(undefined), whose
  // legacy default is chat, or the learner is silently sent to the wrong UI.
  if (collectionKey === "ai-essentials" && !version) {
    return "/join?error=no-published-course";
  }
  const delivery = resolveDelivery(version?.metadata);
  if (delivery.surface === "chat") return "/chat";
  if (!delivery.supportedChannels.includes(channel)) return "/join?error=channel-not-supported";
  if (!version?.collection) return "/join";
  const courseCode = courseCodeForCollectionKey(collectionKey);
  const config = programVersionConfigSchema.parse(version.config);
  if (await learnerProjectSelectionRequired({
    organizationId: version.program.organizationId,
    enrollmentId: enrollment.id,
    collectionKey,
    config,
  })) {
    return `/learn/${encodeURIComponent(courseCode)}/project-setup`;
  }
  const diagnosticRequired = config.onboarding?.mode === "baseline_quiz";
  if (diagnosticRequired) {
    const attempts = await playerRuntimeRepo.diagnosticAttempt.count({ where: { socioId, programVersionId: version.id } });
    if (attempts === 0) return `/learn/${courseCode}/diagnostic`;
  }
  // A.6.1 addendum: scoped to this specific enrollment, not socioId+
  // collectionKey — a retake (D2) must show the new enrollment as freshly
  // started, not carrying forward the archived enrollment's completed
  // lessons. The old enrollment's rows still exist, just unreachable from
  // this query; nothing is deleted.
  const progress = await playerRuntimeRepo.blockProgress.findMany({ where: { enrollmentId: enrollment.id, completedAt: { not: null } } });
  let lastLessonSlug: string | undefined;
  for (const row of version.collection.lessons) {
    if (!row.versions[0]) continue;
    const lesson = lessonSchema.safeParse(row.versions[0].body);
    if (!lesson.success) continue;
    lastLessonSlug = row.slug;
    const complete = lesson.data.blocks.every((block) => progress.some((item) => item.lessonKey === row.slug && item.blockId === block.id && item.contentVersion === block.contentVersion));
    if (!complete) return `/learn/${courseCode}/${row.slug}`;
  }
  // Everything is done. A course without an `outcome` has no capstone — the
  // endpoint 404s — so sending a returning learner there is a dead end with no
  // way forward. Land them on the last lesson instead, which still renders its
  // completion card. With no lesson to return to there is nothing better to
  // offer, so that case keeps the original route.
  if (!config.outcome && lastLessonSlug) return `/learn/${courseCode}/${lastLessonSlug}`;
  return `/learn/${courseCode}/capstone`;
}

export async function resolveLearnerHome(
  socioId: string,
  channel: "web" | "canvas" = "web",
  programVersionId?: string,
): Promise<LearnerHomeResolution> {
  const socio = await playerRuntimeRepo.socio.findUnique({
    where: { id: socioId },
    select: {
      curriculumCollectionKey: true,
      participantProfile: {
        select: {
          id: true,
          enrollments: {
            where: { status: "active" },
            select: { id: true, programVersionId: true, collectionKey: true, programVersion: { select: { metadata: true } } },
          },
        },
      },
    },
  });

  const activeEnrollments = socio?.participantProfile?.enrollments ?? [];

  // A caller with a specific version in mind (LTI: identity.programVersionId,
  // resolved from the Canvas launch context) is asking about ONE course —
  // never ambiguous, never a list, regardless of how many other ACTIVE
  // enrollments this socio has elsewhere.
  if (programVersionId) {
    const pinned = activeEnrollments.find((e) => e.programVersionId === programVersionId);
    if (!pinned) return { kind: "redirect", path: "/join?error=not-enrolled" };
    return { kind: "redirect", path: await resolveCoursePath(socioId, channel, pinned) };
  }

  if (activeEnrollments.length === 0) {
    // DEPRECATED fallback (A.6 removes this branch — see the
    // curriculumCollectionKey doc comment on the Socio model). No active
    // enrollment exists to resolve anything from; curriculumCollectionKey is
    // read only to distinguish "never selected a course" from "selected one,
    // but has no matching active enrollment" in the response, never to grant
    // a destination. Post-A.3, no active socio should hit the second case.
    return { kind: "redirect", path: socio?.curriculumCollectionKey ? "/join?error=not-enrolled" : "/join" };
  }

  if (activeEnrollments.length === 1) {
    // A lone enrollment is never being chosen FROM a list, so `listed`
    // (a course-browsing concern — D4) does not apply here. MI2024 learners
    // with no other course still reach it normally from /home.
    return { kind: "redirect", path: await resolveCoursePath(socioId, channel, activeEnrollments[0]) };
  }

  // D4: MI2024 (and any other unlisted course) must not appear in the
  // choose-list A.5 built for genuinely multi-course learners — see the A.5
  // report's finding. Filtering can collapse the >1 case back down to 1 or
  // 0 listed options; degrade the same way the un-filtered counts above do
  // rather than ever returning an empty `choose` list.
  const listedEnrollments = activeEnrollments.filter((enrollment) => resolveListed(enrollment.programVersion?.metadata));

  if (listedEnrollments.length === 0) {
    return { kind: "redirect", path: "/join?error=not-enrolled" };
  }

  if (listedEnrollments.length === 1) {
    return { kind: "redirect", path: await resolveCoursePath(socioId, channel, listedEnrollments[0]) };
  }

  const courses = await Promise.all(listedEnrollments.map(async (enrollment) => ({
    courseCode: courseCodeForCollectionKey(enrollment.collectionKey ?? "unknown"),
    path: await resolveCoursePath(socioId, channel, enrollment),
  })));
  return { kind: "choose", courses };
}
