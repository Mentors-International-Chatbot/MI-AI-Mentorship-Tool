/**
 * AI Invocation Tracing
 * ═══════════════════════════════════════════════════════════════════════════
 * Wraps a single LLM call and records what was sent, which prompt versions
 * assembled it, how long it took, and whether it succeeded.
 *
 * Design constraints:
 * - The wrapper NEVER changes call-site behavior. It re-throws every error it
 *   catches, so existing try/catch fallbacks stay exactly as they were.
 * - A failed trace write is swallowed (console.error only), mirroring
 *   logEvent in src/lib/logging/logger.ts. Tracing must never break a request.
 * - The actual .invoke() is passed in as a thunk, so this module stays free of
 *   LangChain message types.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createHash } from 'crypto';
import { prisma } from '@/lib/db';

/**
 * Free-form on the DB side (plain String column) so a new operation does not
 * need a migration; typed here so call sites can't typo an existing one.
 */
export type AiOperation =
  | 'lesson_delivery'
  | 'assessment_turn'
  | 'sensing'
  | 'assessment_sensing'
  | 'sentiment'
  | 'summary'
  | 'onboarding';

/** Subset of { core, context, task, content, language, evaluator } that applies. */
export type PromptVersionMap = Record<string, string>;

export interface InvokeTracedParams<T> {
  operation: AiOperation;
  model: string;
  promptVersion: PromptVersionMap;
  /** Final assembled system prompt. Hashed always; stored only when AI_TRACE=full. */
  systemPrompt: string;
  socioId?: string;
  organizationId?: string;
  assessmentSessionId?: string;
  /** Router mode when applicable. */
  mode?: string;
  /**
   * The real LLM call, already configured by the caller.
   *
   * Streaming callers call `markFirstToken()` when the first chunk with actual
   * content arrives; the wrapper stamps TTFT off the same clock it uses for
   * latencyMs, so the two are directly comparable. Only the first call counts.
   * Non-streaming callers ignore the argument — `() => Promise<T>` is still
   * assignable here, so every existing call site is untouched.
   */
  invoke: (markFirstToken: () => void) => Promise<T>;
}

/** LangChain attaches token counts here when the provider returns them. */
type MaybeUsage = {
  usage_metadata?: { input_tokens?: number };
  response_metadata?: { tokenUsage?: { promptTokens?: number } };
};

export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

function shouldStorePromptText(): boolean {
  return process.env.AI_TRACE === 'full';
}

/**
 * Rough token estimate. Uses a real prompt-token count when the response
 * already carries one; otherwise chars / 4. No tokenizer dependency.
 */
function approxPromptTokens(systemPrompt: string, result: unknown): number {
  const usage = result as MaybeUsage | null | undefined;
  const reported =
    usage?.usage_metadata?.input_tokens ??
    usage?.response_metadata?.tokenUsage?.promptTokens;

  if (typeof reported === 'number' && Number.isFinite(reported)) {
    return Math.round(reported);
  }
  return Math.ceil(systemPrompt.length / 4);
}

function contentLength(result: unknown): number | undefined {
  const content = (result as { content?: unknown } | null | undefined)?.content;
  if (content === undefined || content === null) return undefined;
  return typeof content === 'string' ? content.length : JSON.stringify(content).length;
}

async function writeTrace(row: {
  operation: string;
  mode?: string;
  model: string;
  socioId?: string;
  organizationId?: string;
  assessmentSessionId?: string;
  promptVersion: PromptVersionMap;
  promptHash: string;
  promptText: string | null;
  promptTokensApprox: number | null;
  responseLength: number | null;
  latencyMs: number;
  ttftMs: number | null;
  success: boolean;
  errorMessage: string | null;
}): Promise<void> {
  try {
    await prisma.aiInvocation.create({
      data: {
        operation: row.operation,
        mode: row.mode ?? null,
        model: row.model,
        socioId: row.socioId ?? null,
        organizationId: row.organizationId ?? null,
        assessmentSessionId: row.assessmentSessionId ?? null,
        promptVersion: row.promptVersion,
        promptHash: row.promptHash,
        promptText: row.promptText,
        promptTokensApprox: row.promptTokensApprox,
        responseLength: row.responseLength,
        latencyMs: row.latencyMs,
        ttftMs: row.ttftMs,
        success: row.success,
        errorMessage: row.errorMessage,
      },
    });
  } catch (error) {
    // Don't let trace failures break the caller.
    console.error('[AiTrace] Failed to write invocation row:', error);
  }
}

/**
 * Times, hashes and records one LLM call, then returns its result untouched.
 * On failure it records the error row and RE-THROWS the original error.
 */
export async function invokeTraced<T>(params: InvokeTracedParams<T>): Promise<T> {
  const { operation, model, promptVersion, systemPrompt, mode } = params;
  const promptHash = hashPrompt(systemPrompt);
  const promptText = shouldStorePromptText() ? systemPrompt : null;
  const startedAt = Date.now();

  // Stays null for non-streaming calls, which never invoke the callback.
  let ttftMs: number | null = null;
  const markFirstToken = () => {
    if (ttftMs === null) ttftMs = Date.now() - startedAt;
  };

  try {
    const result = await params.invoke(markFirstToken);

    await writeTrace({
      operation,
      mode,
      model,
      socioId: params.socioId,
      organizationId: params.organizationId,
      assessmentSessionId: params.assessmentSessionId,
      promptVersion,
      promptHash,
      promptText,
      promptTokensApprox: approxPromptTokens(systemPrompt, result),
      responseLength: contentLength(result) ?? null,
      latencyMs: Date.now() - startedAt,
      ttftMs,
      success: true,
      errorMessage: null,
    });

    return result;
  } catch (error) {
    await writeTrace({
      operation,
      mode,
      model,
      socioId: params.socioId,
      organizationId: params.organizationId,
      assessmentSessionId: params.assessmentSessionId,
      promptVersion,
      promptHash,
      promptText,
      promptTokensApprox: approxPromptTokens(systemPrompt, null),
      responseLength: null,
      latencyMs: Date.now() - startedAt,
      // A stream that emitted tokens and then failed still has a real TTFT.
      ttftMs,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    // The call site's own error handling must see exactly what it saw before.
    throw error;
  }
}
