import { resolveDelivery, type DeliveryConfig } from "@/lib/journey-package/delivery";
import { playerRuntimeRepo } from "@/lib/repo/playerRuntimeRepo";

/**
 * Resolve the delivery surface for the version this learner is actually using.
 *
 * Legacy chat curricula may have no ProgramVersion row; resolveDelivery's
 * documented fallback is chat for that case. Versioned courses prefer the
 * learner's active enrollment so an archived-but-still-enrolled version cannot
 * silently inherit the surface of a newer publication.
 */
export async function resolveLearnerDelivery(
  socioId: string,
  collectionKey: string,
): Promise<DeliveryConfig> {
  const enrollment = await playerRuntimeRepo.enrollment.findFirst({
    where: {
      participant: { socioId },
      status: "active",
      programVersion: {
        status: { in: ["published", "archived"] },
        collection: { slug: collectionKey },
      },
    },
    orderBy: { enrolledAt: "desc" },
    select: { programVersion: { select: { metadata: true } } },
  });
  if (enrollment?.programVersion) {
    return resolveDelivery(enrollment.programVersion.metadata);
  }

  const published = await playerRuntimeRepo.programVersion.findFirst({
    where: { status: "published", collection: { slug: collectionKey } },
    orderBy: { publishedAt: "desc" },
    select: { metadata: true },
  });
  return resolveDelivery(published?.metadata);
}
