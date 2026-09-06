# Phase C — Project, milestone interleaving, submission: Investigation

Date: 2026-09-05
Status: Investigation complete. One finding reframes priority within the phase; nothing here blocks starting.

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

Remaining: C.2 (revisit whether the `project` block needs structured authoring fields, now that
real milestone-linked authoring exists to test the question against) and C.3 (`ProjectSubmission` —
model, migration, submission form UI, mentor review queue). Both still fully unbuilt; C.3 in particular
is a genuinely new player-surface interaction (a form, not the existing chat-textarea path), not an
extension of anything unwired.
