import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z, ZodError } from "zod";
import type { PlayerAccess } from "@/lib/player/service";
import type { ProjectSelectionConfig } from "@/lib/journey-package/journey-package.schema";
import { createOpenRouterChat, resolveOpenRouterModel } from "@/lib/ai/openrouter";
import { invokeTraced } from "@/lib/ai/trace/invokeTraced";
import {
  buildResponseStyleRepairInstruction,
  responseStyleViolations,
  resolvePlayerMaxTokens,
} from "@/lib/player/responseStyle";
import { buildProjectSelectionSystemPrompt, PROJECT_SELECTION_PROMPT_VERSION } from "./prompt";

const MODEL_TIMEOUT_MS = 12_000;

export type ProjectSelectionModel = {
  invoke(messages: Array<SystemMessage | HumanMessage | AIMessage>): Promise<{ content: unknown }>;
};

/**
 * The single place the trailing-question rule is written down. The schema
 * enforces it and the repair prompt quotes the same string, so a repair
 * instruction can no longer permit output the schema rejects.
 *
 * That is precisely how this broke: the shared tutor repair builder asks for
 * "at most 1 question", which zero questions satisfies, while this refinement
 * requires the message to *end* in one. The repair then talked the model out of
 * the question the schema demanded.
 */
const TRAILING_QUESTION_PATTERN = /\?(?:["')\]]|\s)*$/u;
const TRAILING_QUESTION_REQUIREMENT =
  "The learner-visible message must end with exactly one question, and must contain no other question.";

const learnerMessageSchema = z.string().trim().min(1)
  .refine((message) => TRAILING_QUESTION_PATTERN.test(message), TRAILING_QUESTION_REQUIREMENT);

const proposalSchema = z.object({
  message: learnerMessageSchema,
  proposals: z.array(z.object({
    presetKey: z.string().trim().min(1),
    idea: z.string().trim().min(1),
    tieBack: z.string().trim().min(1),
  })).length(3),
});

const scopeSchema = z.object({
  message: learnerMessageSchema,
  oneLiner: z.string().trim().min(1),
  context: z.string().trim().min(1),
  automationLevel: z.enum(["L1", "L2", "L3"]),
});

const finalSchema = z.object({
  message: learnerMessageSchema,
  presetKey: z.string().trim().min(1),
  oneLiner: z.string().trim().min(1),
  context: z.string().trim().min(1),
  automationLevel: z.enum(["L1", "L2", "L3"]),
  reframed: z.boolean(),
  automationPass: z.literal(true),
});

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
    return "";
  }).join("");
  return String(content ?? "");
}

/**
 * The model returned JSON that did not satisfy the output schema.
 *
 * A distinct type from the request-body `ZodError` on purpose: both used to
 * surface as a 400 "Invalid project setup request", which pointed every
 * investigation at the learner's request when the fault was upstream.
 */
export class ProjectSelectionOutputError extends Error {
  constructor(
    public readonly phase: string,
    public readonly issues: ZodError["issues"],
    public readonly responseText: string,
  ) {
    super(`Project selection ${phase} output failed validation`);
    this.name = "ProjectSelectionOutputError";
  }
}

function describeIssues(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

/**
 * The response body is logged in full. It is the thing you need to read to tell
 * a dropped trailing question apart from an invented preset key, and nothing
 * else records it — `AiInvocation` stores only a length and a prompt hash.
 */
function logOutputFailure(mode: string, text: string, error: ZodError): void {
  console.error(
    `[ProjectSelection] ${mode} output failed validation: ${describeIssues(error)}`,
    `\nModel response:\n${text}`,
  );
}

function parseJsonObject(text: string): unknown {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Project selection model did not return JSON");
  return JSON.parse(text.slice(first, last + 1));
}

function visibleViolations(message: string, access: PlayerAccess): string[] {
  const violations = responseStyleViolations(message, access.config.responseStyle, false);
  if (/\b(?:I|I'm|I've|I'll|me|my|mine)\b/iu.test(message)) violations.push("self_reference");
  return [...new Set(violations)];
}

async function invokeStructured<T>(params: {
  access: PlayerAccess;
  phase: string;
  userPrompt: string;
  outputContract: string;
  schema: z.ZodType<T>;
  model?: ProjectSelectionModel;
}): Promise<T> {
  const { access, phase, outputContract, schema } = params;
  const selection = access.config.projectSelection;
  if (!selection) throw new Error("Project selection is not configured");
  const systemPrompt = buildProjectSelectionSystemPrompt({ selection, responseStyle: access.config.responseStyle });
  const model = params.model ?? createOpenRouterChat({
    temperature: 0.3,
    // The visible message obeys responseStyle. The JSON envelope and proposal
    // cards need additional headroom that is never rendered as conversation.
    maxTokens: Math.max(resolvePlayerMaxTokens(access.config.responseStyle, false) ?? 0, 700),
  });
  const traceModel = resolveOpenRouterModel();

  const run = async (userPrompt: string, mode: string) => invokeTraced({
    operation: "onboarding",
    model: traceModel,
    promptVersion: { projectSelection: PROJECT_SELECTION_PROMPT_VERSION },
    systemPrompt,
    socioId: access.socioId,
    organizationId: access.organizationId,
    mode,
    context: {
      surface: "project_setup",
      enrollmentId: access.enrollmentId,
      programVersionId: access.programVersionId,
      phase,
    },
    invoke: () => Promise.race([
      model.invoke([new SystemMessage(systemPrompt), new HumanMessage(`${userPrompt}\n\nOUTPUT CONTRACT:\n${outputContract}`)]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Project selection response timeout")), MODEL_TIMEOUT_MS)),
    ]),
  });

  /**
   * Run the model and validate its JSON, retrying once on a schema failure
   * before giving up. The retry quotes the specific validation errors back,
   * which is a far better prompt than the original contract alone — the model
   * usually misses one field, not the whole shape.
   *
   * Only `ZodError` is retried. A response that is not JSON at all is a
   * different failure and still surfaces as-is.
   */
  const runAndParse = async (userPrompt: string, mode: string): Promise<T> => {
    const attempt = await run(userPrompt, mode);
    const text = contentToText(attempt.content);
    try {
      return schema.parse(parseJsonObject(text));
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      logOutputFailure(mode, text, error);

      const retry = await run([
        userPrompt,
        `The previous response failed output validation (${describeIssues(error)}).`,
        `Return corrected JSON only, matching: ${outputContract}`,
      ].join("\n\n"), `${mode}_retry`);
      const retryText = contentToText(retry.content);
      try {
        return schema.parse(parseJsonObject(retryText));
      } catch (retryError) {
        if (!(retryError instanceof ZodError)) throw retryError;
        logOutputFailure(`${mode}_retry`, retryText, retryError);
        throw new ProjectSelectionOutputError(mode, retryError.issues, retryText);
      }
    }
  };

  let parsed = await runAndParse(params.userPrompt, phase);
  const firstMessage = (parsed as { message?: unknown }).message;
  if (typeof firstMessage !== "string") throw new Error("Project selection response has no learner-visible message");
  const violations = visibleViolations(firstMessage, access);
  if (violations.length === 0) return parsed;

  const stableFields = JSON.stringify(Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).filter(([key]) => key !== "message"),
  ));

  const style = access.config.responseStyle;
  const repairInstruction = style
    ? buildResponseStyleRepairInstruction(style, false, violations.filter((item) => item !== "self_reference") as Parameters<typeof buildResponseStyleRepairInstruction>[2], true, firstMessage.length)
    : "Rewrite the message as short conversational prose with one focused final question.";
  parsed = await runAndParse([
    "Repair only the learner-visible message while preserving every other JSON field exactly.",
    repairInstruction,
    // Restated because `repairInstruction` comes from the shared tutor rules,
    // which cap questions but never require one.
    TRAILING_QUESTION_REQUIREMENT,
    "Use no first-person self-reference.",
    `JSON TO REPAIR:\n${JSON.stringify(parsed)}`,
  ].join("\n\n"), `${phase}_repair`);
  const repairedMessage = (parsed as { message?: unknown }).message;
  const repairedStableFields = JSON.stringify(Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).filter(([key]) => key !== "message"),
  ));
  if (repairedStableFields !== stableFields) throw new Error("Project selection style repair changed structured project data");
  if (typeof repairedMessage !== "string" || visibleViolations(repairedMessage, access).length > 0) {
    throw new Error("Project selection response failed the learner-visible response-style contract");
  }
  return parsed;
}

export function selectProposalCandidates(selection: ProjectSelectionConfig, interests: readonly string[]) {
  const selected = new Set(interests);
  const scores = new Map(selection.presets.map((preset) => [preset.key, 0]));
  for (const topic of selection.interestTopics) {
    if (!selected.has(topic.key)) continue;
    for (const presetKey of topic.presetAffinity) scores.set(presetKey, (scores.get(presetKey) ?? 0) + 1);
  }
  const manifestIndex = new Map(selection.presets.map((preset, index) => [preset.key, index]));
  const families = [...new Set(selection.presets.map((preset) => preset.family))];
  return families.map((family) => selection.presets
    .filter((preset) => preset.family === family)
    .sort((a, b) => (scores.get(b.key) ?? 0) - (scores.get(a.key) ?? 0)
      || (manifestIndex.get(a.key) ?? 0) - (manifestIndex.get(b.key) ?? 0))[0]);
}

export async function generateProjectProposals(params: {
  access: PlayerAccess;
  lifeContext: string;
  interests: string[];
  model?: ProjectSelectionModel;
}) {
  const selection = params.access.config.projectSelection!;
  const candidates = selectProposalCandidates(selection, params.interests);
  const candidateKeys = new Set(candidates.map((candidate) => candidate.key));
  const result = await invokeStructured({
    ...params,
    phase: "proposals",
    schema: proposalSchema.superRefine((value, ctx) => {
      const keys = value.proposals.map((proposal) => proposal.presetKey);
      if (new Set(keys).size !== 3 || keys.some((key) => !candidateKeys.has(key))) {
        ctx.addIssue({ code: "custom", message: "Proposals must use exactly the three server-selected presets", path: ["proposals"] });
      }
    }),
    outputContract: '{"message":"2-3 sentence conversational transition ending in one question","proposals":[{"presetKey":"exact candidate key","idea":"small concrete project","tieBack":"specific connection to learner words"}]} with exactly three proposals.',
    userPrompt: `The learner picked these interests: ${JSON.stringify(params.interests)}.\nThey described their life this way: ${JSON.stringify(params.lifeContext)}.\nUse exactly these three server-selected candidates, one per family: ${JSON.stringify(candidates)}. Make every proposal specific to the learner's description.`,
  });
  return result;
}

export async function generateProjectScope(params: {
  access: PlayerAccess;
  lifeContext: string;
  presetKey: string;
  model?: ProjectSelectionModel;
}) {
  const preset = params.access.config.projectSelection!.presets.find((item) => item.key === params.presetKey);
  if (!preset) throw new Error("Unknown project preset");
  return invokeStructured({
    ...params,
    phase: "scope",
    schema: scopeSchema,
    outputContract: '{"message":"short scope-down response ending in one focused question","oneLiner":"small repeatable workflow","context":"learner setting","automationLevel":"L1|L2|L3"}',
    userPrompt: `The learner chose ${JSON.stringify(preset)}. Their life context is ${JSON.stringify(params.lifeContext)}. Talk them down to the smallest useful version, state the likely recurring input and output, and ask one question that tests whether it can run again without rebuilding.`,
  });
}

export async function finalizeProjectScope(params: {
  access: PlayerAccess;
  lifeContext: string;
  presetKey: string;
  scopeResponse: string;
  model?: ProjectSelectionModel;
}) {
  const selection = params.access.config.projectSelection!;
  const allowedKeys = new Set([...selection.presets.map((preset) => preset.key), "custom"]);
  return invokeStructured({
    ...params,
    phase: "finalize",
    schema: finalSchema.refine((value) => allowedKeys.has(value.presetKey), { message: "Final project must use an authored preset or custom", path: ["presetKey"] }),
    outputContract: '{"message":"short confirmation of the scoped workflow ending by asking the learner to name it","presetKey":"authored key or custom","oneLiner":"what repeats, from input to output","context":"learner setting","automationLevel":"L1|L2|L3","reframed":true|false,"automationPass":true}',
    userPrompt: `Life context: ${JSON.stringify(params.lifeContext)}. Initial preset: ${JSON.stringify(params.presetKey)}. Learner's scope answer: ${JSON.stringify(params.scopeResponse)}. Apply the one automation test. If it fails, reframe toward the nearest authored preset and set reframed true. Return automationPass true only when it runs again without rebuilding; otherwise keep narrowing rather than closing.`,
  });
}
