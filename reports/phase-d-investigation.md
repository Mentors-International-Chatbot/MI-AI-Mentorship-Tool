# Phase D — Role split + three dashboards: Investigation

Date: 2026-09-04
Status: Investigation complete for D.2 onward. D.1 (scope resolver) already built, tested, uncommitted at investigation start.

## What already exists (do not rebuild)

- **Role split is already real**, not aspirational: `SessionRole = 'socio' | 'mentor' | 'admin' | 'course_lead'`
  (`lib/auth/token.ts`). `admin` already functions as system admin; `course_lead` already exists as the
  course-admin role the plan calls for expanding.
- **Tenant-scoping primitives already exist and are solid:**
  `writableScopesFor(session)` / `canWriteScope(session, scope)` (`lib/auth/courseScope.ts`) resolve
  exactly which `(organizationId, collectionKey)` pairs a `course_lead` may touch, admins get every
  collection. `mentorCaseloadScope` does the equivalent for mentors. `/api/admin/config` (GET/PUT/DELETE)
  already uses these directly and is correctly tenant-safe today — a course_lead cannot read or write
  another org's config; verified by reading the route, not assumed.
- **D.1 (`resolveAdminScope`)** — a discriminated-union read-scope resolver (`system` / `course_admin` /
  `mentor` / `none`) sitting on top of the above, already committed (`d08fe3a`) with a same-session
  hardening pass (distinct `ambiguous_org_mentor`/`ambiguous_org_course_lead` reasons, tests pinning all
  5 `none` reasons pairwise-distinct) left uncommitted. Tests pass (15/15), `tsc --noEmit` clean.
  **Zero callers exist yet** — built, not wired, exactly as its commit message says.
- **AuditLog is already wired** on every existing admin write path (`config`, `mentors`, `prompts`,
  `socios`, `password`) — D6's "audit-logged writes" requirement is already satisfied for everything
  that exists today, not a gap to build.

## Where the guard model is thinner than the plan assumes

`requireAdmin` (system-admin-only) and `requireCourseConfigurer` (admin + course_lead) are the only two
guards. `/api/admin/socios`, `/api/admin/mentors`, `/api/admin/analytics`, `/api/admin/socios/rollups`
all use `requireAdmin` — **a course_lead is forbidden from all of them today**, full stop. This is not a
tenant leak (nothing scopes incorrectly) — it's a missing feature: course_lead has no course-scoped view
of socios/mentors/analytics at all, because that view was never built. This is the real center of mass
of remaining Phase D work, not a bug fix.

No `requireSystemAdmin` guard and no `repo/system/` namespace exist. In practice `requireAdmin` already
*is* "system admin only," and every route using it already goes cross-org by calling `prisma` directly
rather than through a tenant-scoped repo — i.e. the pattern D6 asks for already exists, just under the
name `requireAdmin` instead of `requireSystemAdmin`, and undocumented as its own directory. A pure
rename/re-namespace has real mechanical cost (touches every admin route) for no behavior change; folding
it into whichever stage first adds a genuinely new cross-org capability is cheaper than a standalone
rename pass.

## Mentor dashboard: current state vs. plan

**Correction (2026-09-04, D.3 investigation) — the D.0 claim below was wrong.** A literal grep for
`resolve_flag`/`snooze_flag`-shaped strings found nothing because `FlagsPanel.tsx`
(`dashboard/learners/[id]/FlagsPanel.tsx`) builds its fetch URL dynamically
(`` `/api/dashboard/flags/${flagId}/${action}` ``) — the grep pattern never matched. Reading the file
directly turned up a fully-built, fully-wired flag triage flow:

- `/dashboard/alerts` (`AlertSnapshot.tsx` + `lib/signals/zones.ts`) — a real severity-grouped triage
  view. Zones: `asked_for_you` (help requests, oldest-first — age-sorted by design, the code comment
  explains why), `needs_you_now`/`watching` (RED/YELLOW, most-recent-signal-first), `good_news`
  (derived positive signals). Every card links through to `/dashboard/learners/[id]`.
- `FlagsPanel.tsx` on the learner page — full acknowledge/snooze(1/3/7/30d)/resolve(disposition +
  required note on RED) actions, already calling the existing
  `/api/dashboard/flags/[id]/{acknowledge,snooze,resolve}` routes, with optimistic UI state and a
  "jump to the message that raised this" affordance.

This is "severity×age" triage, end to end, already shipped — not a gap. What actually remains from
the plan's D.3 bullet:

1. **`SliderPanel.tsx` deletion** (keep the underlying `/api/mentor/socios/[id]` PATCH — the "override
   machinery" to keep) — still true, not done.
2. **Remove web-chat nav link for mentors** — `dashboard/layout.tsx` shows `/chat` to every role
   unconditionally; plan wants it gone specifically for `mentor`. Not done.
3. **Whether `/dashboard/alerts` becomes the default landing page** — today `/dashboard` redirects to
   `/dashboard/learners` (roster), with a code comment: *"Additive: /dashboard/learners stays the
   landing page until the signals view is proven."* Flipping this is reversing a previously-made
   staging decision, not a gap — flagging for Michael rather than silently overriding it.
4. **Embedded assistant with confirmed tool calls is the only genuinely unbuilt piece** — but it is
   smaller than the original D.0 pass assumed, because its likely tool set already has working
   implementations to wrap: `adjust_learner_overrides` → `/api/mentor/socios/[id]` PATCH,
   `resolve_flag`/`snooze_flag` → the two routes `FlagsPanel` already calls,
   `draft_message_to_learner` → `/api/dashboard/socios/[id]/message`,
   `summarize_history` → `/api/dashboard/socios/[id]/summaries`. The new work is the LLM tool-calling
   loop and the confirm-before-execute UI, not the actions themselves. Still needs its own
   investigation (does any Claude tool-use wiring already exist in this codebase to build on?) and
   the UX-confirmation-flow decision flagged earlier.

## Concurrent work in this repo (unrelated to Phase D, except one real collision)

`reports/l0-auth-login-investigation.md` appeared mid-investigation, untracked — a separate "Auth &
Login Restructure" (L0/L1/L2) track, clearly from a different, currently-running session (there's a
live `.claude/scheduled_tasks.lock` in this working directory). Its Plan v1.1 was shown to this session
on 2026-09-04. Mostly non-colliding — it owns `proxy.ts`/`lib/auth/*` session/role/redirect plumbing,
Phase D doesn't touch those. Its own sequencing table says as much: "L5 builds the relation, D builds
the dashboards it belongs in."

**One real collision, found by comparing the plan against code Phase D just shipped:** L5.2 proposes a
new `CourseStaffAssignment(mentorId, collectionKey, role: MENTOR | COURSE_ADMIN)` table as *"the same
table that assigns mentors ... no second mechanism"* for course-admin scope. But `course_lead` scope
resolution already runs on `ProgramMembership` today (`writableScopesFor` in `courseScope.ts`) — the
exact mechanism D.1's `resolveAdminScope` and D.2's socios/mentors scoping (this phase) are built on.
L5.2's plan doesn't mention `ProgramMembership` at all, so as written it would introduce a second
course-admin-scope table alongside the live one — the same failure shape L5.1 itself warns about
(`MentoringRelationship`: populated, schema-blessed, unread), just introduced from the other direction.
Addendum written to `reports/l0-auth-login-investigation.md` flagging this for whoever builds L5.2;
not blocking on it here, but Phase D should **not** build `requireCourseAdmin`/mentor-assignment-write
scoping independently — L11 already names that exact route (`PATCH /api/admin/socios`) as its target,
and building it twice under two mechanisms is the thing both plans exist to prevent. D.3/D.4 below are
unaffected and proceed as planned.

## Proposed staging for the rest of Phase D

- **D.2 — Course admin read surface (net-new, no risk to existing mentor/admin UI):** wire
  `resolveAdminScope` into new course-scoped socios/mentors/analytics endpoints and a course-admin
  dashboard page reachable by `course_lead`. Pure addition; nothing existing changes behavior.
- **D.3 — Mentor dashboard rewrite:** flag-triage inbox (severity×age), delete `SliderPanel.tsx` UI
  (keep the override machinery it currently drives), embedded assistant with confirmed tool calls.
  Needs a short UX-confirmation-flow decision before the assistant tool-calling piece, flagged inline
  when reached — not blocking D.2.
- **D.4 — System admin formalization:** rename `requireAdmin` → `requireSystemAdmin` (or alias) and
  document `repo/system/` as the existing cross-org-direct-prisma pattern, fold in alongside whichever
  of D.2/D.3 first needs a new genuinely cross-org method, rather than a standalone rename pass.

Exit criteria per plan (unchanged): standard 4 + adversarial (course admin can't read other org, mentor
can't open either admin surface, cross-org write → AuditLog row, assistant tool calls require
confirmation, `adjust_learner_overrides` visibly changes tutor output).

Starting with D.2.
