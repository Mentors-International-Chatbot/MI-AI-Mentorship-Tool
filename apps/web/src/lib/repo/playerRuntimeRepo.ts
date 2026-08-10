import { prisma } from "@/lib/db";

/**
 * Database delegates owned by the authenticated player runtime.
 *
 * Callers must establish a PlayerAccess first; keeping these delegates in the
 * repo layer makes that boundary auditable and prevents route handlers from
 * growing ad-hoc tenant queries.
 */
export const playerRuntimeRepo = {
  socio: prisma.socio,
  enrollment: prisma.enrollment,
  ltiContext: prisma.ltiContext,
  programVersion: prisma.programVersion,
  contentLesson: prisma.contentLesson,
  blockProgress: prisma.blockProgress,
  lessonProgress: prisma.lessonProgress,
  milestoneProgress: prisma.milestoneProgress,
  diagnosticAttempt: prisma.diagnosticAttempt,
  socioDimensionState: prisma.socioDimensionState,
  metricDefinition: prisma.metricDefinition,
  metricObservation: prisma.metricObservation,
  participantProfile: prisma.participantProfile,
  message: prisma.message,
};
