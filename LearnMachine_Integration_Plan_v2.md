# Learn Machine → OCI Integration Plan v2

**Status:** Proposed
**Supersedes:** `LearnMachine_Integration_Plan_v1.md` (v1 planned one path; v2 forks it and
de-risks the migration)
**Target repo:** `Mentors-International-Chatbot/MI-AI-Mentorship-Tool` — `apps/web`
**Source repo:** `michaelbertoldo/LEARNMACHINE` — local at `~/Desktop/Finance Trainer`
**Companion to:** `MI_Platform_Abstraction_Plan_v1.md`, `Prompt_Layer_Abstraction_Spec_v1.md`,
`Multi_Channel_Delivery_Architecture_v1.md`, `Platform_Backlog_Canvas_Plan_v1.md`

---

## 0. What changed from v1, and why

v1 was an honest plan for the wrong project. The stated goal was *"add a third course."*
v1 delivered *"add a second delivery surface, using a course as the occasion"* — roughly 6–8
weeks of surface work wearing a 4-week course-work label. That may still be what you want. It
should be chosen deliberately, not arrived at.

v2 changes four things:

1. **Forks the plan** into Option A (inline rich cards, one surface) and Option B (full lesson
   player, second surface), with a shared Phase 0 and an explicit decision point after it.
2. **Removes the only production-data risk.** `LessonProgress` is not touched at all. See §5.
3. **Fixes four defects** in v1's schema work, one of which already exists in the live file.
4. **Names the sensing-signal risk**, which nobody had written down and which fails quietly.

---

## 1. The finding that shapes everything (unchanged from v1)

**OCI already specified the destination. Nobody built the renderer.**

`journey-package.schema.ts:102–190` defines `lessonBlockSchema` with five variants. The runtime
consumes **two** — `db-lesson-service.ts:123–142` filters for `teach` and `teach_back`.

- `quiz_checkpoint` carries the comment *"RESERVED for V2 delivery … the V1 runtime does not
  grade or gate on it yet."*
- `media` and `resource` have zero consumers outside the schema and the PB&J example.
- `config.onboarding.mode` accepts `"baseline_quiz"` (`:313`) with no runtime consumer anywhere.

**Scope collapse:** AI Essentials uses three block types across 17 lessons, 95 blocks.

```
40  prose
38  mcq
17  drag_order
```

No formulas, no graph-select, none of the four finance widgets. Both apps are React 19 +
Tailwind 4.

---

## 2. The fork

Both options consume the same Phase 0 artifact. Choose after 95 blocks are sitting in the
database, not before.

### Option A — Inline rich cards *(~10 days)*

`quiz_checkpoint` and `drag_order` render as tappable cards **inside the existing chat surface**,
the way `AssessmentGateCard` already does. The AI still drives the lesson; questions arrive as UI
instead of typed text. `prose` stays narrated — the AI says it, as today.

- One surface. One progress model. One place learners talk to the AI.
- No new route, no `metadata.delivery`, no `presentation` field, no second navigation model.
- Directly serves the stated goal ("better UI and Q&A"), not a proxy for it.
- **Loses:** the block-stepper reading experience, the 40 prose blocks as *read* content, and
  Learn Machine's visual pacing — which is the part you said you liked.

### Option B — Full lesson player *(~6–8 weeks realistically)*

v1's plan. A `/learn` route wrapping a ported `LessonPlayer`, blocks rendered in sequence,
tutor docked beside it.

- Delivers the Learn Machine experience as it actually exists.
- Requires `presentation`, `metadata.delivery`, `BlockProgress`, a second navigation model, and
  a second place the learner converses.
- **This is a platform capability, not a course.** Priced and staffed accordingly, it's
  defensible. Mislabeled as "adding a course," it will run over and feel like failure.

**Option A is a strict subset of Option B.** The converter, the block components, and the
schema work for `quiz_checkpoint`/`drag_order` are identical. Nothing built for A is wasted if
B follows. That asymmetry is the reason to start with A.

---

## 3. What crosses, what doesn't

### Take (both options)

| Asset | Path | LOC | Note |
|---|---|---|---|
| Block registry pattern | `frontend/src/blocks/registry.tsx` | 44 | Copy the pattern, not the finance entries |
| `McqBlock` | `frontend/src/blocks/McqBlock.tsx` | — | |
| `DragOrderBlock` | `frontend/src/blocks/DragOrderBlock.tsx` | — | pulls `@dnd-kit/{core,sortable,utilities}` |
| AI Essentials content | `backend/content/ai-essentials/` | 17 lesson JSON + `curriculum.json` + `placement-diagnostic.json` | |
| Capstone config | `services/capstone_service.py` → `CONFIGS["ai"]` | — | title, brief, 5 deliverables, 5 milestones |

### Take (Option B only)

| Asset | Path | LOC | Note |
|---|---|---|---|
| `ProseBlock` | `frontend/src/blocks/ProseBlock.tsx` | — | pulls `react-markdown`, `remark-gfm` |
| `LessonPlayer` shell | `frontend/src/components/LessonPlayer.tsx` | 225 | **floor, not an estimate** — see §8 |
| `TutorPanel` layout | `frontend/src/components/TutorPanel.tsx` | 446 | shell only; replace the transport |

### Leave (both)

Supabase auth · FastAPI backend and all SQLAlchemy models · `react-router-dom`, TanStack Query,
`api/client.ts` · the four finance widget block directories · SRS, drill, mock interview,
analytics, admin console · `lib/tutorUtils.ts` localStorage history · LM's soft mastery check
(`≥7/10`, `TutorPanel mode="checkpoint"`).

### Reference — read, don't port

`backend/app/services/lti_service.py` (349 LOC) + `routes/lti.py` (63) is a **working LTI 1.3
implementation**. `Platform_Backlog_Canvas_Plan_v1.md` §6 has LTI as plan only. Read this before
the LTI-A prompt — launch → validate → auto-provision → link is already solved once, in your own
code, including deep-link.

---

## 4. Schema work

### 4.1 Four defects in v1, fixed

**(a) The Zod snippet was broken — and the bug is already in your file.**

```ts
z.enum([...]).default("narrated").optional()   // ✗ .optional() short-circuits on undefined;
                                               //   the default never applies.
                                               //   Output: "narrated" | "rendered" | undefined
z.enum([...]).default("narrated")              // ✓ .default() alone already makes input optional
```

Live instance — `journey-package.schema.ts:133`:

```ts
delivery: z.enum(["inline", "gated_session"]).default("inline").optional(),   // ✗
```

Three lines above it, the correct order is used:

```ts
confidenceFloor: z.number().min(0).max(1).optional().default(0.5),           // ✓ :97
minTurns:        z.number().int().positive().optional().default(2),          // ✓ :98
maxTurns:        z.number().int().positive().optional().default(12),         // ✓ :99
```

Benign **today** only because all four read sites test `=== "gated_session"`, so `undefined`
and `"inline"` behave identically (`createAssessmentSession.ts:150`, `db-lesson-service.ts:138`,
plus two tests). The moment any reader tests `=== "inline"` it becomes a live bug. Worth its own
one-line fix commit, independent of this project.

**(b) There is no `meta` key.** `journeyPackageSchema` has exactly `schemaVersion`, `metadata`,
`config`, `curriculum`, `outcome`. `Multi_Channel_Delivery_Architecture_v1.md` §4 writes
`meta.delivery`; `Platform_Backlog_Canvas_Plan_v1.md` §5 writes `meta.dashboard.panels`. **Both
docs have drifted from the schema.** Decide once: `metadata.delivery`, or add a real `meta`
block. Then correct both companion docs so the next reader doesn't inherit the drift.

And since `delivery` is optional, resolve it through **one function** —
`resolveDelivery(pkg): DeliveryConfig` — not `?? "chat"` scattered at read sites. Same lesson as
`isFlagActive()` / `activeFlagWhere()`.

*(Option A needs none of this. It's Option B work.)*

**(c) Block IDs don't exist in the source and must survive converter re-runs.**
LM blocks are bare array entries with no `id`. `blockBase.id` is required and package-wide
unique, and `BlockProgress` rows will reference it. Generating `${lessonKey}-b${index}` means
inserting a block at position 3 silently reattaches every downstream learner's progress to the
wrong content — a data-integrity failure of exactly the class already catalogued in the memory
doc (empty `metric_definitions`, `ParticipantProfile` gaps).

**Decision: append-only id map, with hashing used to detect drift — not to define identity.**

v2 initially recommended pure content hashing on the grounds that it makes "the content changed"
and "the id changed" the same event. That reasoning is wrong, and it's wrong for a reason this
codebase has already written down: **a hash cannot distinguish a typo fix from a rewrite.**
Collapsing those two into one event is the same defect as `gates: []` being indistinguishable
from unmet gates — *schema distinguishes intent*, and "identity" and "content changed" are two
intents. Pure hashing also orphans `BlockProgress` on every copyedit, which for a course under
active revision means rolling, low-stakes progress loss that nobody will notice until a learner
asks why a lesson reopened.

Identity and change-detection are separate concerns and get separate mechanisms.

**The map.** `content/block-ids.json`, checked in, append-only:
`{ [lessonKey]: { [blockId]: contentHash } }`.

**The matching rule** (this is the part "maintain an id map" leaves under-specified — without it,
two Claude Code runs will disagree). Per lesson, in order:

1. **Exact hash match** → reuse the existing id. *Handles reordering.*
2. **Positional match among blocks not matched in step 1** → reuse the id, update the stored
   hash, and **log it as drift**. *Handles edits.*
3. **Still unmatched** → mint a new id.
4. **Ids in the map with no match** → log as retired. **Never delete** — a retired id may still
   have `BlockProgress` rows pointing at it.

Anything ambiguous in step 2 (two candidates, or a similarity below threshold) is **flagged for
human review rather than guessed**. A wrong guess here is silent progress misattachment, which is
strictly worse than a converter that stops and asks.

**Canonical hash input** — specify it or two implementations will produce different ids for
identical blocks: `blockType` + the variant discriminator (`role` for `teach`, `format` for quiz
questions) + the normalized text of content-bearing fields (`content` / `prompt` / `items` /
`options`). **Explicitly excludes `order` and array position** — otherwise reordering breaks every
id, which defeats half the reason for moving off index-based ids in the first place.

*(If you ever do want progress to reset on material content change, that's a deliberate
`contentVersion` bump on the block — an author decision, not a side effect of the diff.)*

**(d) `answerKey: options[correct]` turns a stable index into a fragile string.**
`quizQuestionSchema.answerKey` is `z.union([z.string(), z.array(z.string())]).optional()` — it is
string-based, so keeping the raw index isn't available without a schema change. Cheapest correct
fix: a `superRefine` asserting options are unique within a question, so the string→option mapping
stays injective. Edit an option's wording and you still break the key; uniqueness at least means
you can't break it *ambiguously*.

### 4.2 Additions by option

| Addition | Option A | Option B |
|---|---|---|
| `quiz_checkpoint` promoted from RESERVED, `+ explanation` per question | ✓ | ✓ |
| `drag_order` as a first-class variant (graded — `media` is documented non-graded) | ✓ | ✓ |
| Option-uniqueness `superRefine` (4.1d) | ✓ | ✓ |
| `BlockProgress` table, keyed `(socioId, collectionKey, lessonKey, blockId)` | ✓ | ✓ |
| `presentation: z.enum(["narrated","rendered"]).default("narrated")` | — | ✓ |
| `metadata.delivery` + `resolveDelivery()` | — | ✓ |
| `LessonProgress` schema change | **never** | **never** |

---

## 5. The one thing that could lose production state — and how we avoid it

v1 buried this as a bullet inside Phase 1, next to four additive changes:

> `LessonProgress.lessonNumber Int` (`schema.prisma:295`) encodes an MI-only assumption.

That is a **shared table carrying live MI Colombia data**. Migrating it to key-based columns is
the only step in either option that can lose production state, and it was scheduled alongside
routine additive work where it would get routine review.

**Resolution: do not touch `LessonProgress`. At all. In either option.**

- AI Essentials gets a **synthetic lesson index, 1–17**, written into the package and documented
  in the converter as synthetic. `curriculum.json`'s `core_spine` is already a strict linear
  order, so the mapping is total and stable.
- `BlockProgress` is keyed on `(socioId, collectionKey, lessonKey, blockId)` as already
  specified — it never needs a lesson *number*.
- The key-based `LessonProgress` migration becomes **its own project, later**, with its own
  backup, backfill, and rollback — the discipline the memory doc already records for Neon work.

This single reordering removes roughly 90% of the blast radius, and it costs one documented
comment.

---

## 6. Content migration

| Learn Machine | Journey package |
|---|---|
| `prose` | Option A: `teach{role:"explanation"}` (narrated, as today). Option B: `+ presentation:"rendered"` |
| `mcq` | `quiz_checkpoint.questions[]` — `format:"multiple_choice"`, `options`, `answerKey: options[correct]` (see 4.1d), `explanation: explain` |
| `drag_order` | `drag_order` — `prompt`, `items`, `correctOrder` |
| block id | **append-only id map + hash-as-drift-flag** (see 4.1c) — not array index, not raw hash |
| `concepts[]` | `lesson.keyConcepts` + concept tags on blocks |
| `courses.json → concept_labels` (11) | **one `comprehension` dimension + concept tags**, per §9 decision 1 |
| `track` | `lesson.category` |
| lesson order | synthetic index 1–17 from `curriculum.json → core_spine` (§5) |
| `difficulty`, `srs_seeds` | drop — no consumer in OCI |
| `placement-diagnostic.json` (7 items, `pass_threshold: 0.75`) | `config.onboarding.mode: "baseline_quiz"` — enum value exists, runtime does not |
| `CONFIGS["ai"]` | `outcome.project` + `outcome.milestones` (5, each pinned to an `afterLessonKey`) + `outcome.mentorResources` |

Write this as `scripts/convert-learnmachine-package.ts`. Seventeen files, and it will be re-run
every time content changes — which is exactly why 4.1c matters.

Content is English-only; `localizedString` requires `en` and nothing else, so it validates
cleanly with `es`/`pt` absent, falling back per D8.

---

## 7. Phases

### Phase 0 — Converter + package, no UI *(2–3 days · shared by both options)*

Write the converter with the §4.1c id map + matching rule and the synthetic lesson index. Emit
`ai-essentials-journey-package.ts` beside the PB&J example, plus `content/block-ids.json`.
Import through the existing `import-journey-package.ts`.

*Exit:* validates against `journeyPackageSchema`; 17 lessons and 95 blocks land as rows; no UI
exists; `LessonProgress` untouched. Plus three converter tests, because the matching rule is the
whole ballgame:
- re-run with **unchanged** content → byte-identical ids
- re-run with a block **reordered** → ids follow the block (step 1)
- re-run with a block's **text edited** → id is retained and the change is logged as drift (step 2)

**← DECISION POINT: Option A or Option B. Do not decide before this exit.**

---

### Option A path

**A1 — Schema + card components** *(4–5 days)*
`quiz_checkpoint` live with `explanation`; `drag_order` variant; option-uniqueness refine;
`BlockProgress` migration. Port `McqBlock` + `DragOrderBlock` as `"use client"` components
following the `AssessmentGateCard` pattern.
*Exit:* `tsc` clean; MI Colombia and PB&J packages validate untouched; a full MI lesson run is
byte-identical to pre-change output.

**A2 — Inline rendering in chat** *(3–4 days)*
The AI emits a checkpoint marker; the chat surface renders the card; answers write
`BlockProgress`; the conversation continues in the same thread.
*Exit:* a learner completes an AI Essentials lesson end to end in `/chat`, with mcq and
drag-order answered as UI, and every turn persisted as `Message` rows with sentiment.

**A3 — Registration + capstone** *(2–3 days)*
`AIESS` in `COURSE_CODES` / `COURSE_INFO`. Capstone via `outcome` + `MilestoneProgress` —
`prompts/courseOutcome.ts` (added 2026-08-08) already reads `outcome.project`/`.milestones` from
`ProgramVersion.config.outcome` and feeds **coach stance only**, so confirm the AI course's
stance routing actually reaches coach. An outcome the router never surfaces is the same silent
gap as the empty `metric_definitions` table.

**Option A total: 9–12 days for A1–A3, plus Phase 0 → ~11–15 days all-in.**
*(v2 first wrote "~10 days," which both undercounted the A-phase range and silently excluded the
shared Phase 0. Schedule off this line, not that one.)*

---

### Option B path

B1 = A1 **plus** `presentation`, `metadata.delivery`, `resolveDelivery()`.
B2 — `ProseBlock` + registry + `/learn/[courseCode]/[lessonKey]` route wrapping `LessonPlayer`.
B3 — `TutorPanel` shell on OCI transport (`/api/chat`, block as context, `Message` rows).
B4 — Gate + capstone (as A3, plus per-lesson gates if §9 decision 2 says so).
B5 — Surface routing off `metadata.delivery.surface`.

**Add to B3's exit criteria — the sensing check from §8.**

#### B3 measured acceptance note — 2026-08-10

The first fixed three-lesson synthetic run produced 24 enrollment-scoped
`lesson_sensing` observations across six substantive teach-back turns. The
non-null rate was **6/6 eligible turns (100%)**; the controlled MI comparator was
also **6/6 eligible turns (100%)**. Both numerator and denominator are
turns-with-at-least-one-non-null-observation over scripted substantive turns.
This proves pipeline reachability under ideal synthetic input; it is not a
measurement of real learner conversation.

Seven of the eleven AI Essentials dimensions fired: `ai_impact`,
`ai_productivity`, `guardrails`, `hallucinations`, `machine_learning`,
`reasoning`, and `tools_harness`. The four zero-count dimensions are expected
from the lesson 1–3 sample rather than structurally unreachable:

- `model_selection` first appears in lesson 5 and becomes a teach-back principal
  in lesson 12.
- `expert_systems` first appears and becomes a teach-back principal in lesson 6.
- `prompting` first appears and becomes a teach-back principal in lesson 9.
- `ai_systems` first appears in a quiz in lesson 12 and becomes a teach-back
  principal in lesson 15.

Every zero-count dimension is mapped to both quiz evidence and a later
teach-back principal. A six-to-nine-lesson extension cannot exercise all eleven;
the smallest principal-dimension window reaches lesson 15.

A targeted follow-up on the isolated Neon branch
`ai-essentials-acceptance` ran lessons 5, 6, 9, 12, and 15 directly. It persisted
10/10 sentiment rows, produced at least one non-null observation on 10/10 turns,
and observed every prior zero-count dimension: `model_selection` (6),
`expert_systems` (2), `prompting` (2), and `ai_systems` (5). Every selected
lesson's principal teach-back dimension fired and numeric chat progress remained
unchanged. Combined with the first lessons 1–3 run, all eleven declared
dimensions have now been empirically observed. This closes the structural
reachability question; it does not convert either scripted run into evidence
about messy real learner conversation.

The controlled MI comparator explicitly supplied the canonical
`comprehension`/`confusion` contract. The active platform `sentiment` prompt
(`db:1.0`) has no dimensions contract, so the live prompt yielded 0/6 parsed MI
dimension turns even though all six model calls succeeded. Treat central prompt
contract repair as a separate platform decision. The full byte-identical MI
narration regression remains open.

**Option B total: ~6–8 weeks.** The phases above sum to roughly **4 weeks**; the 6–8 figure
carries the §10 port-effort multiplier (Vite → App Router client/server boundaries, which LOC
counts flatter badly). Both numbers are in the doc on purpose — schedule off 6–8, and if the
phase sums are what get used, at least the gap is visible rather than discovered in week 5.

---

## 8. Risks

1. **MI regression.** Structural, not procedural: `presentation` defaults to `narrated`, so an
   unmodified package produces an unmodified prompt. Byte-identical MI lesson run is the exit
   test on A1/B1. *(Option A carries less of this risk — it adds no prose-path change at all.)*

2. **Sensing signal decay — the risk nobody wrote down.** *(Option B specific, and it fails
   quietly.)* Your sensing pipeline learns from conversation. A rendered player means the learner
   *reads* 40 prose blocks instead of talking through them. `MetricObservation` rows,
   `MessageSentiment`, and `AlertRule` thresholds calibrated against chat volume will get
   materially less signal on this course — and they degrade silently, not loudly. Same failure
   class as the empty `metric_definitions` table.

   **Exit criterion for B3:** run 3 full AI lessons and produce a **measured count** of
   `MetricObservation` rows, compared against a comparable 3-lesson MI Colombia stretch. Near
   zero means you learn it in week 3 instead of after the pilot.

3. **`LessonProgress` migration.** Removed from scope entirely (§5). Listed here so it stays
   visible as deferred work, not as forgotten work.

4. **Two grading systems.** LM grades a soft mastery check (`≥7/10`, non-blocking); OCI grades
   through `AssessmentSession` (blocking, dimension-scored, feeds `MetricObservation`). Porting
   both ships a codebase where *"did the learner pass"* has two answers. Take the card, keep
   OCI's grader.

5. **Two tutor histories.** LM writes conversation to localStorage via `saveTutorHistory`; OCI
   writes `Message` rows that sentiment, alerts, and summaries all read. Porting `tutorUtils`
   recreates the two-sources-of-truth bug the Prompt-Layer spec exists to kill.

6. **Block-id instability.** §4.1c. Silent progress misattachment. Fixed by the append-only id
   map; note that the *matching rule*, not the map, is where this actually gets won or lost —
   an under-specified matcher reintroduces the same failure with more ceremony.

7. **Channel reachability.** The WhatsApp gate-lock failure is mitigated as of 2026-08-08
   (`assessment/channelSupport.ts`), whose own header calls itself *"a stopgap with a clear
   replacement."* A rendered block player is a strictly larger WhatsApp incompatibility than a
   gated teach-back and needs the package-level declaration in §4.2 rather than a second
   per-feature stopgap. *(Option A inherits the existing gate stopgap and adds nothing new.)*

8. **Port effort is under-estimated by LOC.** §9 practical note.

9. **Scope creep from LM's other subsystems.** SRS with SM-2, drill, mock interview, analytics,
   admin console — all real, all working, none of them this.

10. **In-flight conflicts.** Backlog items 4/5 (dashboard i18n, configurable panels) touch
    `dashboard/*` and `admin/*`; this touches the learner surface. Safe to parallelize. **LTI-A
    overlaps A3/B5** (both touch enrollment and course resolution) — sequence, don't parallelize.

---

## 9. Open decisions

1. **Dimension modeling.** *Recommendation: one `comprehension` dimension + concept tags on
   blocks*, not 11 tracked dimensions. The ~5 primary-dimension soft cap exists for a reason;
   eleven would swamp both the mentor dashboard and the sensing prompt. **Answer today** — it
   changes Phase 0's output.

2. **Gate density.** Per-lesson gates (`autoAppendTeachBack: true`) or capstone-only? LM gates
   nothing — its mastery check is explicitly soft. Seventeen blocking gates is a materially
   different course from the one that exists.

3. **Audience.** LM's course is written for *"AI literacy for GSCM undergrads."* If course #3
   keeps that framing it **is** the BYU program-#2 candidate from the abstraction plan, which
   puts Canvas/LTI on the critical path and makes `lti_service.py` required reading. **Answer
   today** — it changes sequencing, not just content.

4. *(Option B only)* `metadata.delivery` vs. a new `meta` block — and correcting the two
   companion docs that already drifted (§4.1b).

---

## 10. Practical note on the port

The porting work is where the TypeScript-vs-Python gap is widest, and LOC counts flatter it.
Those Learn Machine components are Vite + `react-router-dom`; in App Router every one needs
`"use client"`, and `LessonPlayer`'s keyboard-nav state, `useLessonProgress` hook, and
`useCourse()` context all have to move to client boundaries or be replaced outright. **225 LOC is
a floor, not an estimate.**

Budget review time there specifically, and when prompting Claude Code, ask it to **show the
client/server boundary decisions and justify each one** — not just the diff. That is the part
that will be wrong in ways `tsc` won't catch.

---

## 11. Immediate next steps

1. **Answer §9 decisions 1 and 3 today.** Both change Phase 0's output; neither needs code.
2. **One-line fix for `journey-package.schema.ts:133`** — independent of this project, and it
   stops the broken-order pattern from being copied.
3. **Phase 0 exactly as written.** Cheap, standalone, identical under both options. Commit to
   Option A or B only after 95 blocks are rows.
4. Read `lti_service.py` before the LTI-A prompt — independent of all of the above.
