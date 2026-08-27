# Journey Package Audit — Phase E.0

Investigation only. No code changed. Prepared for the course-cartridge spec that will let Sam author against `journey-package.schema.ts`.

Primary file audited: `apps/web/src/lib/journey-package/journey-package.schema.ts` (1060 lines). All line numbers below refer to that file unless noted otherwise.

---

## 1. Full current schema

### Package root (`journeyPackageSchema`, line 764)

| Field | Type | Required? |
|---|---|---|
| `schemaVersion` | `"1.0" \| "1.1" \| "1.2"` | required |
| `metadata` | `metadataSchema` | required |
| `config` | `configSchema` | required |
| `curriculum` | `{ collectionKey: key; lessons: lessonSchema[] (min 1) }` | required |
| `outcome` | `outcomeSchema` | optional |

Plus a package-wide `superRefine` (lines 775–1041) that cross-validates: schema-version gates (AI Essentials requires ≥1.1; delivery/diagnostic/drag_order require 1.2), duplicate lesson keys, duplicate block ids (package-wide uniqueness), dimensionKey references from `teach_back` and `quiz_checkpoint.questions`, diagnostic content rules, alertRule dimension references, graduation lesson/dimension references, dashboard panel dimension references and duplicate-singleton-panel checks, assessment config dimension references, gated `teach_back` requiring `config.assessment`, and milestone/mentorResource referential integrity.

### `metadataSchema` (line 738)

| Field | Type | Required? |
|---|---|---|
| `packageId` | `key` | required |
| `title` | `string` (min 1) | required |
| `description` | `string` | optional |
| `languages` | `string[]` (min 1, BCP-47) | required |
| `version` | `string` (min 1) — content version | required |
| `author` | `{ name?, organizationKey? }` | optional |
| `identity` | `identitySchema` (`mentorName` default `'Tutor'`, `displayName?`) | optional |
| `terminology` | `terminologySchema` (`participant: LocalizedString`, default `{en:'participant'}`) | optional |
| `learnerContext` | `learnerContextSchema` (label, intakeQuestion, personalizationInstruction, fields[]) | optional |
| `onboarding` | `onboardingConfigSchema` (`welcome?`, `steps[]`) | optional |
| `scheduledCheckins` | `scheduledCheckinSchema[]` | optional |
| `delivery` | `{ surface: "chat"\|"player"; supportedChannels: ("whatsapp"\|"web"\|"canvas")[] (min 1) }` | optional |

**Note:** `metadata.onboarding` (welcome/steps intake) and `config.onboarding` (mode/diagnostic, line 588) are two *different* schemas that happen to share the name "onboarding" at different tree depths. This is worth flagging to Sam explicitly — it is easy to author into the wrong one.

### `configSchema` (line 571)

| Field | Type | Required? |
|---|---|---|
| `terminology` | `Record<string,string>` | optional |
| `aiBehavior` | `{tone?, teachingStyle?, languageInstruction?}` (all partial) | optional |
| `responseStyle` | `responseStyleSchema` | optional |
| `projectSelection` | `projectSelectionSchema` | optional |
| `helpRequest` | `helpRequestSchema` (`enabled`, `maxMessageLength` default 1000) | optional |
| `onboarding` | `{mode: "survey"\|"baseline_quiz"\|"skip"; steps[]; diagnostic?: baselineDiagnosticSchema}` | optional |
| `trackedDimensions` | `trackedDimensionSchema[]` | default `[]` |
| `alertRules` | `alertRuleSchema[]` | default `[]` |
| `graduation` | `{requiredLessonKeys[], requiredDimensionKeys[]}` | optional |
| `assessment` | `{passing, studentVisibleDimensionKeys?, recordedDimensionKeys?, onMaxTurnsWithoutPass, allowRetake, blocking, autoAppendTeachBack}` | optional |
| `dashboard` | `dashboardSchema` (`panels: dashboardPanelSchema[]`) | optional |

### `curriculum.lessons[]` → `lessonSchema` (`PackageLesson`, line 373)

| Field | Type | Required? |
|---|---|---|
| `key` | `key` | required |
| `title` | `string` (min 1) | required |
| `category` | `string` | optional |
| `keyConcepts` | `string[]` | default `[]` |
| `selfCheckQuestions` | `string[]` | default `[]` |
| `blocks` | `lessonBlockSchema[]` (min 1, must include ≥1 `teach` block) | required |
| `exercise` | `string` | optional (MI-specific) |
| `commitment` | `string` | optional |
| `provenance` | `{sourceDocument?, chapter?, page?, reviewedBy?, reviewedAt?}` | optional |

### `LessonBlock` — `blockBase` (line 192, shared by every variant)

| Field | Type | Required? |
|---|---|---|
| `id` | `key` | required |
| `order` | `number` (int, positive) | required |
| `concepts` | `key[]` | default `[]` |
| `contentVersion` | `number` (int, positive) | default `1` |
| `handoff` | `string` (min 1) | optional |

`handoff` **already exists at the schema level, on every block type** (it is spread from `blockBase` into all six variants), and it is read by `LessonPlayer.tsx` line 443 (`if (isCurrent && block.handoff)`). This answers part of item 6 directly: handoff is not a gap, it is already universal.

### Six block-type variants (`lessonBlockSchema`, discriminated on `blockType`, line 227)

1. **`teach`** (line 236): `role: "scenario"|"explanation"|"example"|"question"|"deepening"`, `content: string` (required), `presentation: "narrated"|"rendered"` (default `"narrated"`), `expectsResponse: boolean` (default `false`).
2. **`teach_back`** (line 287): `prompt: string` (required), `evaluatesConcepts: string[]` (default `[]`), `dimensionKey: key` (required), `delivery: "inline"|"gated_session"` (default `"inline"`), `passingOverride?: Partial<passingSchema>`.
3. **`quiz_checkpoint`** (line 304): `title?: string`, `questions: quizQuestionSchema[]` (min 1). Schema comment (lines 298–302) says this is "RESERVED for V2 delivery... the V1 runtime does not grade or gate on it yet" — **this comment is stale**: `LessonPlayer.tsx` (lines 606–612) fully renders it and `gradePlayerBlock` (`player/service.ts` line 505) fully grades it with retry logic. It is live in the player surface today; the comment should be corrected or scoped explicitly to the MI chat surface.
4. **`drag_order`** (line 312): `prompt: string`, `items: string[]` (min 2), `correctOrder: number[]` (min 2), cross-validated as a complete permutation.
5. **`media`** (line 335): `kind: string` (free-form, e.g. "image"/"diagram"/"embedded_widget"), `config: Record<string,any>` (default `{}`), `caption?: string`.
6. **`resource`** (line 344): `resource: discriminatedUnion("type", [weblink, textbook_reference, mcp_connector])`.
   - `weblink`: `url` (required, `.url()`), `label` (required), `description?`.
   - `textbook_reference`: `title?, isbn?, chapter?, page?, callout?` — all optional.
   - `mcp_connector`: `connector: string` (required), `context?: string`.

### Fields nothing reads / fields readers depend on that the schema doesn't require

- **`media` and `resource` blocks validate and count toward lesson-completion progress but have no renderer anywhere.** `LessonPlayer.tsx`'s current-block switch (lines 605–655) only branches on `"teach"`, `"quiz_checkpoint"`, `"drag_order"`, `"teach_back"` — there is no case for `"media"` or `"resource"`. A learner reaching one of these blocks sees an empty card with no way to advance except the generic reviewed-block Continue path, which never fires because nothing marks it reviewed. This matches the existing vault note `media/resource blocks have no renderer` — confirmed still true.
- `provenance` (lesson-level, line 384) and `learnerContextSchema.fields[].extractionHint` (line 693) are authored/validated but I found no reader in `LessonPlayer.tsx`, `player/service.ts`, or the prompt layers grepped — they appear to be write-only today (reserved for a future feature, not dead per se, but unread).
- `metadata.scheduledCheckins` (line 753) is schema-validated but I found no cron/handler consuming it (the only cron found is `/api/cron/summaries`, unrelated).
- Reader-side dependency not enforced by the schema: `db-lesson-service.ts`'s `transformToLessonData` (line 153) does `dimensionKey: block.dimensionKey` on a `teach_back` block and comments "Required in schema" — that's correctly enforced (`dimensionKey: key` is required on `teach_back`, line 292). No violation found there.

---

## 2. Block type registry

| Block type | Schema fields (beyond base) | Rendered in LessonPlayer.tsx? | Rendered in MI chat surface? | Graded by `gradePlayerBlock`? | Channel support (`channelSupport.ts`) |
|---|---|---|---|---|---|
| `teach` | role, content, presentation, expectsResponse | Yes (line 605) | Yes — becomes a `LessonMessage` via `transformToLessonData` (`db-lesson-service.ts` line 122-130) | Yes (line 504) — auto-completes, no real grading | N/A (not a gate) |
| `teach_back` | prompt, evaluatesConcepts, dimensionKey, delivery, passingOverride | Yes (line 617), gates on 2-turn exchange server-side (`preparePlayerContext`/`recordPlayerTutorSuccess`) | Yes for `delivery:"inline"` (evaluated in main convo); `delivery:"gated_session"` becomes a `LessonGate` (`db-lesson-service.ts` line 133-157) consumed by `chat/progress.ts` line 88 | Explicitly refused by `gradePlayerBlock` (line 552: `throw ... "Complete teach-back blocks through the tutor"`) — must go through the tutor turn path | `canDeliverGatedAssessment()` (`channelSupport.ts` line 59) returns **false for any channel other than `"web"`** (and `undefined`→true for non-channel callers). WhatsApp cannot deliver a `gated_session` teach_back — this is the "stopgap" documented at the top of that file; a WhatsApp learner hitting a gate previously caused silent hangs, now routed around via `router.checkGatePosition`/`stance.readGateEvidence` reading `no_gates`. |
| `quiz_checkpoint` | title?, questions[] | Yes (line 606), with `QUIZ_ATTEMPT_LIMIT = 2` retry logic (`player/service.ts` line 474) | **No** — `transformToLessonData` only extracts `teach` blocks into `messages[]` and `teach_back(gated_session)` into `gates[]`; `quiz_checkpoint` is silently dropped for MI | Yes (line 505), full scoring incl. ungraded/opinion questions | Player-only; no WhatsApp path exists for this block type at all (not even a degraded one) |
| `drag_order` | prompt, items[], correctOrder[] | Yes (line 613), dnd-kit sortable UI | **No** — dropped by `transformToLessonData` (only reads `teach`/`teach_back`) | Yes (line 546), exact-order check | Player-only |
| `media` | kind, config, caption? | **No** — no case in the LessonPlayer switch | **No** — dropped by transform | N/A — no grading branch | Neither surface delivers it; validates and imports but strands the learner in player (see item 1) |
| `resource` | resource (weblink\|textbook_reference\|mcp_connector) | **No** — no case in the LessonPlayer switch | **No** — dropped by transform | N/A | Neither surface delivers it |

Grading entry point: `gradePlayerBlock(block, response, attempt)` in `apps/web/src/lib/player/service.ts` line 503. `QUIZ_ATTEMPT_LIMIT = 2` is defined at line 474 with a documented rationale (answer key is a spent teaching resource after reveal).

---

## 3. Quiz question shape (`quizQuestionSchema`, line 128)

```
{
  id: key,
  prompt: string (min 1),
  format: "multiple_choice" | "short_answer",
  options?: string[],
  answerKey?: string | string[],
  explanation?: string (min 1),
  dimensionKey?: key,
  graded: boolean (default true),
}
```

Refinements:
- `.refine` (line 156): `multiple_choice` requires `options.length >= 2`.
- `.superRefine` (line 160), scoped to `format === "multiple_choice"` only:
  - options must be unique after Unicode/whitespace normalization (`normalizeOption`, line 124 — NFKC, collapse whitespace, trim, lowercase).
  - if `graded === true`: `answerKey` **must be a single string** equal to exactly one raw option (line 174-181). This is the key constraint for extension: **today `answerKey` is typed as `string | array` at the field level but the multiple_choice refinement narrows it to exactly one string at validation time.** The union type exists in the base schema precisely so a future format (e.g., a multi-select variant) can use the array branch without a type change — only a new `superRefine` arm keyed off `format` is needed.
  - if `graded === false`: `answerKey` must be `undefined` (line 182-187).
- Package-level `superRefine` (line 838) additionally requires an `explanation` on graded questions when `schemaVersion !== LEGACY_SCHEMA_VERSION` (i.e., 1.1+).
- Diagnostic-specific tightening (line 863-892, inside `baselineDiagnosticSchema.questions` which reuses this same `quizQuestionSchema`): every diagnostic question must be `format === "multiple_choice"`, `graded === true`, must have `explanation`, and must reference a known `dimensionKey`.

**Implication for new question types** (`fill_blank`, `drag_order`-as-a-question, `matching`): `quizQuestionSchema` is a flat object with `format` as the only discriminator, not a `z.discriminatedUnion`. Extending it cleanly likely means either (a) converting `format` into a proper discriminated union (breaking change to every existing package unless done via `.and()`/a superset object with format-conditional `superRefine` arms, as `multiple_choice` already does), or (b) adding new `format` enum values and new format-scoped `superRefine` branches following the existing `multiple_choice` pattern exactly — the second is the lower-risk path since `short_answer` already coexists with no special-casing (it has no refinement branch at all today, meaning `short_answer` questions currently have **no options/answerKey shape enforcement whatsoever** — anything goes).

---

## 4. Legacy transform — `transformToLessonData` (`apps/web/src/lib/lessons/db-lesson-service.ts`, line 115)

This is the `PackageLesson` (DB-stored, matches `lessonSchema`) → `LessonData` (legacy, MI2024 WhatsApp chat surface) adapter. `LessonData` shape (line 62):

```
{ lessonNumber, titleEs, category, keyConcepts, selfCheckQuestions, exercise, commitment, messages: LessonMessage[], gates: LessonGate[], lessonKey }
```

Exact package fields read by this function:

- `pkg.key` — used for `lessonKey` and, via `keyToLessonNumber` (line 105), to derive `lessonNumber` (regex `^lesson-(\d+)$`, else falls back to `orderIndex + 1`).
- `pkg.title` → `titleEs`.
- `pkg.category` → `category` (default `""`).
- `pkg.keyConcepts` → `keyConcepts` (default `[]`).
- `pkg.selfCheckQuestions` → `selfCheckQuestions` (default `[]`).
- `pkg.exercise` → `exercise` (default `""`).
- `pkg.commitment` → `commitment` (default `""`).
- `pkg.blocks[]`, sorted by `order`:
  - Filters `blockType === "teach"` blocks → `{order, type: ROLE_TO_TYPE[role], contentEs: content}`. Reads `block.role` and `block.content` only. `presentation` and `expectsResponse` are **not read** — MI has no concept of "expects a typed response" or narrated-vs-rendered.
  - Filters `blockType === "teach_back" && delivery === "gated_session"` → `LessonGate {blockId, blockOrder, afterMessageIndex, prompt, evaluatesConcepts, dimensionKey, passingOverride}`. Reads `block.id`, `block.order`, `block.prompt`, `block.evaluatesConcepts`, `block.dimensionKey`, `block.passingOverride`. `afterMessageIndex` is computed by counting `teach` blocks with a lower `order` — a purely derived value, not read from the package.
  - **`quiz_checkpoint`, `drag_order`, `media`, and `resource` blocks are never inspected by this function at all.** They exist in the stored `body` JSON but contribute nothing to `LessonData`.

**Fields effectively frozen for MI2024** (any spec extension must not alter what this function produces for existing MI packages): `lesson.key`, `lesson.title`, `lesson.category`, `lesson.keyConcepts`, `lesson.selfCheckQuestions`, `lesson.exercise`, `lesson.commitment`, and — on `teach` blocks only — `id`(indirectly, via order), `order`, `role`, `content`; and — on `teach_back` blocks with `delivery: "gated_session"` only — `id`, `order`, `prompt`, `evaluatesConcepts`, `dimensionKey`, `passingOverride`. Everything else in the schema (all of `quiz_checkpoint`, `drag_order`, `media`, `resource`, `teach.presentation`, `teach.expectsResponse`, `teach.handoff`, `blockBase.concepts`, `blockBase.contentVersion` beyond identity/versioning bookkeeping) is invisible to MI2024 and safe to extend without risk to that surface — **provided** any new block type is additive (a new discriminated-union member) rather than a change to the shape of `teach` or `teach_back`.

Downstream consumers of `LessonData` fields (confirmed via `apps/web/src/lib/ai/prompts/layers/content.ts` and `layers/task.ts`): `lessonNumber`, `titleEs` (as `lessonTitleEs`), `category` (as `lessonCategory`), `keyConcepts`, `messages[].type`/`contentEs` (as `messageType`/`messageContentEs`), `exercise`, `commitment`, `selfCheckQuestions` (reteach path only), and `gates` (consumed in `apps/web/src/lib/chat/progress.ts` line 88, gated on `canDeliverGatedAssessment(socio.channelType)`).

---

## 5. Importer state (`apps/web/src/lib/journey-package/import-journey-package.ts`, 374 lines)

`importJourneyPackage(pkg, opts)`:

1. **Guard first** (lines 129-147): refuses to import over a `ProgramVersion` whose `status !== "draft"` — checked *before* any write, because the upserts below have no status check of their own and would silently overwrite a published version's content.
2. **`maybeAppendTeachBack`** (line 57): if `config.assessment.autoAppendTeachBack`, synthesizes a gated `teach_back` block on any lesson lacking one, using `config.assessment.passing.dimensionKey`.
3. Upserts `ContentCollection` (by `organizationId_slug`).
4. Upserts `ContentLesson` (by `collectionId_slug`) + `LessonVersion` (by `lessonId_version_lang`) **per lesson**. `LessonVersion.body` stores **the entire parsed lesson object as JSON** — this is exactly the `PackageLesson` that `transformToLessonData` later reads. So yes: **blocks land as DB rows**, one row per lesson (not one row per block) — `body` is a JSON blob containing the full `blocks[]` array, not normalized block rows.
5. Builds `ProgramVersion.config` (typed `ProgramVersionConfig`, matching `program-version-config.schema.ts`) from `pkg.config` + `pkg.outcome` (with `normalizeMilestoneAvailability` applied) + curriculum references (`curriculumCollectionKey`, `curriculumLessonKeys`) + optional org-inherited `branding`/`notifications`.
6. Upserts `ProgramVersion` in `draft` status (never auto-publishes; publish is `publication.service.ts`'s `validateForPublication` + a separate publish step).
7. Writes an `AuditLog` row if `opts.importedBy` is set.

`validateAndImport(rawPackage, opts)` wraps this with `journeyPackageSchema.safeParse` first, returning `{success:false, errors}` on validation failure.

**What remains / is not yet built**: the importer is idempotent and upsert-based, has a real draft/published guard, and a real test suite (`import-journey-package.test.ts`, `import-journey-package.guard.test.ts`). What it does *not* do: no block-level DB normalization (blocks are opaque JSON inside `LessonVersion.body`, read back out via `lessonSchema.parse`), no partial/incremental import (each import re-writes a lesson's entire body), and it fully discards `pkg.outcome.mentorResources`' authored `body`/`mentorPrompt` into `config.outcome` JSON rather than a queryable table (consistent with the outcome/mentorResources backlog item in the project vault).

**`content/block-ids.json` and the four-step matching rule**: this file is **not read by the importer or the runtime app at all** — it is grep-confirmed to appear only in `scripts/convert-learnmachine-package.ts` (and its test). It is a standalone, upstream *authoring/generation* tool that converts the old "Learn Machine" AI Essentials source JSON into a `JourneyPackage` file (`content/ai-essentials.package.json`), which is later fed into `import-journey-package.ts` as a separate step. The four-step matching rule lives in `matchIdentityCandidates` (lines 216-285 of that script):
  1. **Explicit reuse** — an operator-supplied `--reuse-id sourceRef=stableId` mapping wins outright.
  2. **Exact content-hash match** — if exactly one existing entry's `contentHash` (sha256 of a stable-JSON serialization) matches the candidate, reuse its `stableId` unchanged.
  3. **Discriminator + fingerprint overlap** — among existing entries sharing the same `discriminator` (`lessonKey:blockType:firstConcept`), score token overlap of the normalized `fingerprint`; if exactly one scores ≥0.5, treat it as a drifted edit of the same block (reuse id, log to `drift[]`); if ambiguous (>1 at ≥0.5) or borderline (>0 but <0.5), push to `review[]` and **abort the run** rather than guess.
  4. **Mint** — if nothing matched and the sourceRef is in `decisions.mint`, allocate a new sequential `stableId` (`aiess-l{lessonIndex}-b{sequence}`).
  Any entries in `content/block-ids.json` untouched by the current run are marked `retired: true`. This is entirely an AI-Essentials-source-specific tool; it has no bearing on Sam authoring a new course from scratch (he would author `JourneyPackage` JSON directly and never touch this script or `block-ids.json`).

---

## 6. Gaps against the target palette

| Target feature | Schema support today |
|---|---|
| **Course intro message** | Nothing. No field for an authored opening message distinct from lesson content. `metadata.onboarding.welcome` (`localizedStringSchema`, line 717) is the closest analog but it's scoped to the onboarding flow, not a general course-intro. |
| **Onboarding** | Partial, and split across two shapes (see item 1 note): `config.onboarding.mode` (survey/baseline_quiz/skip) + `steps[]` + `diagnostic?`, plus `metadata.onboarding.welcome`/`steps[]` (field-intake, id/field/prompt/required). These do not appear to be unified — no cross-reference validation ties `metadata.onboarding.steps` to `config.onboarding.steps`. |
| **`diagnostic_quiz`** | Supported as `config.onboarding.mode === "baseline_quiz"` + `baselineDiagnosticSchema` (id, title, description, threshold, questions — reusing `quizQuestionSchema`, forced to `multiple_choice`+`graded`). Grep for the literal string `diagnostic_quiz` found nothing — the concept exists under a different name (`baseline_quiz`/`diagnostic`), so a spec that names it `diagnostic_quiz` needs an explicit mapping note for Sam. |
| **`assessment` modes `web_quiz` / `reteach_gate`, `passThreshold`, `showScoreToLearner`, `blocking`** | **Nothing.** Grep for `web_quiz`, `reteach_gate`, `passThreshold`, `showScoreToLearner` across `apps/web/src` returned zero matches. Today's `config.assessment` (line 609) has `passing` (dimension/threshold/confidenceFloor/minTurns/maxTurns), `onMaxTurnsWithoutPass` (`complete_with_scores`\|`return_for_reteach`\|`flag_mentor`), `allowRetake`, `blocking` (this one already exists, boolean, default true), and `autoAppendTeachBack`. There is no `mode` enum distinguishing a web-quiz-style assessment from a reteach-gate-style one, no `passThreshold` field name (closest is `passing.threshold`), and no `showScoreToLearner` toggle (closest is `studentVisibleDimensionKeys`, which is a dimension allowlist, not a boolean). This is a **real gap**, not a naming mismatch — the whole concept of authoring which *mode* an assessment runs in doesn't exist; today assessment behavior is implicit in `teach_back.delivery` (`inline` vs `gated_session`) plus channel support in `channelSupport.ts`, not an explicit `mode` field. |
| **Project with milestones** | Solid support: `outcomeSchema.project` (title/description/deliverables) + `milestones[]` (key/name/availability/checkDescription) + `mentorResources[]`, with real referential cross-validation (line 653, 1008). This is the most mature part of the target palette already. |
| **`milestoneRef` on `teach` blocks** | **Nothing.** No block variant has a field linking it to a milestone. The only milestone linkage today is `milestone.availability.type === "after_lesson" → lessonKey"` (lesson-level, not block-level) and `mentorResources[].milestoneKey`. A block-level `milestoneRef` would be new surface. |
| **`handoff` on every block type** | **Already fully supported** — it's on `blockBase` (line 212), so it is present on all six variants today, not just `teach`. Confirmed live: `LessonPlayer.tsx` line 443 renders `block.handoff` as a `"prompt"`-kind thread item. No work needed here beyond documenting it. |
| **Metadata** | Present and reasonably rich (`metadataSchema`, item 1 above) — packageId/title/description/languages/version/author/identity/terminology/learnerContext/onboarding/scheduledCheckins/delivery. |
| **Weblinks** | Supported today as `resource` block, `resource.type === "weblink"` (url/label/description). Validates but has no renderer (see item 1/2). |
| **Third-party links** | No distinct concept from `weblink` in schema; would likely reuse `resource.weblink` unless "third-party" implies different metadata (attribution, auth requirement) not currently modeled. |
| **Textbook references** | Supported today as `resource.type === "textbook_reference"` (title/isbn/chapter/page/callout, all optional). Also a separate, lesson-level `provenance` field (`sourceDocument/chapter/page/reviewedBy/reviewedAt`) exists for a related-but-different purpose (grounding traceability, not a learner-facing reference) — worth disambiguating for Sam so he doesn't conflate the two. |
| **MCP connector declarations** | Supported today as `resource.type === "mcp_connector"` (`connector: string`, `context?: string`) — a free-text connector name with no enum/registry validation of which connectors actually exist or how the AI is supposed to invoke them at runtime. Schema-level placeholder only; no runtime wiring found (grep for `mcp_connector` consumption came back empty outside the schema file itself). |

**Summary read for item 6**: the outcome/milestone/project system and `handoff` are already there and don't need schema changes. `resource` sub-types (weblink/textbook/mcp) exist at schema level but have **zero renderer** in either delivery surface — that's a build gap, not a schema gap. The genuinely *missing* schema surface is: course intro message, unified onboarding (currently split two ways), an explicit assessment `mode` (web_quiz/reteach_gate) with `passThreshold`/`showScoreToLearner`, and block-level `milestoneRef`.

---

## 7. Validation

- **Zod-backed**, not plain TypeScript — every schema in `journey-package.schema.ts` is a `z.object`/`z.discriminatedUnion` with `.refine`/`.superRefine` cross-checks; types are derived via `z.infer`/`z.input` (lines 1046-1059), not hand-written interfaces.
- **Package validator**: `journeyPackageSchema.safeParse(...)`, invoked directly by `validateAndImport` (`import-journey-package.ts` line 361) for file/API ingestion. A **separate**, DB-backed validator exists for the publish step — `validateForPublication(versionId)` in `apps/web/src/lib/journey-package/publication.service.ts` (line 47) — which re-validates the stored `ProgramVersion.config` against `programVersionConfigSchema` and additionally checks `graduation.requiredLessonKeys` exist in the linked collection, `alertRules[].dimensionKey` and `graduation.requiredDimensionKeys` exist in `trackedDimensions`. These are two distinct validators at two distinct stages (file-ingestion-time vs publish-time) and Sam should be told about both.
- **Package tests beyond `skills-tool-calls-package.test.ts`**: yes, substantially more. In `apps/web/src/lib/journey-package/__tests__/`: `journey-package.schema.test.ts` (392 lines, core schema behavior), `v11.schema.test.ts`, `ungradedQuiz.test.ts`, `dashboard-panels.schema.test.ts`, `dashboard-panels.resolve.test.ts`, `help-request.schema.test.ts`, `help-request-config.test.ts`, `project-selection.schema.test.ts`, `import-journey-package.test.ts`, `import-journey-package.guard.test.ts`, `ai-essentials-artifact.test.ts`. Adjacent, related test coverage: `apps/web/src/lib/player/__tests__/grading.test.ts` (`gradePlayerBlock`), `apps/web/src/components/player/__tests__/blockFeedback.test.ts`, `apps/web/src/lib/lessons/__tests__/gate-detection.test.ts` (`getGateAtPosition`/`hasGates`), `apps/web/src/lib/ai/assessment/__tests__/channelSupport.test.ts`, `apps/web/src/lib/ai/assessment/__tests__/e2e-config-resolution.test.ts`, and `scripts/convert-learnmachine-package.test.ts` for the identity-matching converter.

---

## What Sam can safely author today

- Full `metadata` block: `packageId`, `title`, `description`, `languages`, `version`, `author`, `identity` (mentorName/displayName), `terminology.participant`, `delivery.surface`/`supportedChannels`.
- `config.aiBehavior`, `config.responseStyle`, `config.trackedDimensions`, `config.alertRules`, `config.graduation`, `config.dashboard.panels`.
- Full `curriculum.lessons[]`: `key`, `title`, `category`, `keyConcepts`, `selfCheckQuestions`, `exercise`, `commitment`.
- `teach` blocks: `role`, `content`, `presentation`, `expectsResponse`, and `handoff` — this is the block type the player and MI2024 both fully support.
- `teach_back` blocks with `delivery: "inline"` — works on every surface. `delivery: "gated_session"` works but is **web-only** (see item 2); Sam should not rely on it for a WhatsApp-delivered course.
- `quiz_checkpoint` and `drag_order` blocks, including `graded`/ungraded questions — **fully live in the player surface** (rendered and graded), but invisible to the MI2024 chat surface. Fine for a new web/player course; not usable for anything MI2024-adjacent.
- `outcome.project`, `outcome.milestones` (with `availability`), `outcome.mentorResources` — the most mature part of the schema, cross-validated end to end.
- `config.onboarding.mode: "baseline_quiz"` + `baselineDiagnosticSchema` — works and is exercised by the real AI Essentials package (`content/ai-essentials.package.json`, generated by `scripts/convert-learnmachine-package.ts`), which is a good reference example to hand Sam directly.
- `config.helpRequest`, `config.projectSelection` — both schema-complete with dedicated tests.

## What is not ready

- **`media` and `resource` blocks**: schema-valid, importable, count toward progress — but **no renderer in `LessonPlayer.tsx`**. Authoring one today produces a stuck learner. Do not hand these to Sam until the player gets a case for them.
- **Assessment `mode` (`web_quiz`/`reteach_gate`), `passThreshold`, `showScoreToLearner`**: none of this exists in the schema yet. Current `config.assessment` only expresses passing threshold + turn limits + retake/blocking booleans via `teach_back.delivery`, not a first-class mode enum. This is new schema work, not a documentation gap.
- **Course intro message**: no field. Would need new schema surface (possibly `metadata.introMessage: LocalizedString` or similar) plus a runtime consumer.
- **Unified onboarding**: `metadata.onboarding` and `config.onboarding` are two independent, uncross-validated shapes sharing a name. Needs either reconciliation or very explicit disambiguation in the spec before Sam authors against it.
- **Block-level `milestoneRef`**: no field exists on any block variant; only lesson-level `availability.after_lesson` and outcome-level `mentorResources[].milestoneKey` exist today.
- **`mcp_connector` resources**: schema placeholder only, no runtime invocation path found — authoring one documents intent but nothing acts on it yet.
- **Quiz question extension for `fill_blank`/`matching`**: `quizQuestionSchema` is a flat object keyed by `format`, not a discriminated union; extending it safely means following the existing `multiple_choice`-style `superRefine` pattern per new format rather than restructuring the type, to avoid breaking already-imported packages (schema versioning already gates structural changes — see `LEGACY_SCHEMA_VERSION`/`V11_SCHEMA_VERSION`/`SCHEMA_VERSION` and the version-gated `superRefine` checks at lines 776-801).
- **MI2024 freeze surface**: any new block type is safe to add (MI2024's `transformToLessonData` only ever reads `teach` and `teach_back`), but changing the *shape* of `teach` or `teach_back` risks breaking the frozen chat surface — those two block types' current fields (enumerated in item 4) are the load-bearing contract.
