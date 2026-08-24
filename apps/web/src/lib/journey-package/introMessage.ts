import { localizedStringSchema } from "./journey-package.schema";

/**
 * B.1 (course intro message): the authored opening message for a course,
 * shown once as the learner's thread's first item on their first lesson.
 *
 * Same shape of problem `resolveDelivery`/`resolveListed` solve: the field
 * lives on `ProgramVersion.metadata`, an untrusted, partially-present JSON
 * blob that predates this field on every existing row. This resolver must
 * not require a fully-shaped `metadataSchema` object to answer the one
 * question it exists to answer.
 *
 * Default is `null` — no intro message unless one is explicitly authored.
 * Unlike `delivery`, there is no legacy behavior to fall back to: a missing
 * intro message simply means the thread starts at the first block, exactly
 * as it always has.
 */
export function resolveIntroMessage(metadata: unknown, language = "en"): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const candidate = (metadata as { introMessage?: unknown }).introMessage;
  const result = localizedStringSchema.safeParse(candidate);
  if (!result.success) return null;
  const lang = language as keyof typeof result.data;
  return result.data[lang] ?? result.data.en;
}
