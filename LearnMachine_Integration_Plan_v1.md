# Learn Machine → OCI Integration Plan v1

**Status:** Proposed
**Target repo:** `Mentors-International-Chatbot/MI-AI-Mentorship-Tool` — `apps/web`
**Source repo:** `michaelbertoldo/LEARNMACHINE` — local at `~/Desktop/Finance Trainer`
**Companion to:** `MI_Platform_Abstraction_Plan_v1.md`, `Prompt_Layer_Abstraction_Spec_v1.md`,
`Multi_Channel_Delivery_Architecture_v1.md`, `Platform_Backlog_Canvas_Plan_v1.md`

---

## 1. Objective

Ship **AI Essentials as course #3** on OCI, delivered through a *rendered lesson-player*
surface ported from Learn Machine. OCI keeps auth, tenancy, database, prompt engine,
sensing, and assessment gates. Learn Machine contributes three things and nothing else:
the block renderer, the lesson-player shell, and the AI course content.

No second backend. No second auth system. No second database. One new Prisma table.

---

## 2. The finding that shapes everything

**OCI already specified the destination. Nobody built the renderer.**

`journey-package.schema.ts:102–190` defines `lessonBlockSchema` as a discriminated union of
five variants: `teach`, `teach_back`, `quiz_checkpoint`, `media`, `resource`. The runtime
consumes **two**:

- `db-lesson-service.ts:123–142` filters for `teach` and `teach_back`. That is the entire
  block-type surface of the live system.
- `quiz_checkpoint` carries a comment in the schema: *"RESERVED for V2 delivery … the V1
  runtime does not grade or gate on it yet."*
- `media` and `resource` have **zero consumers** outside the schema file and the PB&J example.
- `config.onboarding.mode` accepts `"baseline_quiz"` (`journey-package.schema.ts:313`) — also
  with no runtime consumer anywhere in `src/`.

Learn Machine's `frontend/src/blocks/registry.tsx` is a 44-line map from `block.type` to a
React component, consumed by a 225-line `LessonPlayer`. That is precisely the missing V2
delivery layer, already written and already in production use. It even ships a placement
diagnostic (7 items, `pass_threshold: 0.75`) that lands squarely in the unimplemented
`baseline_quiz` slot.

**Second finding, and it collapses the scope:** AI Essentials uses only **three** block
types across its 17 lessons (95 blocks total).

```
40  prose
38  mcq
17  drag_order
```

No formulas. No graph-select. None of the four finance widgets. The port is **three block
components**, not nine.

---

## 3. What crosses, what doesn't

### Take

| Asset | Path in LEARNMACHINE | LOC | Note |
|---|---|---|---|
| Block registry pattern | `frontend/src/blocks/registry.tsx` | 44 | The seam. Copy the pattern, not the finance entries. |
| `ProseBlock` | `frontend/src/blocks/ProseBlock.tsx` | — | pulls `react-markdown`, `remark-gfm` |
| `McqBlock` | `frontend/src/blocks/McqBlock.tsx` | — | |
| `DragOrderBlock` | `frontend/src/blocks/DragOrderBlock.tsx` | — | pulls `@dnd-kit/core`, `/sortable`, `/utilities` |
| `LessonPlayer` shell | `frontend/src/components/LessonPlayer.tsx` | 225 | block stepper, progress bar, ←/→/Enter nav, footer. Strip the checkpoint half (§7). |
| `TutorPanel` layout | `frontend/src/components/TutorPanel.tsx` | 446 | Take the docked/fullscreen shell and streaming markdown. Replace the transport. |
| AI Essentials content | `backend/content/ai-essentials/` | 17 lesson JSON + `curriculum.json` + `placement-diagnostic.json` | |
| Capstone config | `backend/services/capstone_service.py` → `CONFIGS["ai"]` | — | title, brief, 5 deliverables, 5 milestones |

### Leave

- **Supabase auth** — `frontend/src/auth/*`. OCI has `jose` JWT + `lib/auth`. Non-negotiable per your brief.
- **FastAPI backend** — all of `backend/app/routes/*`, `services/*`, SQLAlchemy models. OCI's Next API routes replace every one.
- **`react-router-dom`, TanStack Query, `api/client.ts`** — Next App Router and OCI's existing fetch patterns.
- **Finance widget blocks** — `blocks/threeStatement`, `/dcf`, `/capTable`, `/lbo`. Four directories, zero use by the AI course.
- **SRS, drill, mock interview, unit tests, analytics, admin** — good systems, different products. Not this.
- **`lib/tutorUtils.ts` localStorage history** — OCI persists `Message` rows with sentiment and dimension state attached. localStorage history would be a silent second source of truth.
- **LM's soft mastery check** (`≥7/10`, TutorPanel `mode="checkpoint"`) — see §7, risk 2.

### Reference — read it, don't port it

`backend/app/services/lti_service.py` (349 LOC) + `routes/lti.py` (63) + `frontend/src/lti/session.ts`
is a **working LTI 1.3 implementation**. `Platform_Backlog_Canvas_Plan_v1.md` §6 has LTI as a
plan only. Before prompting LTI-A, read this — the launch → validate → auto-provision → link
flow has already been solved once in your own code, including the deep-link path.

---

## 4. Schema additions

Two fields carry the whole integration. Both additive, both optional, both defaulting to
current behavior.

### 4.1 `presentation` — the core idea

OCI's `teach` block is content the AI **speaks**. Learn Machine's `prose` block is content the
learner **reads**. Same data, different delivery. One field distinguishes them:

```ts
// added to blockBase in journey-package.schema.ts
presentation: z.enum(["narrated", "rendered"]).default("narrated").optional(),
```

- `narrated` — today's behavior exactly. Injected into the prompt; the AI says it.
- `rendered` — the player displays it directly. The AI sits beside it and doesn't recite it.

Default `narrated` means **MI Colombia and PB&J are byte-for-byte unchanged**. That is the
entire regression mitigation, and it holds the "additive, non-breaking" principle without
qualification.

### 4.2 `meta.delivery.surface`

Fills the slot `Multi_Channel_Delivery_Architecture_v1.md` §4 already reserved:

```ts
meta.delivery: z.object({
  surface: z.enum(["chat", "player"]).default("chat"),
  supportedChannels: z.array(z.enum(["whatsapp","web","canvas"])).default(["web"]),
}).optional()
```

AI Essentials declares `surface: "player"`, `supportedChannels: ["web"]`.

Note this is the *course-level* declaration that `assessment/channelSupport.ts` (added 2026-08-08)
solves at the *gate* level. That module's own header calls itself "a stopgap with a clear
replacement." `meta.delivery.supportedChannels` is the durable form of the same statement, made
once by the author instead of inferred per gate — and it generalizes past assessments to the
whole course. A rendered block player has no WhatsApp representation at all, so the AI course
needs to say so at the package level regardless.

### 4.3 Block variants

- **`quiz_checkpoint`** — promote from RESERVED to live. Add `explanation: z.string().optional()`
  to `quizQuestionSchema`; LM's `mcq.explain` has no home in the current shape and it's the
  pedagogically load-bearing field.
- **`drag_order`** — add as a first-class variant, *not* `media(kind:"drag_order")`. It is graded,
  and `media` is documented in the schema as "non-graded content." Bending it here is exactly
  the "schema distinguishes intent" lesson from the gate-policy bug.
- **`prose`** — needs no new variant. It is `teach` with `presentation: "rendered"`.

### 4.4 Prisma

- **New `BlockProgress`** — `(socioId, collectionKey, lessonKey, blockId, score?, completedAt)`.
  LM tracks block-level completion; OCI's `LessonProgress` is lesson-level only.
- **Flag — pre-existing debt this course forces you to pay:** `LessonProgress.lessonNumber Int`
  (`schema.prisma:295`) encodes an MI-only assumption. A key-based course has no lesson *number*.
  Either add `collectionKey` + `lessonKey` columns, or accept a synthetic index and document it.
  Worth checking whether PB&J is already quietly suffering from this.

---

## 5. Content migration

| Learn Machine | Journey package |
|---|---|
| `prose` | `teach` — `role: "explanation"`, `presentation: "rendered"`, `content: md` |
| `mcq` | `quiz_checkpoint.questions[]` — `format: "multiple_choice"`, `options`, `answerKey: options[correct]`, `explanation: explain` |
| `drag_order` | `drag_order` — `prompt`, `items`, `correctOrder` |
| `concepts[]` | `lesson.keyConcepts` + concept tags on blocks |
| `courses.json → concept_labels` (11) | `config.trackedDimensions` — but see §8 decision 1 |
| `track` | `lesson.category` |
| `difficulty` | drop, or add optional `difficulty` |
| `srs_seeds` | drop — no consumer in OCI |
| `placement-diagnostic.json` (7 items, `pass_threshold: 0.75`) | `config.onboarding.mode: "baseline_quiz"` — an enum value that already exists with no implementation. Needs a runtime, but not a schema change. |
| `curriculum.json → prerequisites` | lesson array order. The AI spine is strictly linear; OCI has no prereq graph and doesn't need one for this. |
| `CONFIGS["ai"]` | `outcome.project` (title, brief → description, 5 deliverables) + `outcome.milestones` (5, mapped 1:1, each pinned to an `afterLessonKey`) + `outcome.mentorResources` |

Write this as a converter script — `scripts/convert-learnmachine-package.ts` — not by hand.
Nineteen files, and you will re-run it every time the content changes.

Content is English-only. `localizedString` requires `en` and nothing else, so this validates
cleanly; `es`/`pt` are simply absent and fall back per D8.

---

## 6. Phases

Each phase is one Claude Code prompt, one commit, independently verifiable.

**Phase 0 — Converter + package, no UI.** *(2–3 days)*
Write the converter. Emit `ai-essentials-journey-package.ts` alongside the PB&J example.
Import it through the existing `import-journey-package.ts` path.
*Exit:* package validates against `journeyPackageSchema` with the §4 additions stubbed;
17 lessons and 95 blocks land as rows; no UI exists yet.

**Phase 1 — Schema + migration.** *(3–4 days)*
`presentation` field, `quiz_checkpoint` promoted with `explanation`, `drag_order` variant,
`meta.delivery.surface`, `BlockProgress` table, `LessonProgress` key-based columns.
*Exit:* `tsc` clean; PB&J and MI packages validate untouched; a full MI Colombia lesson run
is byte-identical to pre-change output. **This exit criterion is the plan's load-bearing test.**

**Phase 2 — Renderer + player.** *(1 week)*
Port the three block components and the registry. Build `/learn/[courseCode]/[lessonKey]` as
a Next route wrapping the `LessonPlayer` shell. Block completion writes `BlockProgress`.
*Exit:* a learner can walk all 17 AI lessons end to end, block by block, progress persisting
across sessions. The AI is not yet involved.

**Phase 3 — Tutor on OCI transport.** *(3–4 days)*
`TutorPanel` shell docked beside the player. Transport swapped to OCI's `/api/chat` with the
current block as context. Messages persist as `Message` rows; sentiment and dimension state
flow through the existing pipeline unchanged.
*Exit:* asking the tutor a question from block 7 of lesson 3 produces a persisted message with
correct lesson/block context and a `MessageSentiment` row.

**Phase 4 — Gate + capstone.** *(3–4 days — smaller than it looks)*
Per-lesson gate uses OCI's existing `AssessmentSession` (rendered as LM's card, not LM's
grader). Capstone becomes `outcome` + `MilestoneProgress`.
`prompts/courseOutcome.ts` (added 2026-08-08) already reads `outcome.project` and
`outcome.milestones` from `ProgramVersion.config.outcome` and feeds them to **coach stance only**
— so the capstone coaching path exists and just needs a package that declares an outcome.
Worth confirming during this phase that the AI course's stance routing actually reaches coach;
an outcome the router never surfaces is the same class of silent gap as the empty
`metric_definitions` table.
*Exit:* one grading system in the codebase; capstone milestones appear in the mentor dashboard
through the panel renderer already spec'd in Platform_Backlog item 5.

**Phase 5 — Registration + enrollment.** *(2–3 days)*
Add `AIESS` to `COURSE_CODES` / `COURSE_INFO` in `lib/courses/resolver.ts`. Route learners to
`/learn` vs `/chat` off `meta.delivery.surface`.
*Exit:* a new signup with code `AIESS` lands in the player; `MI2024` and `PBJ` still land in chat.

**Total: ~4 weeks.** Phases 0–2 are the critical path.

---

## 7. Risks

1. **MI regression.** The standing risk on every abstraction push. Mitigation is structural,
   not procedural: `presentation` defaults to `narrated`, so an unmodified package produces an
   unmodified prompt. The Phase 1 exit test is a byte-identical MI lesson run.

2. **Two grading systems.** Learn Machine grades a soft mastery check (`≥7/10`, non-blocking,
   `TutorPanel mode="checkpoint"`). OCI grades through `AssessmentSession` (blocking, dimension-scored,
   feeds `MetricObservation`). Porting both ships a codebase where "did the learner pass" has two
   answers. **Reject LM's checkpoint.** Take the card UI, keep OCI's grader.

3. **Two tutor histories.** Same shape of problem. LM writes conversation history to localStorage
   via `saveTutorHistory`. OCI writes `Message` rows that sentiment, alerts, and summaries all read.
   Porting `tutorUtils` recreates the two-sources-of-truth bug the Prompt-Layer spec exists to kill.

4. **Channel reachability.** The WhatsApp gate-lock failure is mitigated as of 2026-08-08
   (`assessment/channelSupport.ts`), so this is no longer the live hazard it was — but the fix is
   explicitly a stopgap scoped to gates. A *rendered block player* is a strictly larger
   WhatsApp-incompatibility than a gated teach-back, and it needs the package-level declaration in
   §4.2 rather than a second per-feature stopgap. Same defect, one level up; don't let it back in
   through the side door.

5. **Scope creep from LM's other subsystems.** SRS with SM-2 scheduling, drill mode, mock interview,
   the analytics stack, the admin console — all real, all working, none of them this project.
   Each is a separate decision made later on its own merits.

6. **Conflict with in-flight work.** Platform_Backlog items 4 and 5 (dashboard i18n, configurable
   panels) touch `dashboard/*` and `admin/*`; this plan touches the learner surface. Low overlap —
   safe to parallelize. **LTI-A overlaps Phase 5** (both touch enrollment and course resolution) —
   sequence those, don't run them together.

---

## 8. Open decisions

1. **Dimension modeling.** LM's AI course declares 11 concepts. Do those become 11
   `trackedDimensions`, or one `comprehension` dimension with concept tags on blocks?
   *Recommendation: the latter.* The ~5 primary-dimension soft cap exists for a reason, and
   eleven dimensions would swamp both the mentor dashboard and the sensing prompt.

2. **Gate density.** Does AI Essentials gate per lesson (`autoAppendTeachBack: true`), or is the
   capstone the only gate? LM gates nothing — its mastery check is explicitly soft. Adding
   17 blocking gates would be a materially different course from the one that exists.

3. **Audience.** LM's AI course is written for *"AI literacy for GSCM undergrads."* Is course #3
   for that audience — which makes it the BYU program #2 candidate from the abstraction plan,
   with Canvas/LTI implications — or is it reframed for a different learner?

4. **Surface coexistence.** Does `/learn` replace `/chat` for this course, or coexist with a link
   back? Coexisting is more work and gives learners two places to talk to the AI. *Recommendation:
   replace, with the tutor docked in the player.*

---

## 9. Immediate next steps

1. Answer §8 decisions 1 and 3 — they change Phase 0's output.
2. Phase 0 converter script (no dependencies; assignable now).
3. Read `lti_service.py` before the LTI-A prompt is written — independent of everything above.
