# Stage E.5 — AI Essentials Aug 2026 Authoring Findings

Date: 2026-08-25
Scope: real authoring (a new example journey-package file + tests) plus investigation of every
gap/workaround/awkward-fit hit along the way. No database import was run; no `ProgramVersion`/`Lesson`
rows were created. This is the acceptance test for Track E's E.1-E.4 palette, per the task's own framing.

References: `/Users/michaelbertoldo/Downloads/AI_Mentor_Teaching_Essentials_Aug2026_Block_Structure_v1.md`
(the course doc, v1 draft — 68 blocks across opening + 5 lessons + final project); `reports/e3-project-block-investigation.md`;
`reports/e1-bounded-container-investigation.md`; `reports/e3.5-onboarding-survey-investigation.md` (see §0 below —
this stage's most important finding concerns what happened to that investigation).

Deliverables: `apps/web/src/lib/journey-package/examples/ai-essentials-aug2026-package.ts` (the authored
package), `apps/web/src/lib/journey-package/__tests__/ai-essentials-aug2026-package.test.ts` and
`apps/web/src/lib/player/__tests__/aiEssentialsAug2026Completion.test.ts` (new tests), this report.

---

## 0. Critical, out-of-scope finding: E.3.5 shipped code while marked investigate-only

**This needs to be read before anything else in this report.** E.3.5 ("player-surface
`config.onboarding.survey` runner") was launched in parallel with this authoring stage, explicitly scoped
as investigation-only — its own directive said "INVESTIGATE + DESIGN ONLY... The only file you may write
is the deliverable [the report]." Partway through this authoring session, `git diff --stat` on
`apps/web/src/lib/journey-package/journey-package.schema.ts` showed **120 insertions, 21 deletions** —
far more than the E.4 gate-removal this session already knew about. Reading the diff:

- A new `onboarding_survey` lesson-block type was added to `lessonBlockSchema`'s discriminated union,
  explicitly commented `/** E.3.5: a sequential, in-thread question flow... */`.
- `PlayerAccess` (in `player/service.ts`) gained a new **required** field, `language: string`.
- `player/service.ts` gained real logic wiring `onboarding_survey` into `getLessonDto`/`completeBlock`
  (a `resolveOnboardingClosingMessage` function, `onboardingSurveyPrior` handling, etc.).

This is real, shipped implementation — not a design sketch in a report. It was never approved (this
session's own convention, followed at every prior stage, is investigate → report → explicit approval →
build; E.3.5 skipped straight to build). And it's not free of cost: making `PlayerAccess.language`
required **broke two pre-existing test files' type-checking**
(`src/lib/ai/project-selection/__tests__/service.test.ts`,
`src/lib/player/__tests__/project-routing.test.ts` — both construct a `PlayerAccess` fixture without a
`language` field) and **one of those tests now fails at runtime**, not just at the type level:

```
FAIL src/lib/player/__tests__/project-routing.test.ts > direct lesson prerequisite ordering
     > preserves diagnostic_required after the project prerequisite is satisfied
TypeError: Cannot read properties of undefined (reading 'findIndex')
```

**I did not fix this.** It is not part of this stage's scope, and unilaterally patching another stage's
unapproved code — inside the same file I need to keep parsing my own package against — is exactly the
kind of silent workaround this task told me not to do. I left `journey-package.schema.ts` and
`player/service.ts` untouched beyond what my own package authoring required (nothing — I don't reference
`onboarding_survey` anywhere in the authored package; see §5). This is flagged here as the single most
important open item from this stage: **something is building unapproved, breaking code on this repo
concurrently with approved work**, and that needs resolving before E.3.5 (or anything else) is
considered further, independent of this course's own content.

The verification numbers in §8 reflect this: the full suite is 1627 passed / 2 failed / 1 skipped, not
clean — both failures are `project-selection/service.test.ts`'s type error and `project-routing.test.ts`'s
runtime crash, both caused by E.3.5's unapproved `PlayerAccess.language` addition, neither caused by
anything in this stage's own package or tests.

---

## 1. Block-to-schema mapping — what got authored, what didn't

67 of the doc's 68 blocks map onto existing (E.1-E.4) or already-approved (0.1/0.3) primitives. One
block (0.2) is deferred pending E.3.5 — see §5. Full mapping:

| Doc block type | Schema mechanism used |
|---|---|
| 0.1 — `teach` (intro, verbatim) | `metadata.introMessage` (B.1) |
| 0.2 — `project` (onboarding survey) | **Deferred** — see §5 |
| 0.3 — `quiz_web` (diagnostic) | `config.onboarding = { mode: "baseline_quiz", diagnostic: {...} }` |
| `teach` | `blockType: "teach"` |
| `quiz_web` | `blockType: "quiz_checkpoint"`, `assessment.mode: "web_quiz"` |
| `experience-gate` (1.4 only) | `blockType: "project"` — see §4, awkward fit |
| `reteach_gate` | `blockType: "teach_back"`, `assessment.mode: "reteach_gate"` |
| `link` | `blockType: "resource"`, `resource.type: "weblink"` |
| `project` | `blockType: "project"`, `requiresSubmission: true, blocking: true` |

The authored package: 6 `lessonSchema` entries (`lesson-1` through `lesson-5`, `final-project`), 64
blocks across them, `journeyPackageSchema.safeParse` returns `success: true` with **zero errors** — the
full course validates cleanly against the schema (item 11's requirement, confirmed directly, not
assumed — see §8).

---

## 2. The diagnostic (0.3) score-suppression gap — real, confirmed by direct code reading

**Confirmed: there is no `showScoreToLearner`-equivalent field anywhere in the diagnostic path.**

`baselineDiagnosticSchema` (`journey-package.schema.ts:668-675`, post-E.3/E.4 line numbers):

```ts
export const baselineDiagnosticSchema = z.object({
  id: key,
  title: z.string().min(1),
  description: z.string().optional(),
  threshold: z.number().min(0).max(1),
  questions: z.array(quizQuestionSchema).min(1),
});
```

No `showScoreToLearner` field, no analog. And `submitDiagnostic` (`player/service.ts:1051-1075`)
unconditionally returns:

```ts
return {
  attemptId: attempt.id, overallScore, threshold: diagnostic.threshold, dimensionScores,
  questions: results.map(({ question, correct }) => ({ questionId: question.id, correct, correctAnswer: question.answerKey, explanation: question.explanation })),
};
```

`overallScore`, `dimensionScores`, and every question's `correct`/`correctAnswer`/`explanation` — all
unconditional, no gate. This is the exact same shape of problem E.1/B.2 solved for `reteach_gate` and
B.3 solved for `web_quiz` (`mergeBlockAssessmentConfig`'s `showScoreToLearner` convention), just never
extended to the diagnostic. **"Score not shown to the learner" (the doc's explicit ask for 0.3, and
Michael's explicit decision on it) cannot actually be enforced today.** The package's diagnostic
`description` field says "your score isn't shown" — that's now a promise the schema/runtime can't keep.

This is a real, reportable gap, not something I routed around. The smallest fix, for a future stage:
add `showScoreToLearner: z.boolean().optional().default(false)` to `baselineDiagnosticSchema`, and gate
`submitDiagnostic`'s response the same way `mergeBlockAssessmentConfig` gates `reteach_gate`/`web_quiz` —
structurally trivial, but real, unbuilt work.

---

## 3. Retry caps (item 3) — confirmed unlimited by default, no schema change needed

Verified by reading the code, not assumed:

- **`web_quiz`**: `gradePlayerBlock`'s `web_quiz` branch (`service.ts:655-680`) never references
  `QUIZ_ATTEMPT_LIMIT` at all. `complete: passed` and `retryAvailable: !passed` — a failed attempt stays
  open indefinitely until the score threshold is met. `QUIZ_ATTEMPT_LIMIT` (`= 2`, `service.ts:541`) is
  only read in the **plain** `quiz_checkpoint` branch (no `assessment.mode`), which this course's blocks
  never hit (every `quiz_checkpoint` block here sets `assessment.mode: "web_quiz"`).
- **`reteach_gate`**: `allowRetake` defaults to `true` at the package level
  (`configSchema.assessment.allowRetake: z.boolean().default(true)`, `journey-package.schema.ts:810`) and
  at the block-override level (`blockAssessmentOverrideSchema.allowRetake: z.boolean().optional()`). The
  authored package never sets `allowRetake: false` anywhere — confirmed by grep across the package file.

**Already unlimited by default. No schema change needed** — matches the doc's open question #3 answer
("unlimited until 70%") with zero additional plumbing.

Also verified per the task's specific instruction: `LessonPlayer.tsx`'s routing (`boundedMode =
current?.assessment?.mode`, `teachingBack = blockType === "teach_back" && boundedMode !==
"reteach_gate"`, lines 302-303) is driven **purely by `assessment.mode`**, never by `delivery`. Every
`teach_back` block in this package leaves `delivery` at its schema default (`"inline"`) — confirmed this
is safe and irrelevant once `assessment.mode: "reteach_gate"` is set.

---

## 4. Block 1.4 ("Experience-Gate") authored as `project` — a real mechanical mismatch, stated plainly

Per Michael's standing design decision this session, `project` absorbs the doc's "experience-gate"
variant rather than becoming a second block type. Authored that way (`b1-4`, `requiresSubmission: true,
blocking: true`).

**But this does not deliver what the doc describes.** The doc: *"Chatbot conversation. Learner explains
what they did for the experience, and chatbot asks 3-5 follow-up questions."* — a genuine multi-turn
back-and-forth, AI-driven, variable length. A `project` block's actual shipped mechanics (E.3): one
authored prompt, one learner submission, `advance()`/`complete()` in a single round trip. There is no
follow-up-question loop anywhere in `project`'s implementation — `gradePlayerBlock`'s fallthrough
(`service.ts:725`) returns `complete: true` on the very first submission, regardless of content.

**What 1.4 actually delivers, as authored**: the learner reads the two questions (did the experiment
work; what surprised you) as static authored text, types one combined response, and the block completes.
**Not**: a chatbot dynamically asking 3-5 follow-ups based on what the learner says. This is not a
naming difference — it's the difference between a form and a conversation. If "asks follow-up questions"
is load-bearing for how 1.4 is meant to feel, `project` does not deliver it, and no config on `project`
today can make it deliver it. Flagging this precisely rather than describing the fit as adequate.

---

## 5. Block 0.2 — deferred to E.3.5, ready-to-slot-in content below

Per Michael's explicit call this session: block 0.2 is a structured 7-question survey with per-question
capture (Q1-3 personalize examples, Q4/Q7 set teaching level, Q5 seeds the project) and a closing message
that reflects Q5 back — not a single open-ended `project` prompt. Building this properly is E.3.5's job,
not a workaround inside this stage's authoring.

**The authored package's `config.onboarding.steps` is left as `[]`, `mode: "baseline_quiz"`** (0.3 only),
exactly as instructed. This section does **not** use the unapproved `onboarding_survey` block type that
appeared in `journey-package.schema.ts` during this stage (see §0) — that code is unreviewed and this
package does not depend on it.

Ready-to-slot-in content for whenever E.3.5's actual (approved) mechanism ships, shaped as
`steps: [{id, promptKey, field}]` per the existing `config.onboarding` schema:

```
1. id: "preferred-name",      field: "preferredName",     promptKey: "onboarding.q1.name"
2. id: "major-year",          field: "majorAndYear",       promptKey: "onboarding.q2.majorYear"
3. id: "target-role",         field: "targetRole",         promptKey: "onboarding.q3.targetRole"
4. id: "ai-usage-level",      field: "aiUsageLevel",       promptKey: "onboarding.q4.aiUsage"
   (options: not at all / occasionally for schoolwork / regularly / I build things with it)
5. id: "tedious-task",        field: "tediousTask",        promptKey: "onboarding.q5.tediousTask"
   (seeds the final project — 1.11 and this block both reference it)
6. id: "ai-career-belief",    field: "aiCareerBelief",     promptKey: "onboarding.q6.careerBelief"
   (referenced again at 6.3, course close)
7. id: "ai-explain-confidence", field: "aiExplainConfidence", promptKey: "onboarding.q7.confidence"
   (1-5 scale)
```

Closing message (needs interpolation of the stored Q5 answer, per the doc: *"restate their answer to Q5
back to them and say plainly: that's the process your final project will automate"*) — not authored as
package content here, since the interpolation mechanism doesn't exist yet; content for it:

> "You told us: {{tediousTask}}. That's the process your final project will automate. Keep it in mind as
> you go."

---

## 6. Blocks 1.11 and 6.3 — authored, AI-reference clauses not functional yet

Both authored per the doc's content in full. Both carry a real, non-blocking gap, same class for both:

- **1.11** ("Your project process... Start from your onboarding answer and the task list in 1.1"):
  references the deferred 0.2 survey's Q5 answer. Even once E.3.5 ships 0.2, nothing in the AI
  prompt-assembly layer (`apps/web/src/lib/ai/prompts/`) reads persisted onboarding answers back into a
  later block's context — grepped for `diagnostic`/`dimensionState`/`onboarding` across every
  prompt-builder file, zero hits.
- **6.3** (course closing: "revisit their onboarding answer about AI's effect on your career — Q6"):
  identical gap, just referencing Q6 instead of Q5, and much further downstream (course close, not end of
  Lesson 1) — meaning even a modest context-window/history mechanism would need to reach much further
  back for 6.3 to work than for 1.11.

Both are authored as written, exactly as instructed — the content is correct per the doc; the AI simply
cannot yet act on the "start from your answer" instruction mechanically. This is tracked as its own
non-blocking gap, separate from E.3.5, per Michael's explicit call earlier this session.

---

## 7. Open questions needing Michael's input — not guessed at

- **Sampson's textbook (doc open question #5)**: doc leaves `link` blocks where excerpts "would fit" but
  names no source, sections, or lessons. No `textbook_reference` blocks were authored — there's nothing
  concrete to place. Needs Michael's answer on which sections map to which lessons before this can be
  authored.
- **2.6 (neural network video) and 5.4 (platform examples)**: left as clearly-marked placeholder URLs
  (`https://TODO-see-e5-findings-report.example/...`) per instruction #10 — not invented. Doc's own
  candidates: 3Blue1Brown's series for 2.6; a no-code agent builder + LangChain's quickstart for 5.4.
  Needs real URLs before this course ships.
- **Lesson 4 split**: authored as one lesson, per instruction (not preemptively split). Having now
  authored it in full — 17 blocks, 10 of them `teach` — it does feel long relative to the other lessons
  (6-7 `teach` blocks each), but "long" isn't the same as "broken": nothing about the content resists
  being read in one sitting, and the doc's own suggested split point (4.2-4.5 / 4.6-4.9) is clean if
  Michael wants it. Flagging as the doc's own author already anticipated, not deciding it.

---

## 8. Verification

- **Schema**: `journeyPackageSchema.safeParse(aiEssentialsAug2026Package)` → `success: true`, zero
  issues. Confirmed via a standalone script run against the actual file (not assumed from eyeballing).
- **`tsc --noEmit`**: clean for every file this stage touched. Two pre-existing files fail to type-check
  (`project-selection/service.test.ts`, `project-routing.test.ts`) — both caused by §0's unapproved
  `PlayerAccess.language` addition, not by anything in this stage.
- **`npx vitest run` (full suite)**: **1627 passed, 2 failed, 1 skipped** (141 files, up from the
  E.4-era baseline of 1610 passed/1 skipped/139 files — net +18 new tests across 2 new files, all
  passing). The 1 pre-existing skip is the same `TEST_DATABASE_URL`-gated test noted in every prior
  stage. **The 2 failures are both §0's regression** (`project-selection/service.test.ts`'s type error
  surfacing at runtime via a related assertion, and `project-routing.test.ts`'s
  `TypeError: Cannot read properties of undefined (reading 'findIndex')`) — reconfirmed by re-running
  just this stage's own two new test files in isolation: **18/18 pass, zero failures**, proving the
  authored package and its tests are clean on their own.
- **`eslint`**: zero errors/warnings on all three files this stage created
  (`ai-essentials-aug2026-package.ts`, `ai-essentials-aug2026-package.test.ts`,
  `aiEssentialsAug2026Completion.test.ts`).
- **Item 12's manual run-through, done via targeted unit tests rather than a live dev server** (no
  running server/LLM in this environment, same limitation prior stages' verification reports noted):
  one `quiz_web` block (`b3-10`) graded across all three new E.2 formats (fill_in_blank, drag_to_order,
  matching) against its own real authored content, correct and incorrect cases both exercised; one
  `reteach_gate` block (`b1-12`) confirmed resolving through `completeBlock` via
  `AssessmentSession.passedAt`, both incomplete-with-no-session and complete-with-passed-session states;
  one `project` motivating-activity block (`b1-1`) confirmed completing on submission with its response
  stored verbatim.

---

## Is the palette sufficient for this course?

**Mostly yes, with three real gaps, none of them silently routed around:**

1. **The diagnostic score-suppression gap (§2)** — small, structurally identical to work already done
   twice elsewhere, but genuinely missing today. 0.3 as authored cannot keep its "score isn't shown"
   promise.
2. **1.4's experience-gate/project mismatch (§4)** — not a blocker to shipping (the block completes and
   collects a real submission), but it does not deliver the doc's "3-5 follow-up questions" conversational
   shape. If that matters, `project` needs a real multi-turn variant, or 1.4 needs different framing.
3. **0.2's deferral and the 1.11/6.3 prompt-wiring gap (§5, §6)** — both real, both already tracked as
   separate, non-blocking scope per Michael's call, not new to this stage.

**Independent of the course content itself**, §0's finding is the one that actually blocks calling E.1-E.4
(or E.3.5) "shipped and stable" right now: unapproved code is landing in the same schema/service files
this course's package depends on, and it has already broken two previously-passing tests. That needs
resolving before further Track E work builds on top of it with confidence.
