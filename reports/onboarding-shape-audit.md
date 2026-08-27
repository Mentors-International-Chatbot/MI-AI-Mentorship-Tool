# Onboarding Shape Audit — `metadata.onboarding` vs `config.onboarding`

Investigation only. No code changed except this report. Follows up on the note in `reports/journey-package-audit.md` §metadataSchema flagging that `metadata.onboarding` and `config.onboarding` "happen to share the name … easy to author into the wrong one."

All line numbers refer to `apps/web/src/lib/journey-package/journey-package.schema.ts`.

---

## 1. The two shapes, in full

### `config.onboarding` (lines 588–596, inside `configSchema` at line 571)

```ts
onboarding: z.object({
  mode: z.enum(["survey", "baseline_quiz", "skip"]),
  steps: z.array(z.object({ id: key, promptKey: z.string(), field: z.string() })).default([]),
  diagnostic: baselineDiagnosticSchema.optional(),   // defined at line 478
}).optional()
```
Fields: `mode`, `steps[]` (`id`, `promptKey`, `field`), `diagnostic?` (a full quiz: questions with `id`, `prompt`, `format`, `options`, `answerKey`, `explanation`, `dimensionKey`, plus a `threshold`).

### `metadata.onboarding` (schema at lines 709–720, wired in at line 752 inside `metadataSchema`)

```ts
export const onboardingStepSchema = z.object({
  id: key,
  field: z.string().min(1),
  prompt: localizedStringSchema,
  required: z.boolean().default(false),
});
export const onboardingConfigSchema = z.object({
  welcome: localizedStringSchema.optional(),
  steps: z.array(onboardingStepSchema).default([]),
});
// metadata.onboarding: onboardingConfigSchema.optional()   (line 752)
```
Fields: `welcome?` (localized greeting), `steps[]` (`id`, `field`, `prompt` [localized], `required`).

They share the token "onboarding" and both have a `steps[]` array, but the step shapes are incompatible (`promptKey: string` vs `prompt: LocalizedString`; `field` optional-ish placement differs) and the parents mean different things: `config.onboarding` is "should the learner take a diagnostic/survey before starting," `metadata.onboarding` is "what greeting/name-capture script to run."

---

## 2. Who reads each, independently

### `config.onboarding` — actively read, drives player diagnostic gating

- `apps/web/src/lib/journey-package/import-journey-package.ts:243` — copied verbatim into `ProgramVersionConfig.onboarding` on import.
- `apps/web/src/lib/courses/learnerHome.ts:59` — `const diagnosticRequired = config.onboarding?.mode === "baseline_quiz";`
- `apps/web/src/lib/player/service.ts:417` — same check, gates whether the diagnostic flow is required for the *player* surface.
- `apps/web/src/lib/player/service.ts:742` and `:776` — `access.config.onboarding?.diagnostic` pulled out to serve/grade the baseline quiz.
- `journey-package.schema.ts:785, 855–860` — package-level `superRefine` requires a `diagnostic` block when `mode === "baseline_quiz"`.

Behaviour driven: whether the **player (web) surface** shows a baseline-quiz diagnostic before lessons start, and the content of that quiz. This is a player/AIESS-shaped feature, not a chat-onboarding-conversation feature.

### `metadata.onboarding` — validated and persisted, but **never read back by any consumer**

- Repo-wide grep for `metadata.onboarding` / `metadata?.onboarding` outside the schema file: **zero hits**.
- It round-trips into the DB: `import-journey-package.ts:296,305` store the whole `pkg.metadata` object (including `.onboarding`) into `ProgramVersion.metadata` (Json) and the collection's stored metadata — but nothing ever pulls `.onboarding` back out of that JSON blob afterward.
- The type `OnboardingConfig` (inferred from `onboardingConfigSchema`, i.e. the *metadata* shape) is reused by `apps/web/src/lib/courses/course-meta.ts` and `apps/web/src/lib/courses/defaults.ts` for `CourseMeta.onboarding` — but the *values* there come from a hardcoded `COURSE_CONFIGS` object literal in `course-meta.ts:90–184` (keyed by collection slug, e.g. `'mi-colombia-curriculum'`), not from any package/DB read. `DEFAULT_ONBOARDING` in `defaults.ts:47` is likewise hand-written.

Behaviour driven by the type-alike-but-hardcoded `CourseMeta.onboarding`: `apps/web/src/lib/onboarding/service.ts:102–103` (`handleOnboarding`) uses `meta.onboarding.steps` to run the actual WhatsApp/chat name-capture conversation for MI (see §4). But this data source is a hardcoded literal in `course-meta.ts`, not the package's persisted `metadata.onboarding`. The schema field and the runtime behavior happen to share a TypeScript type by convenience of reuse, but are otherwise disconnected — the schema field is write-only.

---

## 3. Production data (`main` DB, via Prisma against `ProgramVersion`, grouped by `ContentCollection.slug`)

Query ran against every `ProgramVersion` row, checking `config.onboarding` and `metadata.onboarding` presence in the stored JSON.

| Collection | ProgramVersions | `config.onboarding` present | `metadata.onboarding` present | Notes |
|---|---|---|---|---|
| **mi-colombia-curriculum** | 2 (1.0.0 archived, 1.1.0 published) | 2 | **0** | both versions: `mode: "skip"`, 0 steps, no diagnostic |
| **pbj-basics** | 1 (0.1.0 published) | 1 | **0** | `mode: "skip"`, 0 steps, no diagnostic |
| **ai-essentials** | 2 (1.1.1 archived, 1.1.2 published) | 2 | **0** | both: `mode: "baseline_quiz"`, `diagnostic` present |
| **skills-tool-calls** | 5 (4 archived, 1 published: 2026.5) | **0** | **0** | no onboarding config authored at all |
| (no collection) | 1 draft | 0 | 0 | orphan draft version |

**`metadata.onboarding` is present in 0 of 11 ProgramVersion rows in production, across every collection.** `config.onboarding` is present in 5 rows (all with `mode: "skip"` except AIESS's two `baseline_quiz` rows). This matches the authored source file directly: `content/ai-essentials.package.json` has `config.onboarding` (mode/diagnostic) fully populated and **no `onboarding` key at all under `metadata`**.

---

## 4. Does the frozen MI chat surface depend on either?

The onboarding branch in `apps/web/src/lib/messaging/handler.ts:286-287` (`if (socio.status !== 'ACTIVE') { await handleOnboarding(socio, message, channel); ... }`) delegates to `apps/web/src/lib/onboarding/service.ts`.

- `handleOnboarding` (`service.ts:90-103`) calls `getCourseMeta(collectionKey)` and reads `meta.onboarding.steps` to drive the step-by-step name/business-description capture and the welcome message (`service.ts:102-103, 148-213, 243-272`).
- `getCourseMeta` → `loadCourseMetaFromDb` (`course-meta.ts:216-252`) queries Prisma **only** for `collection.name` / `collection.description` (lines 217-223). The `onboarding` value is taken from the **hardcoded** `COURSE_CONFIGS['mi-colombia-curriculum'].onboarding` literal at `course-meta.ts:119-159`, merged with `defaults.ts` fallbacks via `mergeOnboarding` (`course-meta.ts:206-211`).
- Neither `config.onboarding` nor the persisted `metadata.onboarding` from the actual imported `ProgramVersion` row is read anywhere in this path.

**Answer: the frozen MI chat onboarding script is hardcoded in `course-meta.ts`, not package-driven at all.** It happens to satisfy the same TypeScript shape as `metadata.onboarding` (both use the `OnboardingConfig` type: `welcome` + `steps[{id, field, prompt, required}]`), which is presumably why the schema field was named/shaped to match — but the schema field itself carries zero runtime weight today. Confirmed independently by §3: MI's own `ProgramVersion.metadata.onboarding` is absent in prod, and the chat still onboards socios correctly because it never looks there.

---

## 5. Any validator/test/type catching authoring into the wrong one?

**No.** Specifically:
- The package-level `superRefine` (`journey-package.schema.ts:775-1041`) cross-validates `config.onboarding.mode === "baseline_quiz"` against `config.onboarding.diagnostic` (line 856), and checks `pkg.metadata.delivery || pkg.config.onboarding?.diagnostic` (line 785) — it never references `pkg.metadata.onboarding` in any cross-check.
- No test file asserts that authoring content into `metadata.onboarding` has any effect, or that `config.onboarding` and `metadata.onboarding` can't both be populated with conflicting data. Tests that touch "onboarding" (`ungradedQuiz.test.ts`, `ai-essentials-artifact.test.ts`, `skills-tool-calls-package.test.ts`, `v11.schema.test.ts`, `learnerHome.test.ts`, `e2e-config-resolution.test.ts`) all exercise `config.onboarding` (diagnostic/mode gating), none exercise `metadata.onboarding`.
- Both fields are simply `.optional()` with no `superRefine` linking them, no lint rule, no runtime warning. An author could fully populate `metadata.onboarding.steps` on a new package today, have it validate and import cleanly, and it would be silently discarded by every consumer.

---

## 6. Recommendation

**(a) `config.onboarding` is canonical. `metadata.onboarding` is dead — delete it (or at minimum stop treating it as a live spec).**

Backing from §2–4, not tidiness:
- §3: 0 of 11 production rows have ever populated `metadata.onboarding`, across all four collections including MI2024.
- §2: no code path reads `metadata.onboarding` back out of the DB after import. It is write-only.
- §4: the actual MI onboarding conversation (name/business capture + welcome) that the frozen chat surface runs is driven entirely by a hardcoded literal in `course-meta.ts`'s `COURSE_CONFIGS`, never by the package's `metadata.onboarding`. Deleting the schema field breaks nothing live — `course-meta.ts` only borrows its TypeScript shape (`OnboardingConfig`), and that type can be redeclared locally in `course-meta.ts`/`defaults.ts` without depending on the package schema.
- `config.onboarding` (mode/diagnostic), by contrast, is read on every player page load (`learnerHome.ts`, `player/service.ts`) and is the only one with authored production content (AIESS's baseline quiz).

If the plan is instead to make the *chat* onboarding script package-authorable (moving `course-meta.ts`'s hardcoded `COURSE_CONFIGS` into real package data), that is a **new feature**, not a resurrection of `metadata.onboarding` as currently defined — it would need to actually be wired into `course-meta.ts`'s DB load path, which it never has been.

---

## One-sentence answer

The new onboarding block type should extend **`config.onboarding`** (mode/diagnostic/survey shape — the only one read at runtime and the only one with production data); nothing has to be kept alive for MI2024 because its live chat-onboarding script comes from a hardcoded literal in `course-meta.ts`, not from either schema field, and `metadata.onboarding` is unpopulated and unread in production.
