import { z } from "zod";
import type { ProjectSelectionConfig } from "@/lib/journey-package/journey-package.schema";
import { tenantRepo } from "@/lib/repo";
import { createTenantContext } from "@/lib/repo/tenantContext";
import type { LearnerProject, PutLearnerProjectInput } from "@/lib/repo/tenantRepo.types";
import type { PlayerAccess } from "./service";

export const learnerProjectPutSchema = z.object({
  presetKey: z.string().trim().min(1),
  title: z.string().trim().min(1),
  oneLiner: z.string().trim().min(1),
  context: z.string().trim().min(1).nullable().optional(),
  automationLevel: z.enum(["L1", "L2", "L3"]),
  interests: z.array(z.string().trim().min(1)).length(5)
    .refine((values) => new Set(values).size === values.length, "interests must contain five unique keys"),
  status: z.enum(["DRAFT", "ACTIVE", "CHANGED", "ABANDONED"]).optional(),
});

const fiveInterestKeysSchema = z.array(z.string().trim().min(1)).length(5)
  .refine((values) => new Set(values).size === values.length, "interests must contain five unique keys");

export const projectSetupPostSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select_interests"), interests: fiveInterestKeysSchema }),
  z.object({ action: z.literal("proposals"), lifeContext: z.string().trim().min(1).max(2_000) }),
  z.object({ action: z.literal("scope"), presetKey: z.string().trim().min(1) }),
  z.object({ action: z.literal("finalize"), presetKey: z.string().trim().min(1), scopeResponse: z.string().trim().min(1).max(2_000) }),
]);

export const projectSetupConfirmSchema = z.object({ title: z.string().trim().min(1).max(120) });

export type LearnerProjectPutBody = z.infer<typeof learnerProjectPutSchema>;

export class LearnerProjectInputError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "LearnerProjectInputError";
  }
}

export function validateLearnerProjectSelection(
  data: LearnerProjectPutBody,
  selection: ProjectSelectionConfig | undefined,
): PutLearnerProjectInput {
  if (!selection) {
    throw new LearnerProjectInputError("project_selection_not_configured", "This course does not configure project selection");
  }
  const presetKeys = new Set(selection.presets.map((preset) => preset.key));
  if (data.presetKey !== "custom" && !presetKeys.has(data.presetKey)) {
    throw new LearnerProjectInputError("invalid_project_preset", "presetKey must name an authored preset or custom");
  }
  const interestKeys = new Set(selection.interestTopics.map((interest) => interest.key));
  if (data.interests.some((interest) => !interestKeys.has(interest))) {
    throw new LearnerProjectInputError("invalid_project_interests", "Every interest must name an authored interest topic");
  }
  return data;
}

export async function getCurrentLearnerProject(access: PlayerAccess): Promise<LearnerProject | null> {
  return tenantRepo.getCurrentLearnerProject(createTenantContext(access.organizationId), access.enrollmentId);
}

export async function learnerProjectSelectionRequired(
  access: Pick<PlayerAccess, "organizationId" | "enrollmentId" | "collectionKey" | "config">,
): Promise<boolean> {
  if (!access.config.projectSelection) return false;
  return tenantRepo.learnerProjectSelectionRequired(
    createTenantContext(access.organizationId),
    access.enrollmentId,
    access.collectionKey,
  );
}

export async function putCurrentLearnerProject(
  access: PlayerAccess,
  data: LearnerProjectPutBody,
): Promise<LearnerProject> {
  const validated = validateLearnerProjectSelection(data, access.config.projectSelection);
  return tenantRepo.putLearnerProject(createTenantContext(access.organizationId), access.enrollmentId, validated);
}

function requireProjectSelection(access: PlayerAccess): ProjectSelectionConfig {
  if (!access.config.projectSelection) {
    throw new LearnerProjectInputError("project_selection_not_configured", "This course does not configure project selection");
  }
  return access.config.projectSelection;
}

function validateInterestKeys(interests: string[], selection: ProjectSelectionConfig): void {
  const authored = new Set(selection.interestTopics.map((topic) => topic.key));
  if (interests.some((interest) => !authored.has(interest))) {
    throw new LearnerProjectInputError("invalid_project_interests", "Every interest must name an authored interest topic");
  }
}

export async function getProjectSetupDto(access: PlayerAccess) {
  const selection = requireProjectSelection(access);
  const project = await getCurrentLearnerProject(access);
  return {
    interestTopics: selection.interestTopics,
    project,
  };
}

export async function saveProjectSetupInterests(access: PlayerAccess, interests: string[]) {
  const selection = requireProjectSelection(access);
  validateInterestKeys(interests, selection);
  return tenantRepo.saveLearnerProjectInterests(
    createTenantContext(access.organizationId),
    access.enrollmentId,
    interests,
  );
}

export async function saveProjectSetupLifeContext(access: PlayerAccess, lifeContext: string) {
  requireProjectSelection(access);
  return tenantRepo.saveLearnerProjectLifeContext(
    createTenantContext(access.organizationId),
    access.enrollmentId,
    lifeContext,
  );
}

export async function stageProjectSetup(access: PlayerAccess, data: {
  presetKey: string;
  oneLiner: string;
  context: string;
  automationLevel: "L1" | "L2" | "L3";
  reframed: boolean;
}) {
  const selection = requireProjectSelection(access);
  const current = await getCurrentLearnerProject(access);
  if (!current || current.status !== "DRAFT" || !current.lifeContext) {
    throw new LearnerProjectInputError("project_setup_not_ready", "Complete the interest picker and life-context turn first");
  }
  validateInterestKeys(current.interests, selection);
  if (data.presetKey !== "custom" && !selection.presets.some((preset) => preset.key === data.presetKey)) {
    throw new LearnerProjectInputError("invalid_project_preset", "presetKey must name an authored preset or custom");
  }
  return tenantRepo.stageLearnerProject(createTenantContext(access.organizationId), access.enrollmentId, {
    ...data,
    interests: current.interests,
    lifeContext: current.lifeContext,
  });
}

export async function confirmProjectSetup(access: PlayerAccess, title: string) {
  requireProjectSelection(access);
  const current = await getCurrentLearnerProject(access);
  if (!current || current.status !== "DRAFT"
    || !current.presetKey || !current.oneLiner || !current.automationLevel
    || !current.lifeContext || !current.automationValidatedAt) {
    throw new LearnerProjectInputError("project_setup_not_ready", "The project must pass the automation gate before confirmation");
  }
  return tenantRepo.putLearnerProject(createTenantContext(access.organizationId), access.enrollmentId, {
    presetKey: current.presetKey,
    title,
    oneLiner: current.oneLiner,
    context: current.context,
    automationLevel: current.automationLevel,
    interests: current.interests,
    status: "ACTIVE",
  });
}
