# Stage E.3 Investigation — `project` block type

Date: 2026-08-25
Scope: investigation and design only, per instructions. No code, schema, or migration changes.
Reference: user's Stage E.3 task message; `docs/Platform_Restructure_Plan_v1.2.md` (Track E context);
prior session reports (`reports/phase-b-investigation.md` §4 for the block-type registry precedent,
`reports/e1-bounded-container-investigation.md`/`e1-bounded-container-build.md`,
`reports/e2-question-types-investigation.md`/`e2-question-types-build.md` for E.1/E.2's shipped state).

**Preamble — repo-state check performed before writing anything, per the task's explicit instruction
not to assume E.3 was already started:** searched the full repo (`find . -iname "*e3*"`, excluding
`node_modules`/`.next`/`.git`) — zero matches for any prior E.3 report or partial work. `git log
--oneline -10` confirms only two Track E commits exist: `b9ced26` ("feat(player): add bounded
assessment container", E.1) and `21a315e` ("feat(player): add rich web quiz formats", E.2). `git
status` shows a clean working tree relative to those commits (only this session's own untracked
report files and `docs/` predate them). There is one unrelated pre-existing stash
(`stash@{0}: WIP on main: 3aca81b sign in`) — not touched, not investigated, out of scope for this
task. **E.3 has not been started in any form.** This report starts from zero.

---

## 1. The block-type registry, reproduced current (post-E.1/E.2)

**`lessonBlockSchema`**, the discriminated union on `blockType`
(`apps/web/src/lib/journey-package/journey-package.schema.ts:359-495`), currently has exactly six
members: `teach` (368-408), `teach_back` (419-427), `quiz_checkpoint` (430-435), `drag_order` (438-454),
`media` (461-467), `resource` (470-494). Unchanged in count and shape by E.1/E.2 — both stages extended
existing members (`quizQuestionSchema`'s new `format` values for E.2; `assessment` block-override
plumbing for E.1) rather than adding a union member. This confirms the phase-b-investigation.md §4
finding still holds: no seventh member has been added since.

**`blockBase`** (`journey-package.schema.ts:328-357`), spread into every variant via `...blockBase`:
`id`, `order`, `concepts`, `contentVersion`, `handoff` (optional), `assessment` (optional,
`blockAssessmentOverrideSchema`). A new `project` variant gets `handoff` and `assessment`-shaped fields
for free simply by including `...blockBase` in its object literal — no separate wiring needed for
`handoff` (confirmed in §3 below) or for the (unused, since project isn't graded) `assessment` slot.

**The four steps, per block type, confirmed at each layer:**

| Step | Where | What a new type needs |
|---|---|---|
| Declare | `lessonBlockSchema`'s union (`journey-package.schema.ts:359-495`) | A new `z.object({ ...blockBase, blockType: z.literal("project"), ... })` member |
| Validate | Same file's package-level `superRefine` (946-1289) | Only if cross-block rules apply (dimension-key refs, mode/blockType cross-checks) — `project` needs none of these (see §4) |
| Render | `apps/web/src/components/player/LessonPlayer.tsx`'s `blockType ===` branches (167-177 for prompt/summary text, 731-763 for the live block UI) | A new `current.blockType === "project"` branch |
| Grade/complete | `apps/web/src/lib/player/service.ts`'s `gradePlayerBlock` switch (587-726) | A new `if (block.blockType === "project")` branch |

This is the same four-layer shape phase-b-investigation.md §4 documented for the original six types,
confirmed unchanged as the pattern to extend.

**`content/block-ids.json`** (`content/block-ids.json`, `nextSequence: 113`, `entries[]`): its
`blockType` field uses the **Learn Machine source vocabulary** (`"prose"`, `"mcq"`, `"drag_order"`,
`"teach_back"`, etc. — confirmed by inspection of the file's first entries), a different, narrower
vocabulary than `journeyPackageSchema`'s `blockType` (e.g. `journeyPackageSchema` has no `"prose"` or
`"mcq"` — those map onto `teach` and `quiz_checkpoint` respectively during conversion). This file is
read only by `scripts/convert-learnmachine-package.ts` and its test
(`scripts/convert-learnmachine-package.test.ts`) — confirmed neither file appears in E.1's or E.2's
commit diffs (`git show --stat b9ced26`/`21a315e`), so the file is exactly as phase-b-investigation.md
§4 described it. **A new hand-authored `project` block type never touches this file.** It would only
become relevant if the Learn Machine *source* converter were later taught to emit `project` blocks from
its own source format — a separate, unrelated task, exactly as the prior report concluded for
`media`/`resource`. Append-only safety for that hypothetical future work is already guaranteed by the
file's existing four-step match order (explicit reuse → content-hash → discriminator+fingerprint overlap
≥0.5 → mint new `stableId`, incrementing `nextSequence`) and its `retired: true` convention for entries
no longer emitted — nothing about adding `project` to the runtime schema requires or affects any change
to that file or its matching rule.

---

## 2. Design: `project` as a new block type

**Nearest sibling, confirmed mechanically almost identical**: `teach` with `expectsResponse: true`
(`journey-package.schema.ts:407`) already does "authored content renders in-thread, gates advancement on
typed text, no grading." Traced end to end:

- **Client gate**: `requiresResponse = current?.blockType === "teach" && (current as Teach).expectsResponse === true`
  (`LessonPlayer.tsx:311`) disables the shared textarea's send button until text is present — the *only*
  place this gate is enforced.
- **Server grading**: `gradePlayerBlock` for `blockType === "teach"` (`service.ts:609`) unconditionally
  returns `{ complete: true, score: 1, response: { acknowledged: true }, feedback: null }` — it does not
  even inspect the submitted response. **The server does not enforce `expectsResponse` at all** (this
  matches phase-b-investigation.md §1's original finding, reconfirmed current: "Not enforced server-side
  ... a direct API call bypasses it").
- **Submission path**: the shared textarea's send button calls `complete(response)`
  (`LessonPlayer.tsx:319`), which `POST`s to `/api/learn/{course}/{lessonKey}/blocks/{blockId}/complete`
  — the same one route every block type completes through.

**Design for `project`, built on this pattern but as its own declared type** (per the task's explicit
instruction to make it a new block type, not a `teach` variant):

```ts
z.object({
  ...blockBase,
  blockType: z.literal("project"),
  content: z.string().min(1),          // the authored brief; multi-paragraph is just a longer string
  requiresSubmission: z.boolean().default(false),
  blocking: z.boolean().default(false), // see the open fork in §5
}),
```

- **Render**: identical shape to `teach`'s content render (`LessonPlayer.tsx:731`) — Markdown content,
  shown once, `!submittedComplete.has(current.id)` guard so it doesn't re-render after submission
  (matching the existing convention for `teach`/`quiz_checkpoint`/`drag_order` per
  phase-b-investigation.md §1's "duplicate prompt text" fix).
- **Gate**: `requiresSubmission` plays the exact role `expectsResponse` plays for `teach` — disables send
  until text is typed, client-side only, same convention. (Whether to *also* enforce it server-side is a
  design choice this report is not deciding — `teach`'s existing convention is client-only; `project`
  could match that convention or close the gap. Noting it, not resolving it, since the task frames
  `requiresSubmission`/`blocking` as the two flags to design around, not as an invitation to fix
  `expectsResponse`'s pre-existing server-side gap in the same stage.)
- **Grade/complete**: a new `gradePlayerBlock` branch, `blockType === "project"`, returning
  `{ complete: true, score: 1, response, feedback: null }` — i.e. always completes once called, response
  stored verbatim, never graded. Structurally identical to the fallback `return { complete: true, score:
  1, response, feedback: null }` already at `service.ts:725` for unlisted types — `project` could
  arguably fall through to that existing default with **zero new grading code**, since the default
  already does exactly this. Flagging this concretely: **the only code project strictly needs beyond
  declaration is a render branch — the grading side may need nothing new at all**, provided no
  future block type is added between now and then that also wants the fallback but with different
  semantics (a real but distant risk, not a blocker).
- **Storage**: `BlockProgress.response` is `Json?` (`prisma/schema.prisma:766`, confirmed by direct read)
  — already accepts arbitrary JSON, no schema change needed to store a project submission (a string, or
  a richer `{ text, attachments? }` shape later) the same way `teach`'s `{ acknowledged: true }` or a
  quiz's `Record<string, unknown>` are stored today. **No new table.**

---

## 3. `handoff` — confirmed universal, zero extension work

`handoff` lives on `blockBase` (`journey-package.schema.ts:348`), spread into all six current variants.
Its render is blockType-agnostic: `LessonPlayer.tsx:541-542` pushes a `"prompt"` thread item whenever
`isCurrent && block.handoff` is true, with no `blockType` check anywhere in that branch. **A `project`
block gets `handoff` support automatically by including `...blockBase`** — this is not new work, it is
the same "spread the shared base" mechanism that gave `handoff` to `media`/`resource` when they were
added, confirmed by inspection rather than assumed.

---

## 4. Existing-course impact — confirmed zero

`grep -rl '"blockType"\s*:\s*"project"'` across `content/` and `apps/web/src/lib/journey-package/examples/`
(the only two locations holding authored package content — the two example TS packages
`pbj-journey-package.ts` and `skills-tool-calls-package.ts`, plus whatever's imported into the live DB
per phase-b-verification.md's census) returns **zero hits**. No course today authors a `project` block,
because the type does not exist in the schema yet — this is purely additive, matching the same
"append-only, no migration" pattern B.1's `introMessage` and B.2's `blockAssessmentOverrideSchema`
already established (both new optional fields/union members that parse cleanly against every existing
package because nothing in existing content uses them).

A grep for `"experience.gate"` (case-insensitive) across `docs/` and `apps/web/src` also returns zero
hits — the "experience-gate variant" the task references is a term from the external source reference
document the task cites, not something already named anywhere in this codebase. Noted for §5.

---

## 5. Open design fork — not resolved here

**What exactly does `blocking` gate, beyond what `requiresSubmission` already gates?**

Mechanically, `requiresSubmission: true` alone already reproduces everything `teach + expectsResponse`
does today: the block will not complete (and therefore the player's `current` pointer will not advance
past it, per phase-b-investigation.md §1's confirmed "`current` only advances once a block is in
`completed`") until the learner submits something. That is already a hard block on lesson progression —
there is no separate mechanism today by which a *complete* block could still prevent the learner from
moving forward.

Two readings of `blocking` are both plausible, and I could not resolve which one the source reference
doc intends because **I do not have access to that document** (the task describes it as "attached
separately," for E.5's authoring pass, not included in this investigation's context):

- **Reading A — `blocking` is redundant with `requiresSubmission`.** It exists only because the source
  reference doc names two variants ("project" vs. "experience-gate") with historically different
  authoring surfaces, and the task's instruction to "absorb" the experience-gate variant into one config
  shape means `blocking` is just an alternate/legacy name a future importer might need to map onto
  `requiresSubmission` — i.e., two flags that always travel together, not two independent axes.
- **Reading B — `blocking` gates something broader than this one block's own completion.** For example,
  mirroring `config.assessment.blocking`'s existing package-level meaning ("gate lesson progression while
  open," `journey-package.schema.ts:746`) — a `project` block with `blocking: true` might need to prevent
  progress at a *milestone* or *outcome* level (e.g., the learner can technically move to the next
  lesson's blocks, but a downstream milestone/graduation check stays unmet until this block's submission
  exists), independent of `requiresSubmission`'s block-local gate. This would require new plumbing beyond
  `gradePlayerBlock`/`completeBlock` — likely into `outcomeSchema`'s milestone-availability checks or
  `config.graduation` — which is real, not-yet-scoped work if Reading B is correct.

I'm naming this rather than picking one, per the task's instruction. If Reading A is correct, the schema
sketch in §2 needs no further design work before Stage E.3's build phase. If Reading B is correct, this
report is incomplete as a build-precursor — the milestone/graduation interaction needs its own design
pass before implementation starts.

---

## Recommended shape (for approval, not a decision)

Add `project` as a seventh `lessonBlockSchema` member per §2's sketch, with `content`/`requiresSubmission`/
`blocking`. Grading likely needs zero new code (falls through to the existing generic-completion default
at `service.ts:725`) — confirm this at build time rather than assuming, in case the default's behavior
shifts before E.3 is built. Render needs one new `LessonPlayer.tsx` branch, structurally copied from
`teach`'s. No `content/block-ids.json` change. No new Prisma table or column. Zero impact on any existing
course.

**Before build starts, Michael's call is needed on the §5 fork** — what `blocking` means beyond
`requiresSubmission` — since it determines whether E.3's build stage is "one schema member + one render
branch" or "that, plus milestone/graduation plumbing."

Do not begin implementation — awaiting approval.
