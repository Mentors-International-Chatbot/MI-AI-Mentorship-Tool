# Stage E.6 Investigation — Early-course context in later AI turns

Date: 2026-08-25
Scope: investigation and design only, per instructions. No application code, schema, or
migration changes. The only file written is this report.
References: `reports/e3.5-onboarding-survey-investigation.md` (onboarding_survey block design,
storage shape); `reports/e5-authoring-findings.md` (original 1.11/6.3 finding); `reports/e5.2-ungraded-gate-findings.md`
(6.3's current authored shape, `reteach_gate` mechanics).

**Preamble — repo-state check performed first, per this session's standing convention.**
`git log --oneline -5` shows a new top commit, `1b2c210 "start new course"`, on top of `21a315e`
— its diff (`git show --stat`) is exactly E.3, E.3.5, and E.5's work from earlier in this
session getting committed (`onboarding_survey` block type, the AI Essentials Aug-2026 package,
`LessonPlayer.tsx`/`service.ts` changes already known from this session), not new third-party
content. `git status --porcelain` shows E.5.2's uncommitted work (`runAssessmentTurn.ts`,
`ai-essentials-aug2026-package.ts`, `journey-package.schema.ts`, `player/service.ts`, two new
test files) plus this session's report files — consistent with what this session already
produced. No unexpected changes. This investigation touches no application code.

---

## 1. Player prompt-assembly path, full trace

**There are two separate, non-overlapping prompt-assembly systems on the player surface** —
not one. This is the single most important structural fact for this investigation, and it
changes the shape of the whole design question.

**System A — ordinary conversational turns** (`teach`, `quiz_checkpoint` follow-ups, `project`
submissions, non-gated `teach_back`), entered via `invokeStyledPlayerResponse`
(`apps/web/src/lib/ai/service.ts:214`):

- `baseSystemPromptPromise` (line 712-713): for `playerTurn`, this is
  `Promise.resolve(buildAuthoritativePlayerPrompt(socio))` — **not** the chat surface's layered
  `buildSystemPrompt`. `buildAuthoritativePlayerPrompt` (`ai/prompts/builder.ts:78-80`) returns a
  static, language-only base prompt (`buildAuthoritativePlayerBase`) — no learner-specific data,
  no dimension state, no `SocioContext`, nothing dynamic.
- `playerGrounding` (line 725, from `playerTutorGrounding(socio.id, playerTurn.context)`,
  `player/service.ts:206-249`): this is the **only** dynamic, per-turn context-injection point
  on this path. It fetches the current lesson/block (`contentLesson.findFirst`,
  `lessonSchema.parse`), sanitizes it (`sanitizePlayerBlock`), and returns a plain string —
  lesson title, key concepts, and (for `lesson_entry`/`teach_back` parent-intents only) the
  current block's full sanitized JSON. Appended into the system prompt as `"PLAYER COURSE
  CONTEXT (authoritative; do not reveal hidden quiz answers): ..."` (`service.ts:729-732`).
  **This is the single existing layer whose job is already "inject supplementary facts about
  the learner's situation."** It is the natural home for new learner-context data on this path.
- The surface-assertion split is still exactly as this session's memory describes:
  `service.ts:528-535`, `if (playerTurn) { if (delivery.surface !== 'player') throw ... } else
  { if (delivery.surface !== 'chat') throw ... }` — a player-surface call cannot physically
  reach the chat branch, confirmed by re-reading the code fresh.

**Chat surface's equivalent**, for contrast: `buildSystemPrompt` (`ai/prompts/builder.ts:82`)
is the full Layer 1/2/3 architecture — Layer 2 (`ai/prompts/layers/context.ts`) is where
`SocioContext` gets read and injected, per this session's existing memory. Player turns never
call `buildSystemPrompt` at all — they take the `buildAuthoritativePlayerPrompt` +
`playerTutorGrounding` path instead, entirely bypassing Layers 1-3.

**System B — reteach_gate conversations** (block 6.3's kind of block), entered via
`createAssessmentSession` → `runAssessmentTurn` → `buildAssessmentPrompt.ts`:

- `buildConfigSnapshot` (`ai/assessment/createAssessmentSession.ts:202-255`) builds
  `AssessmentConfig.teachBackPrompt` directly from `teachBackBlock.prompt` (line 250) — the
  block's raw authored string, no placeholder resolution, no grounding injection.
- `buildAssessmentPrompt.ts` builds the assessment's system/turn prompts from that
  `AssessmentConfig`. **`playerTutorGrounding` is never called anywhere in this path** —
  confirmed by grep, zero references to it in `ai/assessment/`.
- This is the exact separate pipeline this session already traced in detail for the
  reteach-gate write-path investigation reports — restated here because it directly determines
  where a fix for 6.3 has to live, and it is **not** the same place as a fix for 1.11.

**Consequence for "the single best insertion point"**: there isn't one. `playerTutorGrounding`
is the right extension point for anything routed through System A. Block 6.3 needs its own
insertion inside System B — most naturally in `buildConfigSnapshot`, since that is where the
block's raw `prompt` string is read once per session-creation and is already the place
`teachBackPrompt` gets assembled from authored content.

---

## 2. What data needs to reach it — minimum sufficient shape

**Block 1.11 (`b1-11`)** is confirmed **`blockType: "project"`**, not `teach_back` — a real,
load-bearing discovery, not confirmed by the original task framing. Its authored `content`
(`ai-essentials-aug2026-package.ts:299`) says, verbatim: *"Start from your onboarding answer and
the task list in 1.1."* It does **not** currently mention diagnostic performance in its authored
text at all (checked directly against the live block content, not the file's header-comment
summary, which paraphrases more broadly). So the minimum sufficient shape for 1.11 is: **one
field — the onboarding survey's Q5 answer (keyed by that step's `field`)**. Nothing about
diagnostic scores needs to reach this block as currently authored; if a future revision wants
that, it is a second, separate substitution, not part of this block's actual present text.

**Block 6.3 (`b6-3`)** is confirmed `blockType: "teach_back"` (line 751). Its `prompt`
(`"Let's reflect. Revisit your onboarding answer about AI's effect on your career. What do you
believe now? What changed?"`) needs **one field — the onboarding survey's Q6 answer**.

**So the minimum shape across both blocks is two specific fields (Q5, Q6), not a general-purpose
learner-memory system.** A generalized "learner context" table/mechanism would be overbuilt for
what this course actually needs today.

**Diagnostic performance**: since neither block's live authored text currently references it,
this investigation finds **no present need** to plumb `DiagnosticAttempt` data into any prompt
at all. Flagging this as a real finding, not an oversight: the original task framing (and E.5's
own header-comment summary) implied 1.11 needs diagnostic data; the block's actual text does
not ask for it. If that's a content gap (the doc's intent got lost during authoring), it's a
content-authoring question for Michael, not a plumbing question for this investigation.

**Readability without a new query — checked, not assumed, and the honest answer is no on both
counts:**

- `getLessonDto`'s progress fetch (`player/service.ts:492-494`) is **lesson-scoped**:
  `blockProgress.findMany({ where: { enrollmentId, lessonKey } })`. Block 1.11 renders inside
  `lesson-1`; block 6.3 renders inside `final-project`. The onboarding-survey block (once
  authored — see below) would live in a *different* lesson ("course opening"), so its
  `BlockProgress` row is never included in either lesson's existing fetch. **Not a free
  piggyback** — a new, narrow query (a single `blockProgress.findUnique` or `findFirst` keyed on
  `enrollmentId` + the onboarding-survey block's known `blockId`) is needed at both render sites.
- `DiagnosticAttempt` is fetched today only via a bare `.count()` (`getLessonDto:485`, the
  diagnostic gate) — never its `overallScore`/`dimensionScores` fields, confirmed in E.5.1's
  investigation and re-confirmed here. Moot for this course regardless, per the finding above
  that neither block's live text currently needs it.
- **Scope note, load-bearing**: the AI Essentials Aug-2026 package still has **no
  `onboarding_survey` block at all** (grepped the live package file — zero hits) — 0.2 remains
  deferred exactly as E.5 left it. So today, for *this specific course*, there is no Q5/Q6 data
  being collected in the first place. This investigation's design must work once 0.2 is
  authored; it cannot be tested against live data for this course until then.

---

## 3. The real design fork — placeholder substitution vs. context injection

**Both blocks display authored text directly to the learner that references data the learner
cannot be assumed to remember** — this is true for 1.11 (`content` shown verbatim, per
`LessonPlayer.tsx`'s render branch for `project`) and for 6.3 (`teach_back.prompt` is also shown
verbatim to the learner — confirmed via `historyContent()`, `LessonPlayer.tsx:169`: `if
(block.blockType === "teach_back") return (block as TeachBack).prompt;`, the same "authored
content is the block's displayed text" convention every other block type uses). This shared fact
sharpens the fork considerably from how the task originally framed it.

**(a) Placeholder substitution** — tokens like `{onboarding.q5}` resolved at render/session-build
time, reusing the exact `{step:<id>}` mechanism `resolveOnboardingClosingMessage`
(`player/service.ts:617-630`) already ships, itself modeled on `buildWelcomeMessage`'s
`{mentorName}`/`{courseName}`/`{participantName}` regex-replace pattern
(`courses/course-meta.ts:293-308`). Concretely: `answers[step.field]` substituted via
`message.replace(new RegExp(`\\{step:${id}\\}`, "g"), value)`.

- For 1.11: the substitution target is `content` (currently returned untouched by
  `sanitizePlayerBlock`, `player/service.ts:162-189` — its fallthrough `return block` for
  unhandled types is where a substitution step would need to insert, but that function is
  called as a plain `.map()` with no learner-context data in scope today; the caller,
  `getLessonDto:499`, would need to thread the resolved Q5 value in).
- For 6.3: the substitution target is `teachBackBlock.prompt`, inside `buildConfigSnapshot`
  (`createAssessmentSession.ts:250`, where `teachBackPrompt: teachBackBlock.prompt` is set) —
  the one place per session-creation where the raw string is read.
- Simple, explicit, author-controlled, fully predictable. Limited to literal text insertion —
  the AI "sees" only whatever string got substituted; it has no independent awareness of the
  data as a *fact* it can reason about beyond the literal quoted text.

**(b) Context injection** — learner data added as background context (mirroring, in spirit,
chat's `SocioContext`-in-Layer-2 pattern), with authored content simply instructing the AI to
use it naturally.

- For System A (1.11's post-submission AI reply, since `project` blocks with
  `requiresSubmission: true` do route through `askTutor()`/`invokeStyledPlayerResponse`, per
  E.3.5's own finding about needing to bypass this for `onboarding_survey` specifically — a
  plain `project` block does **not** bypass it): `playerTutorGrounding`'s returned string is the
  natural insertion point — appending a line like `Learner's stated tedious task (from
  onboarding): "..."` alongside the existing lesson/block grounding.
  For System B (6.3's actual gated conversation): would need a new field on `AssessmentConfig`
  (parallel to `teachBackPrompt`/`lessonContext`) threaded through `buildAssessmentPrompt.ts`'s
  system-prompt construction — new plumbing in a shared file, not a reuse of an existing slot.
- More natural for a genuine back-and-forth (6.3's multi-turn `reteach_gate` conversation
  benefits from the AI being able to reference the answer flexibly across turns, not just once,
  literally, at the top). Less predictable — the model could ignore, paraphrase inaccurately, or
  over-fixate on injected context, and this is exactly the class of risk this session's own
  prompt-engineering-adjacent findings (e.g. E.5.2's closing-message framing gap) have already
  shown is real in this codebase.

**Which block wants which, concretely**: 1.11 is a static brief followed by one submission — its
core need (the learner needs to *read* their own Q5 answer restated, since the brief literally
says "start from your onboarding answer") is satisfied by (a) alone; (b) would only enrich the
one downstream AI reply, a secondary benefit. 6.3 is a genuine multi-turn conversation where
(a) is still necessary as a baseline (the opening line the learner reads needs their real Q6
answer substituted in, or "revisit your answer" reads as broken) — but (b) would materially
improve the conversation's later turns, where the AI is meant to draw out what changed, not just
open with one fixed line.

**Conclusion for the fork**: (a) is necessary for both blocks regardless of any other choice, to
keep the displayed authored text from reading as broken. (b) is optional, additive, and matters
more for 6.3 than 1.11. **Whether to build (b) at all — or ship (a) alone as sufficient for this
course** — is the actual decision left open. Not resolved here, per instruction.

---

## 4. Scope boundary

**Player-surface-only, confirmed.** Grepped every importer of `contextExtractor`/`SocioContext`
(`ai/analysisPolicy.ts`, `ai/contextExtractor.ts`, `ai/prompts/builder.ts`,
`ai/prompts/layers/context.ts`, `messaging/handler.ts`, plus the repo type/implementation files)
— every one is chat-surface machinery or shared type definitions; none is player-surface code.
Neither design shape in §3 touches any of these files. `playerTutorGrounding` and
`createAssessmentSession.ts` are both exclusively player-surface-reachable (the latter's
chat-surface counterpart is the pre-existing, separate `messaging/handler.ts` call site this
session has already mapped in the reteach-gate write-path reports) — confirmed no shared code
path exists between the proposed insertion points and MI/PBJ's chat-surface prompt assembly.

**No existing course changes behavior if this ships — confirmed, not assumed.** Grepped every
`journey-package/examples/*.ts` file and every `content/*.json` package for `{onboarding.` or
`{step:` token usage in authored content: zero hits outside this session's own E.3.5 test
fixtures and the schema's own doc comment. `skills-tool-calls-package.ts`, `pbj-journey-package.ts`,
and the various `content/ai-essentials*.json` files reference `onboarding`/`diagnostic` only as
the pre-existing `config.onboarding.mode`/`.diagnostic` fields themselves (unrelated,
pre-existing usage) — none author placeholder tokens or reference this new mechanism. Confirmed
plainly: no existing course would change behavior.

---

## Fork for decision (item 3) — restated, not resolved

**(a) Placeholder substitution alone**, vs. **(a) plus (b) context injection** for block 6.3's
multi-turn conversation. (a) is required either way to keep both blocks' displayed authored text
correct. (b) is additive scope — new plumbing in `buildAssessmentPrompt.ts`'s shared assessment
pipeline, touching a file used by every `reteach_gate` block in the system (including this
course's own graded gates 1.12/2.10/etc.), though scoped narrowly (new optional field, unused
unless a block populates it) rather than a rewrite. Michael's call: ship (a) only for this
stage, or build both.

## Also worth Michael's attention, not a fork — resolved findings from this investigation

- 1.11 doesn't ask for diagnostic performance in its actual authored text today, despite the
  original framing suggesting it should — a content question, not a plumbing one.
- Block 0.2 (the onboarding survey itself) still isn't authored into this course at all. Any
  build here has no live data to exercise until 0.2 ships.
- Both data-source fetches (onboarding-survey `BlockProgress`, and — if ever needed —
  `DiagnosticAttempt`) require new, narrow queries; neither piggybacks on an existing fetch.

Do not implement — awaiting approval.
