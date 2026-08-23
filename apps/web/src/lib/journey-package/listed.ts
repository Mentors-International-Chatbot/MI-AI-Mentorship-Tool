/**
 * D4 (course listing): whether a course appears in a course-listing UI.
 *
 * Same shape of problem `resolveDelivery` solves for `delivery`: the field
 * lives on `ProgramVersion.metadata`, an untrusted, partially-present JSON
 * blob that predates this field on most rows (metadata is `null` on both
 * MI2024's and pbj-basics's ProgramVersion rows as of 2026-08-21 — this
 * resolver must not require a fully-shaped `metadataSchema` object to answer
 * the one question it exists to answer).
 *
 * Default is `true` — every course is listed unless explicitly opted out.
 * MI2024 is the one course opted out (`scripts/set-mi2024-unlisted.ts`).
 */
export function resolveListed(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return true;
  const candidate = (metadata as { listed?: unknown }).listed;
  return candidate === false ? false : true;
}
