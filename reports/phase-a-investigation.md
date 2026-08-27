# Phase A.0 Investigation Report — Enrollment as a First-Class Entity

Date: 2026-08-21
Scope: investigation only, per instructions. No schema, migration, or application code was changed. Three throwaway diagnostic scripts (`scripts/_phaseA_counts.ts`, `_phaseA_backfill_risk.ts`, `_phaseA_detail.ts`) were created under `apps/web/scripts/` to query row counts and relationships directly against the Neon database via the existing `PrismaNeon` adapter pattern (same pattern as `scripts/backfill-phase1.ts`), then deleted after use. The repo has no other working-tree changes.

**Preliminary note:** `Platform_Restructure_Plan_v1.md`, referenced in the task as the approved plan this phase belongs to, does not exist anywhere in `~/dev/oci` (searched by filename and by grepping all `*.md` files for "Phase A"). The repo root has four *other* plan docs (`MI_Platform_Abstraction_Plan_v1.md`, `Multi_Channel_Delivery_Architecture_v1.md`, `Prompt_Layer_Abstraction_Spec_v1.md`, `Platform_Backlog_Canvas_Plan_v1.md`) but none is titled or aliased as the restructure plan. The "Contradictions" section at the end therefore checks findings against the framing given in the task prompt itself, not against a document I could open. This should be resolved before A.1 starts — if the plan exists elsewhere (Drive, Notion), it needs to land in the repo.

---

## 1. Coupling inventory

All models below are from `apps/web/prisma/schema.prisma`. Row counts are live, queried directly against Neon (`ep-bold-bar-adzjnfe0-pooler...`) on 2026-08-21.

| Model | Current keying | Scope | Row count |
|---|---|---|---|
| `BlockProgress` (schema.prisma:698) | `socioId, collectionKey, lessonKey, blockId` (`@@unique` at 715, `map: "block_progress_identity_key"`) | Coursework — needs `enrollmentId` | 70 |
| `Message` (schema.prisma:194) | `socioId`; `metadata: Json?` carries player-surface context (`surface`, `courseCode`, `collectionKey`, `programVersionId`, `lessonKey`, `blockId`, `intent` — see `matchesExpansionParent`, `service.ts:51`) | Mixed — the row itself is a chat-channel primitive (person-scoped: `senderType`, `role`, `content`), but the player-surface metadata inside it is coursework-scoped. This is a genuine split inside one table, not a clean either/or. | 455 |
| `LearnerProject` (schema.prisma:560) | `enrollmentId` (FK, cascade) + a redundant `socioId` and `organizationId` | Already coursework/enrollment-scoped | 0 |
| `AssessmentSession` (schema.prisma:857) | `socioId, lessonKey, attemptNumber` (`@@unique` at 879) + `organizationId` (no FK to Organization) | Coursework — needs `enrollmentId` | 9 |
| `SocioFeedback` (schema.prisma:97) | `socioId, lessonNum` | Coursework — needs `enrollmentId` (`lessonNum` is meaningless without knowing which course) | 0 |
| `SocioDimensionState` (schema.prisma:369) | `socioId, dimensionKey` (`@@unique` at 382) — **no course scoping of any kind** | Ambiguous by design today: `dimensionKey` matches `DIMENSION_DEFINITIONS`, which is shared vocabulary (comprehension/confusion), so this may be intentionally person-level sensing state. But if two concurrent courses produce different comprehension signals, one row can't hold both. Needs a decision, not just an `enrollmentId` bolt-on. | 9 |
| `SocioProgress` (schema.prisma:214) | `socioId` — **one row per socio, period** (`@unique` at 216) | Coursework, and structurally incompatible with multi-course today: `currentLessonNumber`, `completedLessons`, `weeklyUnderstanding` etc. This is the chat surface's own progress table (feeds MI2024). It has no `collectionKey` at all, unlike `BlockProgress`. | 23 |
| `DiagnosticAttempt` (schema.prisma:721) | `socioId, collectionKey` (indexed) + `programVersionId` (FK) | Coursework, and it's the *only* table in this list that already carries a direct FK to `ProgramVersion` rather than a denormalized string key | 0 |
| `MilestoneProgress` (schema.prisma:904) | `socioId, collectionKey, milestoneKey` (`@@unique` at 920) | Coursework — and the schema comment at line 901-903 says so explicitly: *"RETAKE BLOCKER: this identity is still socioId + collectionKey + milestoneKey. It must become enrollment-scoped before AI Essentials supports retakes, or two enrollments in the same collection will share capstone milestone state."* This is a pre-existing, named backlog item for exactly this restructure. | 0 |
| `LessonProgress` (schema.prisma:297) | `socioId, lessonNumber` (`@@unique` at 308, `map: "lesson_progress_socio_lesson_key"`) | Coursework — same shape problem as `SocioProgress`; MI2024's own compat table (schema comment at 696-697 on `BlockProgress` confirms `LessonProgress` is "the compatibility aggregate and is intentionally not changed by this model") | 22 |
| Person-scoped, confirmed NOT needing `enrollmentId`: `SocioFlag` (248), `SocioContext` (332), `MessageSentiment` (313), `FinancialSnapshot` (353) | `socioId` only | Person-scoped by design — these describe the learner, not their coursework | 29 flags |

Expected-list cross-check: block progress ✓, player thread Message ✓ (with metadata shape noted), LearnerProject ✓ (already enrollment-scoped — see item 4), assessment sessions ✓, feedback ✓, dimension state ✓ (flagged as ambiguous), SocioProgress ✓.

---

## 2. Current single-course binding

**Two mechanisms exist, and they are not equally "legacy."**

**Chat surface (MI2024, frozen):** `Socio.curriculumCollectionKey` (schema.prisma:68), a single nullable string, set once via `repo.setSocioCurriculum()`. `DEFAULT_COLLECTION_KEY = "mi-colombia-curriculum"` (`apps/web/src/lib/lessons/db-lesson-service.ts:26`) is used only as the collection to preload at boot (line 334), not as a live fallback in the read path anymore — `scripts/backfill-curriculum-key.ts` exists specifically to eliminate NULLs so that fallback could be removed. `messaging/handler.ts:229,449` reads `socio.curriculumCollectionKey` directly to pick lesson content.

**Player surface:** `resolvePlayerAccess(identity, courseCode)` in `apps/web/src/lib/player/service.ts:65-122`. `courseCode` → `collectionKey` via `resolveCourseCode()` (`src/lib/courses/resolver.ts:65`, backed by the `COURSE_CODES` map at line 24: `MI2024 → mi-colombia-curriculum`, `PBJ → pbj-basics`, `AIESS → ai-essentials`, `SKILLS → skills-tool-calls`). Critically, for the non-LTI path it **first gates on `socio.curriculumCollectionKey !== collectionKey`** (line 93) — the exact same single-string field the chat surface uses — and only *then* looks up a real `Enrollment` row (`playerRuntimeRepo.enrollment.findFirst`, lines 96-107) to get `programVersionId`/`config`/`enrollmentId`. `PlayerAccess` (line 16-26) and `ValidatedPlayerContext` (line 30-49) both already carry `enrollmentId` as a first-class field.

**Finding, stated directly: this is not "two parallel systems that don't talk to each other."** It's one relational `Enrollment`/`ParticipantProfile` system that the player surface already uses for authorization and content resolution, sitting *behind* a single legacy gate field (`Socio.curriculumCollectionKey`) that both surfaces still share and that the player surface has not yet been freed from. The LTI branch (lines 78-91) does *not* use `curriculumCollectionKey` at all — it resolves the enrollment purely from `LtiContext`/`Enrollment`, which is the shape a multi-course, non-legacy path would take. So the codebase already contains a working example of enrollment-first course binding; it's LTI-only today.

The practical consequence for "one learner, multiple concurrent courses": as long as `resolvePlayerAccess`'s non-LTI branch keeps gating on `curriculumCollectionKey`, a socio can only ever be authorized into the single course that field currently names, no matter how many `Enrollment` rows exist for them. That gate, not a missing `Enrollment` table, is the actual single-course constraint on the player surface.

---

## 3. Course config location

**Two places, with different contents and different lifecycles — verified against `apps/web/src/lib/journey-package/journey-package.schema.ts` and the import path (`scripts/import-ai-essentials.ts` → `src/lib/journey-package/import-journey-package.ts` → `publication.service.ts`):**

- **`ContentCollection`** (schema.prisma:644) holds only `organizationId, slug, name, description`. The importer writes `name: pkg.metadata.title, description: pkg.metadata.description` (`import-journey-package.ts:170-171,176-177`) — a lossy copy of two strings, not a full round trip. `ContentCollection` has no `metadata` JSON column at all.
- **`ProgramVersion.metadata`** (schema.prisma:483, comment: *"complete JourneyPackage.metadata, including delivery"*) is where the *entire* `pkg.metadata` object is stored verbatim: `import-journey-package.ts:296` and `:305` both do `metadata: pkg.metadata as object`. This is a real, working round-trip path today — `resolveDelivery()` (`src/lib/journey-package/delivery.ts:16-24`) already reads `metadata.delivery` back out of exactly this column at runtime, with a legacy-safe fallback.

**Answer:** a new `listed: boolean` and a course-level intro message belong in `metadataSchema` (`journey-package.schema.ts:738-760`), as siblings of the existing `delivery` field (`:754-759`). Add them to the manifest JSON (e.g. `content/ai-essentials-1.1.2.package.json`'s `metadata` block), they validate through `metadataSchema`, they get stored verbatim onto `ProgramVersion.metadata` by the existing importer code (no importer change needed beyond the schema addition), and a new resolver function analogous to `resolveDelivery()` reads them back at runtime. Putting them on `ContentCollection` instead would require a new DB column, a new importer write path, and would NOT be authored in the package file — it would live only in the DB, breaking round-trip.

**AIESS/SKILLS/PBJ/MI2024 → collectionKey mapping** (confirmed live in DB, not just in code): `COURSE_CODES` (`resolver.ts:24-29`) — `MI2024→mi-colombia-curriculum`, `PBJ→pbj-basics`, `AIESS→ai-essentials`, `SKILLS→skills-tool-calls`. All four exist as `ContentCollection` rows today (`slug` values confirmed via query): `pbj-basics`, `mi-colombia-curriculum` (2 ProgramVersions: `1.0.0 archived`, `1.1.0 published`), `ai-essentials` (2 versions: `1.1.1 archived`, `1.1.2 published`), `skills-tool-calls` (5 versions, `2026.5 published`, rest archived).

---

## 4. Partial unique index precedent

From `apps/web/prisma/migrations/20260814010000_add_learner_projects/migration.sql`:

```sql
-- Prisma schema syntax cannot represent this partial unique index. Keep it in
-- migration SQL: it preserves history while preventing two current projects.
CREATE UNIQUE INDEX "learner_projects_current_enrollment_key"
  ON "learner_projects"("enrollment_id")
  WHERE "status" IN ('DRAFT', 'ACTIVE');
```

Schema annotation (schema.prisma:557-559, directly above `model LearnerProject`):

```
/// The learner-authored project selection for one enrollment. Historical
/// CHANGED/ABANDONED rows are retained; raw migration SQL enforces at most one
/// current (DRAFT or ACTIVE) row because Prisma cannot express partial indexes.
```

**This does not transfer verbatim to the ask in the prompt.** The `LearnerProject` index is a single-column partial unique index on a column (`enrollment_id`) that already exists on that table and already, by construction (via `Enrollment.@@unique([participantId, cohortId])`), identifies exactly one (learner, cohort) pair. `Enrollment` itself has **no `learnerId` column** (it's `participantId`) and **no `collectionKey` column** — a course is only reachable from `Enrollment` by joining through `programVersionId → ProgramVersion.collectionId → ContentCollection.slug`. Postgres partial unique indexes cannot reference a joined table's column. So `UNIQUE (learnerId, collectionKey) WHERE status = 'ACTIVE'` as literally specified is not buildable against the current `Enrollment` table — it requires first adding a denormalized `collectionKey` (or `collectionId`) column to `Enrollment` and renaming/aliasing `participantId`→`learnerId` or accepting `participantId` as the learner identity. This is a concrete gap A.1 needs to plan for, not just execute.

Separately: `Enrollment`'s current `@@unique([participantId, cohortId])` (schema.prisma:544) already permits multiple *active* enrollments for the same learner in the same `collectionKey` across different cohorts (e.g., a retake in a new cohort, or the `direct-web` cohort created ad hoc per organization in `api/auth/curriculum/route.ts:188-191`) — nothing today stops two simultaneously-ACTIVE enrollments in one course. That's precisely the gap the proposed partial index is meant to close.

---

## 5. `/home` route

**`/home` is not free — it already exists and does something specific.** `apps/web/src/app/home/page.tsx` is a server component that: no session → redirect to `/login?redirect=/home`; `role === 'socio'` → `redirect(await resolveLearnerHome(session.userId))`; `role === 'admin'` → `/admin`; else → `/dashboard/learners`. `apps/web/src/proxy.ts:96` sends socios here after login (`session.role === 'socio' ? '/home' : '/dashboard/learners'`).

`resolveLearnerHome()` (`apps/web/src/lib/courses/learnerHome.ts:8-81`) is a **single-destination router, not a listing page**: it reads `socio.curriculumCollectionKey` (one value), finds one active `Enrollment` matching it, resolves one `ProgramVersion`, and returns exactly one path — `/join`, `/chat`, or `/learn/{courseCode}/{...}` (diagnostic, project-setup, a specific lesson, or capstone) depending on progress. There is no code path in it that returns more than one course or enumerates `Enrollment` rows across collections.

Non-test callers of `resolveLearnerHome` (blast radius for changing its contract from "one path" to "a list"):
- `src/app/home/page.tsx` (the redirect itself)
- `src/app/api/auth/curriculum/route.ts:209` — `homePath: published ? await resolveLearnerHome(socio.id) : '/chat'`, returned in the course-selection API response and presumably consumed client-side for navigation
- `src/app/api/auth/me/route.ts`
- `src/app/api/lti/home/route.ts`

**What changes for the learner role:** today, landing on `/home` as a socio always bounces you straight into whatever single course `curriculumCollectionKey` names. Making it "list all courses with per-course progress" means `home/page.tsx` stops calling `redirect()` unconditionally and instead renders a list — which in turn means `resolveLearnerHome`'s single-enrollment lookup either gets replaced by an enumeration function or gets kept as-is for the other three call sites (which each want one path, not a list) while a new function serves the page. This is a real design fork, not a drop-in.

---

## 6. Repo layer surface

**ESLint rule is active** (`apps/web/eslint.config.mjs:57-77`): `no-restricted-syntax` bans `MemberExpression[object.name='prisma']` (any `prisma.<model>.*` or `prisma.$*`) outside a documented ignore list (`:19-56`) covering `src/lib/repo/**`, `src/lib/db.ts`, `src/lib/journey-package/**`, `src/lib/lessons/db-lesson-service.ts`, `src/lib/ai/prompts/resolveScope.ts`, `src/lib/auth/courseScope.ts`, test files, `src/app/api/admin/**`, `src/app/admin/**`, `src/app/api/auth/**`, `src/lib/config/**`, `src/lib/ai/sensing/**`, `src/lib/summary/**`, `src/lib/ai/trace/**`.

**Legacy `repo` (`src/lib/repo/types.ts`, 478 lines) methods that are coursework-scoped by `socioId` alone and would need an `enrollmentId` parameter (or an `Enrollment`-scoped equivalent):**
- `getSocioProgress`, `initProgress`, `advanceMessage`, `resetMessageIndex`, `completeLesson`, `recordReminder`, `resetReminders`, `touchInteraction` (:330-340) — all `SocioProgress`
- `upsertLessonProgress`, `getLessonProgressAll` (:402-403) — `LessonProgress`
- `createFeedback`, `getFeedback` (:444-445) — `SocioFeedback`
- `getMilestoneProgress` (:470, already takes `collectionKey` — needs `enrollmentId` per the schema comment in item 1)
- `getMessages`, `addMessage`, `getMessagesWithSentiment`, `getUserMessageDates`, `getLastAssistantMessageAt` (:311-328) — `Message`, if the player-metadata portion of the row is to become enrollment-scoped

**Already `Enrollment`-scoped, in `TenantRepo` (`src/lib/repo/tenantRepo.types.ts:387-414`):** `getEnrollments`, `getEnrollmentById`, `getEnrollmentsByParticipant`, `createEnrollment`, `updateEnrollmentStatus`, plus the full `LearnerProject` CRUD surface (`getCurrentLearnerProject`, `learnerProjectSelectionRequired`, `saveLearnerProjectInterests`, `saveLearnerProjectLifeContext`, `stageLearnerProject`, `putLearnerProject`), all already taking `enrollmentId`. This means the Enrollment repo layer does not need to be built from scratch — it exists and is exercised.

**Person-scoped, no `enrollmentId` needed:** `SocioFlag` methods (:357-401), `getSocioContext`/`upsertSocioContext` (:418-419), `saveSentiment`/`getSentimentsBySocio` (:414-415), `getDimensionState*`/`upsertDimensionState`/`clearDimensionState` (:422-425) — matches item 1's person-scoped list.

**Adversarial tenant test suite** (`src/lib/repo/__tests__/tenantIsolation.test.ts`) is organized by attack category, each a `describe` block with `it('BLOCKS: ...')` / `it('ALLOWS: ...')` naming: `Cross-Tenant Read Attacks`, `Cross-Tenant Write Attacks`, `Guessed ID Probing Attacks`, `Indirect Resource Access via Relations`. **`Enrollment` already has a case here** — `describe('Enrollment access through Cohort->Program relation')` → `it('BLOCKS: Org A context accessing Org B enrollment')` (line ~478), asserting `tenantPrismaRepo.getEnrollmentById(ctxOrgA, ENROLLMENT_B_ID)` rejects with `TenantIsolationError`. New Enrollment cases (e.g., for whatever multi-course logic A.1 adds) should extend this same file under the matching `describe` block using the same mock-and-assert shape. There is a second, complementary adversarial suite specific to the player surface — `src/lib/player/__tests__/crossOrgAccess.test.ts` — which mocks `playerRuntimeRepo` (`vi.hoisted`) and asserts `resolvePlayerAccess` throws `PlayerError` for cross-org scenarios; this is the file to extend for player-surface-specific Enrollment/course-binding cases, as distinct from the repo-layer suite above.

---

## 7. Migration readiness

`prisma.config.ts` sets `shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL`, explicitly commented as required to be a **direct (non-pooled) Neon URL**. Confirmed both are set and distinct: `DATABASE_URL` host ends in `-pooler.c-2.us-east-1.aws.neon.tech`; `SHADOW_DATABASE_URL` host is the same project without the `-pooler` suffix — correctly non-pooled.

`npx prisma migrate status` (read-only, run against the live DB): **13 migrations found, "Database schema is up to date!"** — clean, no drift, no pending migrations.

I did not run `prisma migrate dev` itself: it is not a read-only command (it can create migrations or prompt to reset the shadow database on drift), which is out of scope for an investigate-only pass. Given `migrate status` reports no drift, a `migrate dev` invoking no schema change would be expected to run clean, but that is inference, not a direct confirmation — A.1 should treat "does migrate dev actually succeed end-to-end against the real shadow DB" as the first thing to verify once schema changes are drafted, not assume it from this status check.

---

## 8. Backfill risk

Live counts (2026-08-21): 23 `Socio` rows (all `status: ACTIVE`), 23 `ParticipantProfile`, only **10** `Enrollment` rows, 4 `Cohort`, 4 `ContentCollection`. `curriculumCollectionKey` distribution: `pbj-basics` 10, `mi-colombia-curriculum` 6, `skills-tool-calls` 7.

**Derivation method (if it worked cleanly):** for each coursework row, join `socioId → ParticipantProfile → Enrollment` filtered by `Enrollment.programVersion.collection.slug === (the row's collectionKey, or the socio's curriculumCollectionKey for tables that don't carry one)`, take the active enrollment.

**This does not resolve unambiguously for all socios today.** Direct query results:

- **13 of 23 socios have a `ParticipantProfile` but *zero* `Enrollment` rows at all** — no candidate to derive from, full stop. Breakdown: 10 are `curriculumCollectionKey: pbj-basics`, 3 are `mi-colombia-curriculum`. Cross-checked against every coursework table for exactly these 13 socios: 252 `Message` rows, 14 `LessonProgress` rows, 9 `AssessmentSession` rows, 8 `SocioFlag` rows (person-scoped, fine) belong to them. `BlockProgress`, `SocioFeedback`, `MilestoneProgress`, `DiagnosticAttempt` are currently 0 for this group, so no *current* rows in those specific tables are unbackfillable — but `LessonProgress` and `AssessmentSession` rows for these 13 socios have no `Enrollment` to attach an `enrollmentId` to.

- **3 additional socios (`mi-colombia-curriculum`) have an `Enrollment` row, but it points at an orphaned `ProgramVersion`** (`id: 30226bf8...`, `status: draft`, `collectionId: null`) — the literal placeholder row `scripts/backfill-phase1.ts` creates (`config: { schemaVersion: '1.0', aiBehavior: {...} }`, no real curriculum). It was never linked to the real, published `mi-colombia-curriculum` collection (`id: 4e1faa40...`, versions `1.0.0 archived` / `1.1.0 published`). Backfilling `enrollmentId` for these 3 by "find the active enrollment whose collection matches" returns **zero matches**, not one — same practical failure as the 13 above, for a different structural reason (stale/dangling enrollment rather than missing one).

- **Root cause, traced to code, not just data:** `POST /api/auth/curriculum` (`src/app/api/auth/curriculum/route.ts:141-198`) only writes `Cohort`/`Enrollment` rows when `isPlayerCourse` is true (`resolveDelivery(...).surface === 'player'`, lines 146-198). For chat-surface courses — which includes MI2024 (frozen, chat) and, per the data, `pbj-basics` (0 active-course Enrollments among its 10 socios) — `curriculumCollectionKey` gets set (line 173) and a `ParticipantProfile` gets anchored (line 175), but **no `Enrollment` is ever created** through live traffic. The only source of `Enrollment` rows for MI2024 is the one-time `scripts/backfill-phase1.ts` run (against a stale placeholder `ProgramVersion`, as above), which has never been rerun and was never extended to `pbj-basics`.

- **0 socios currently have `BlockProgress` spanning multiple `collectionKey` values**, and **0 `BlockProgress` rows fail the enrollment-match check** — i.e., for the one table this backfill is most obviously about, today's data backfills cleanly. The ambiguity is concentrated in `LessonProgress`/`AssessmentSession`/`Message` for the chat-surface population.

**Table that cannot be backfilled unambiguously as specified: none of the *tested* tables have a many-candidate ambiguity (no socio has 2+ enrollments to choose between — `Enrollment.@@unique([participantId, cohortId])` plus the current one-cohort-per-course-per-org shape prevents that today).** The actual failure mode is the opposite: **16 of 23 socios (70%) have no valid Enrollment to attach to at all** — 13 with none, 3 with only a dangling placeholder. Any table with coursework rows for those 16 socios (`LessonProgress`: 14 rows, `AssessmentSession`: 9 rows, plus whatever `Message` rows are treated as coursework) cannot be backfilled by a pure derive-from-existing-Enrollment script. The backfill plan needs an Enrollment-creation pass for the chat-surface population *before* the enrollmentId-population pass can run, extending `backfill-phase1.ts`'s pattern to `pbj-basics` and re-pointing the 3 `mi-colombia-curriculum` stragglers at the real published `ProgramVersion`.

---

## Contradictions with the plan

1. **"We are making Enrollment a first-class entity" is significantly out of date.** `Enrollment` already exists as a full model (schema.prisma:526-548) with a repo-layer CRUD surface (`tenantRepo.types.ts:387-414`), adversarial cross-tenant test coverage, and live production usage in the player surface (`resolvePlayerAccess`, `resolveLearnerHome`) and in `LearnerProject`'s FK. The actual gap is narrower than "build Enrollment": it's (a) coursework tables still keyed by `socioId`+`collectionKey` instead of `enrollmentId` (item 1), (b) chat-surface and `pbj-basics` traffic never writes `Enrollment` rows at all (item 8), and (c) the player surface's non-LTI path still gates on the legacy single-value `Socio.curriculumCollectionKey` ahead of the Enrollment lookup (item 2), which is what actually blocks concurrent multi-course access today — not a missing table.

2. **"/home route... Report ... what changes for the learner role" presupposes /home doesn't exist yet or is a blank slate.** It exists, is wired into the login redirect (`proxy.ts:96`), and is a committed single-destination router (`resolveLearnerHome`) with three other live callers. Turning it into a course-listing page is a contract change to a function with an existing multi-caller API, not a greenfield build (item 5).

3. **The literal partial unique index `UNIQUE (learnerId, collectionKey) WHERE status = 'ACTIVE'` cannot be reused "verbatim" from the `LearnerProject` precedent**, because `Enrollment` has neither a `learnerId` nor a `collectionKey` column — both would need to be added first (item 4). The precedent transfers as a *pattern* (raw-SQL partial index, Prisma can't express it, document in a `///` comment), not as literal reusable SQL.

4. **The plan document itself (`Platform_Restructure_Plan_v1.md`) could not be located anywhere in the repo.** Every other finding above was checked against the task prompt's framing, not against the plan's actual text — if the plan says something more specific than what's paraphrased in the prompt, some of the above may need re-checking against it directly.

5. **Backfill is not a clean "derive from what exists" operation for 70% of socios (item 8).** The plan's Phase A likely assumes existing `BlockProgress`/`LessonProgress`/etc. rows can be joined to an existing `Enrollment` to get `enrollmentId`. For 16 of 23 socios that join returns nothing (13 missing entirely, 3 pointing at a dangling placeholder `ProgramVersion`), because the only two sources of `Enrollment` rows are the player-course live-traffic path (item 8's `isPlayerCourse` gate) and a one-time, MI-only, never-rerun backfill script. An Enrollment-*creation* backfill has to precede the enrollmentId-*population* backfill.

6. **`SocioProgress` and `LessonProgress` are structurally single-course** (one row per `socioId`, no `collectionKey` at all on `SocioProgress`) and are explicitly the chat/MI2024 surface's own tables (per the `BlockProgress` schema comment: "the compatibility aggregate ... intentionally not changed"). If MI2024 is frozen/read-only as instructed, these two tables likely stay exactly as they are rather than gaining `enrollmentId` — worth confirming explicitly in the plan, since item 1 lists them alongside tables that clearly do need enrollment-scoping.
