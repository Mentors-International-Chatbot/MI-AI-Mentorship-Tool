# Phase C — Project, milestone interleaving, submission: Investigation

Date: 2026-09-05
Status: C.1 and C.2 complete. Phase C paused after C.2 by decision — see "Phase C pauses here" below.

## What already exists

- **`project` block type** (`journey-package.schema.ts:586`) is shipped and in real use — 11 instances
  across AI Essentials Aug 2026. In practice it's authored as a lightweight, ungraded in-lesson
  exercise (`content: string`, `requiresSubmission`, `blocking`), not the structured "overview/steps/
  skills/software/submit-how" brief C.1's text describes, and not milestone-linked. C.1's literal spec
  is thinner than what the plan calls it — the existing single-`content`-string shape matches every
  other block type's authoring convention (teach, teach_back, resource all use one string), so this is
  a real question about whether C.1 needs new structured fields or whether "authored brief" just means
  "author writes it well in `content`," not a confirmed gap either way.
- **`outcome.project` / `outcome.milestones` / `outcome.mentorResources`** (`journey-package.schema.ts:1009`)
  is a real, working config-level schema — course title/description/deliverables, a milestone list with
  `availability` gating (`immediate` / `after_lesson` / `after_milestone`), and milestone-triggered
  mentor resource messages (`on_reach` / `when_behind`).
- **The milestone map is confirmed and authored**, closing the plan's previously-open decision ("Milestone
  map confirmation → blocks C.2"). AI Essentials Aug 2026's `outcome.milestones` (lines 888-894) matches
  the proposed M1-M5 exactly (business process → failure modes → system design → model selection →
  platform/guardrails), each gated `after_lesson` on lessons 1-5, deliverable = "Final write-up."
  `mentorResources: []` — the milestone-triggered mentor nudge messages are not authored yet, but that's
  optional content, not a blocker.
- **`MilestoneProgress`** is enrollment-scoped (post-A.6.1/A.6.2) and the player dashboard already reads
  it (`player/service.ts` — `milestoneStates`, capstone `graduated` gate, dashboard progress display).

## ⚠ The finding that reframes this phase's priority

**`MilestoneProgress` has no write path on the player surface at all.** `recordMilestoneReached` — the
only function that ever creates a `MilestoneProgress` row — is called from exactly one place:
`lib/messaging/handler.ts`, the legacy chat-surface handler. Grepped `player/service.ts` and
`playerRuntimeRepo.ts` for any `milestoneProgress.create`/`.upsert` call: none exists.

Concretely: AI Essentials Aug 2026 is a **player-surface** course (PBJ single-thread web player, not
chat). It has 5 real, authored milestones. The player dashboard computes and displays milestone
eligibility/reach state and gates `graduated` on "every milestone reached." **No AI Guidance learner can
ever reach a milestone or graduate, because nothing on the surface they're actually using ever writes
the row that would record it.** This isn't a UX gap (no interleave prompt) — it's a full absence of the
underlying mechanism for the one course that has milestones authored today.

This matches C.2's own framing exactly — "block-level `milestoneRef` doesn't exist and IS the entire
mechanism (build it)" — but the investigation raises what it's for: not just an authored interleave
*prompt*, but the *only* way a player-surface milestone can ever become reached. **C.2 is not one of
three parallel-ish sub-phases here — it has to land before C.1's milestone-linking or C.3's
milestone-scoped submissions can be verified against anything real**, the same "fix order is
non-negotiable" shape as Phase A's G3→G4→G1.

## C.3 — confirmed fully unbuilt

No `ProjectSubmission` model exists in `schema.prisma`. No course-admin "project pipeline" UI exists
(grepped `stalled`/`project pipeline`, zero hits). This is a from-scratch model + migration + mentor
review-queue UI + (later, Phase D territory) course-admin pipeline view.

Today a `project` block's "submission" is a plain chat-thread text response — the same shared-textarea
path `teach.expectsResponse` uses — captured into `BlockProgress.response` as `{acknowledged: true}`
only (the schema's own comment on the block, `journey-package.schema.ts:572-584`, already documents
this and deliberately rejects `requiresSubmission: true, blocking: false` for exactly this reason: the
text isn't retrievable anywhere). C.3's `url`/`fileRef`/`note` fields need real form UI, not a chat
message — a genuinely new player-surface interaction, not an extension of the existing text-response path.

## Proposed staging

- **C.0 (this report) — done.**
- **C.1 — block-level `milestoneRef` + the write path (elevated ahead of the plan's own C.1/C.2 order,
  per the finding above).** Add optional `milestoneRef` to `teach`/`project` blocks. On completion of a
  block carrying one, write `MilestoneProgress` (reuse `recordMilestoneReached`'s shape, add the
  player-surface caller it's missing) and show the authored interleave prompt (done/skip). This is the
  smallest slice that makes AI Guidance's 5 milestones and `graduated` gate real for the first time.
- **C.2 — `project` block enrichment, if still wanted after C.1 ships.** Revisit whether the authored-
  brief shape needs new structured fields once real milestone-linked authoring exists to test it
  against, rather than guessing the shape up front.
- **C.3 — `ProjectSubmission`.** Model + migration + submission form UI (url/fileRef/note) replacing
  the chat-textarea path for blocks that need a real artifact, not just acknowledgment + mentor review
  queue (oldest-unreviewed first). Canvas AGS stays a documented seam, no code, per the plan.

Starting with C.1 (renumbered — the milestone write path).

## C.1 — complete (2026-09-05)

Shipped: `teach` blocks gain optional `milestoneRef`/`interleavePrompt` (required together, validated
against `outcome.milestones`); `completeBlock` surfaces a pending `interleave` prompt and resolves it
via an explicit `interleaveAction: "done" | "skip"` — the write to `MilestoneProgress` only ever
happens on "done," never implicitly. `LessonPlayer.tsx` holds the block open with Done/"Not now"
buttons until resolved. AI Essentials Aug 2026's 5 milestones are now reachable for the first time —
authoring the actual `milestoneRef` links onto those blocks is separate follow-up content work, not
code, and hasn't been done yet.

One real design note: labeled the decline option "Not now," not "Skip for now" — that exact phrase is
retired in this codebase (`LessonPlayer.tsx`'s own test history) for a specific, different hazard, an
abandon-button on a block that requires a response. This checkpoint is always optional by design, so
it isn't that hazard, but reusing the phrase would read as if it were.

### C.1 was on the BYU pilot's critical path — confirmed, and the fix needed a second half

Michael asked whether `apps/web/src/lib/lti/ags.ts`'s Canvas score payload is milestone-derived, since
if so, the original framing ("no AI Guidance learner could graduate") undersold what was broken. It is:
`buildScorePayload`/`queueMilestoneGrade` (`lib/lti/grades.ts`) computes the capstone grade entirely
from `MilestoneProgress` count — `scoreGiven = count * 20`, `scoreMaximum = 100`, `activityProgress`
flips to "Completed" only at `count >= 5`. No lesson completion, block score, or assessment result
factors in at all. This was previously undocumented anywhere; now written on `queueMilestoneGrade`'s
own doc comment.

Confirming that surfaced a second gap, identically shaped to the first: `queueMilestoneGrade` — the
function that actually reads the count and enqueues the Canvas score — was *also* only ever called
from `messaging/handler.ts` (chat surface), never the player surface. So C.1 alone was necessary but
not sufficient: a BYU learner's "done" click would have written the `MilestoneProgress` row (the fix
already shipped) but queued no Canvas grade delivery, leaving the capstone line item silently
un-posted — exactly the "green retry queue, zero score" failure mode Michael named, just one call
further down the same pipeline. Fixed in the same stage (same fire-and-forget call, mirroring the
chat-surface site exactly) rather than left half-closed. See the `queueMilestoneGrade` doc comment for
a third, related but out-of-scope finding: the `>= 5`/`> 5` thresholds hardcode "this course has
exactly 5 milestones" as shared code, not config — true for AI Essentials Aug 2026 today, a latent
defect for the next course with a different milestone count. Flagged, not fixed, in that comment.

## Phase C pauses after C.2 — decision (2026-09-05)

C.2 (the `project` block authoring-shape decision) proceeds now, immediately below — it's a decision,
not a build, and gets more expensive to make well once the journey-package spec hardens in Phase E.
C.3 does not proceed now. Two reasons, one per half:

- **Term-deadline load.** Three phases would otherwise run concurrently against the BYU pilot deadline
  (B, the Auth & Login track, and C) — B and the Auth & Login track already share a declared collision
  on the D15 constraints. C.1 fixed something broken (a launch-blocking grade/graduation gap); C.3 is a
  new feature. The pilot needs launch, identity, and grades to work — not a submission review workflow.
- **C.3 splits into two pieces with different, real blockers**, not one uniform "not now":
  - **C.3a (`ProjectSubmission` + learner submission form)** is self-contained and touches nothing in
    flight, but must stay **link-only** if it starts. `url`/`note` are fine; `fileRef` is not, until
    L0.1.4 (data residency / transcript retention) has a named BYU owner — student file uploads are
    education records, and building a storage path before BYU answers residency risks building it
    twice.
  - **C.3b (mentor review queue)** is genuinely blocked, not just deprioritized. "Submissions for their
    assigned learners" is exactly the phrase L5 is redefining — from `Socio.mentorId` to the
    `Enrollment ⋈ CourseStaffAssignment` join. A reader built against the current relation now either
    sits on infrastructure L5 is about to replace, or becomes a fourth definition of "this mentor's
    learners" alongside the three that already disagree — the August bug, rebuilt on purpose. The
    restructure plan also has this queue slotting into Phase D's course-scoped dashboard once that
    ships, so a standalone surface built first is double work on top of the blocker. This collision is
    recorded in the Auth & Login plan's own sequencing table, not just here.

Not started: C.3a and C.3b both remain fully unbuilt. Revisit C.3a once L0.1.4 has an owner (link-only
is still safe to build sooner if the term timeline demands it); revisit C.3b once L5 ships.

## C.2 — decision: keep the `project` block's single-`content`-string shape (2026-09-05)

**Question:** does `project` need structured authoring fields (overview/steps/skills/software/
submit-how, per the plan's original text), or does the existing single-`content`-string shape suffice?

**Decision: no new structured fields.** The existing shape stays.

**Why, now that real content exists to test the question against:**

1. **Consistency.** Every other block type that carries authored prose — `teach`, `teach_back`,
   `resource` — uses one string, not a multi-field form. A `project` block authored as five separate
   fields would be the only block type shaped that way, and "the odd one out is where the next bug
   lives" has already proven true once this session (the same reasoning the Auth & Login plan uses for
   why `SocioDimensionState` should be enrollment-scoped like everything else, not the exception).
2. **The real evidence is already in.** AI Essentials Aug 2026 has 11 authored `project` blocks,
   including the one that matters most for this question — b1-11, "Your gameplan, and your project
   process — Milestone 1" — and every one of them conveys overview/steps/what's-being-asked through
   plain markdown (bold headers, numbered lists) inside one string, successfully, already shipped.
   Nothing about the real authoring experience asked for separate fields; the plan's original text
   predated that experience.
3. **Cost.** Structured fields mean schema, converter, renderer, and progress-semantics work for a
   shape nothing has needed yet — the same tradeoff Track E's own doc comments already reasoned through
   for a different block type (why `onboarding_survey`'s chips stayed out of block-level structure).
4. **The part of C.1's text this was meant to solve is already solved differently.** "Config references
   the course milestone set" is now `milestoneRef` (C.1/C.2 above) — a mechanism, not a content shape.
   The authoring-shape question and the milestone-linking question turned out to be orthogonal; only
   the second one needed new schema.

This closes Phase C's open decision. Nothing else changes as a result — no migration, no schema
change, no re-authoring of existing content.

## Phase C pauses here

C.1 and C.2 (plus the C.1 corrections both raised) are done. C.3a/C.3b are deliberately not started —
see the split/defer section above. Next work on this phase resumes when either blocker clears
(L0.1.4 ownership for C.3a, L5 for C.3b), not on a fixed schedule.

## UX copy rule (added 2026-09-05)

**Never reuse a UI string this codebase has deliberately retired**, even for a feature that seems
unrelated. A retired phrase carries the meaning it was retired for — the next reader infers that
meaning from the words, not from which feature they're reading. ("Skip for now" was retired for the
`expectsResponse` abandon-button hazard; C.1's milestone checkpoint is optional by design and isn't
that hazard, but reusing the exact phrase would read as if it were — hence "Not now" instead.) Grep the
codebase's own retired-phrase history before landing on copy for a new optional/declining control.
