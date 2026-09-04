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

Current: `/dashboard/learners` (list), `/dashboard/learners/[id]` (chat, `SliderPanel.tsx`, flags, lesson
progress), `/dashboard/alerts`. **No flag-triage inbox (severity×age), no embedded assistant, no
confirmed-tool machinery (`adjust_learner_overrides`/`draft_message_to_learner`/`resolve_flag`/
`snooze_flag`/`summarize_history`) exist at all** — grepped for all of these, zero hits. This is a
from-scratch build, not a refactor, and it's the one piece of Phase D most likely to need a UX decision
(confirmation flow shape) before or during the build rather than purely mechanical work.

## Concurrent work in this repo (unrelated to Phase D)

`reports/l0-auth-login-investigation.md` appeared mid-investigation, untracked — a separate "Auth &
Login Restructure" (L0/L1/L2) track, clearly from a different, currently-running session (there's a
live `.claude/scheduled_tasks.lock` in this working directory). It touches session/role/redirect code
(`token.ts`, `session.ts`, `proxy.ts`) that Phase D's guard work also touches. Worth knowing about to
avoid stepping on the same files — not something to act on here.

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
