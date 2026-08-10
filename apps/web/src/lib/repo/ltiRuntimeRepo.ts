import { prisma } from "@/lib/db";

/**
 * LTI persistence boundary. Pre-auth launch reads establish tenant scope from
 * configured platform/deployment/context rows; post-launch callers additionally
 * validate the context-scoped LTI enrollment before reading learner data.
 */
export const ltiRuntimeRepo = {
  ltiPlatform: prisma.ltiPlatform,
  ltiDeployment: prisma.ltiDeployment,
  ltiContext: prisma.ltiContext,
  ltiIdentity: prisma.ltiIdentity,
  ltiEnrollment: prisma.ltiEnrollment,
  ltiResourceLink: prisma.ltiResourceLink,
  ltiOneTimeToken: prisma.ltiOneTimeToken,
  ltiSession: prisma.ltiSession,
  ltiGradeDelivery: prisma.ltiGradeDelivery,
  socio: prisma.socio,
  participantProfile: prisma.participantProfile,
  enrollment: prisma.enrollment,
  mentor: prisma.mentor,
  mentorProfile: prisma.mentorProfile,
  milestoneProgress: prisma.milestoneProgress,
  blockProgress: prisma.blockProgress,
};
