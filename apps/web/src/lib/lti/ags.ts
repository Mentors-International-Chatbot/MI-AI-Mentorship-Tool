import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";
import { signLtiJwt } from "./crypto";
import { LTI_SCORE_SCOPE } from "./constants";

/**
 * `milestoneTotal` is read off the delivery row, frozen at the moment
 * `queueMilestoneGrade` created it — never re-resolved from the course's
 * current config here. See `LtiGradeDelivery.milestoneTotal`'s schema
 * comment for why: `scoreGiven` is already frozen the same way, and a
 * mid-flight republish must not change what "Completed" meant for an
 * already-queued delivery.
 */
export function buildScorePayload(input: { subject: string; scoreGiven: number; milestoneCount: number; milestoneTotal: number; timestamp?: Date }) {
  return {
    userId: input.subject,
    scoreGiven: input.scoreGiven,
    scoreMaximum: 100,
    activityProgress: input.milestoneCount >= input.milestoneTotal ? "Completed" : "InProgress",
    gradingProgress: "FullyGraded",
    timestamp: (input.timestamp ?? new Date()).toISOString(),
  };
}

async function accessToken(tokenUrl: string, clientId: string) {
  const assertion = await signLtiJwt({ sub: clientId }, clientId, tokenUrl);
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion, scope: LTI_SCORE_SCOPE }),
  });
  if (!response.ok) throw new Error(`Canvas token request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as { access_token?: unknown };
  if (typeof data.access_token !== "string") throw new Error("Canvas token response omitted access_token");
  return data.access_token;
}

export async function deliverGrade(deliveryId: string) {
  const delivery = await ltiRuntimeRepo.ltiGradeDelivery.findUnique({
    where: { id: deliveryId },
    include: { socio: { include: { ltiIdentities: true } }, resourceLink: { include: { context: { include: { deployment: { include: { platform: true } } } } } } },
  });
  if (!delivery || !delivery.resourceLink.lineItemUrl) throw new Error("Grade delivery or Canvas line item is missing");
  const platform = delivery.resourceLink.context.deployment.platform;
  const identity = delivery.socio.ltiIdentities.find((item) => item.platformId === platform.id);
  if (!identity) throw new Error("Learner has no identity on the target Canvas platform");
  const token = await accessToken(platform.tokenUrl, platform.clientId);
  const scoreUrl = `${delivery.resourceLink.lineItemUrl.replace(/\/$/, "")}/scores`;
  const response = await fetch(scoreUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/vnd.ims.lis.v1.score+json" },
    body: JSON.stringify(buildScorePayload({ subject: identity.subject, scoreGiven: delivery.scoreGiven, milestoneCount: delivery.milestoneCount, milestoneTotal: delivery.milestoneTotal })),
  });
  if (!response.ok) throw new Error(`Canvas score delivery failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
}

export async function processPendingGrades(limit = 20) {
  const due = await ltiRuntimeRepo.ltiGradeDelivery.findMany({ where: { status: { in: ["pending", "failed"] }, attemptCount: { lt: 5 }, nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: "asc" }, take: limit });
  let delivered = 0; let failed = 0;
  for (const item of due) {
    const claimed = await ltiRuntimeRepo.ltiGradeDelivery.updateMany({ where: { id: item.id, status: item.status }, data: { status: "delivering", attemptCount: { increment: 1 } } });
    if (claimed.count !== 1) continue;
    try {
      await deliverGrade(item.id);
      await ltiRuntimeRepo.ltiGradeDelivery.update({ where: { id: item.id }, data: { status: "delivered", deliveredAt: new Date(), lastError: null } });
      delivered++;
    } catch (error) {
      const attempt = item.attemptCount + 1;
      const terminal = attempt >= 5;
      await ltiRuntimeRepo.ltiGradeDelivery.update({ where: { id: item.id }, data: { status: "failed", lastError: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000), nextAttemptAt: new Date(Date.now() + (terminal ? 24 * 60 * 60_000 : 60_000 * 2 ** (attempt - 1))) } });
      failed++;
    }
  }
  return { examined: due.length, delivered, failed };
}
