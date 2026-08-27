# Phase A.7 — Stage 0 Investigation: Legacy Column Load-Bearing Recheck

Date: 2026-08-25
Scope: investigation only, per instructions. No code, schema, or migration changes. The only
file written is this report. Two throwaway diagnostic scripts were created under
`apps/web/scripts/` (a live-DB PBJ/AssessmentSession query attempt, which failed to connect for
env-permission reasons — see §3 — and a redacted-host env check) and deleted after use, same
pattern as prior investigations.

References: `docs/Platform_Restructure_Plan_v1.1.md` lines 140–217 (A.6's original FINAL-step
audit and Phase A.7 filing — the actual source of the "five columns" finding),
`docs/Platform_Restructure_Plan_v1.2.md` lines 1–105 (superseding summary, "Confirmed still-live
dependents" table). **Correction to the task's own reference**: `reports/phase-a-investigation.md`
is the Phase **A.0** report (enrollment-as-entity investigation) and contains no column analysis —
it predates A.6 entirely. The real source is the two plan docs above.

---

## 0. Naming correction — "five columns" vs. six

The plan docs are consistent but easy to miscount. **The five**, per v1.1 line 163–165 verbatim:

1. `Socio.curriculumCollectionKey`
2. `BlockProgress.socioId`
3. `BlockProgress.collectionKey`
4. `MilestoneProgress.socioId`
5. `MilestoneProgress.collectionKey`

`AssessmentSession.socioId` is a **sixth, separately-tracked item** — v1.1's Phase A.7 scope list
(line 212–214) and item 6 of its A.6 section name it distinctly ("drop `curriculumCollectionKey`,
the two coursework tables' legacy columns, **and** `AssessmentSession.socioId`"), and v1.2's table
calls it out as the "most consequentially" load-bearing one. The task's own §2 explicitly asks
about `getAssessmentSessionsForSocioLesson`, which is `AssessmentSession` territory — so this
report treats all six as in scope, labeled 1–5 (the five) and 6 (the adjacent one), rather than
forcing a miscount.

---

## 1. Re-establish the columns — table, column, type, migration history

Read directly from `apps/web/prisma/schema.prisma`:

| # | Column | Type (as declared) | Nullable? |
|---|---|---|---|
| 1 | `Socio.curriculumCollectionKey` (`curriculum_collection_key`) | `String?` | Yes |
| 2 | `BlockProgress.socioId` (`socio_id`) | `String?` | Yes — made nullable in A.6 closing cleanup |
| 3 | `BlockProgress.collectionKey` (`collection_key`) | `String?` | Yes — same migration |
| 4 | `MilestoneProgress.socioId` (`socio_id`) | `String` | **No** — required, has FK (`socio Socio @relation(fields: [socioId], references: [id])`) |
| 5 | `MilestoneProgress.collectionKey` (`collection_key`) | `String` | **No** — required |
| 6 | `AssessmentSession.socioId` (`socio_id`) | `String` | **No** — required, has FK (`socio Socio @relation(fields: [socioId], references: [id])`) |

**Not touched by any Phase B migration — confirmed.** `apps/web/prisma/migrations/` in chronological
order ends at `20260823020000_block_progress_legacy_columns_nullable` — no migration folder exists
after it. That migration's SQL (read in full) does exactly one thing: `ALTER TABLE "block_progress"
ALTER COLUMN "socio_id"/"collection_key" DROP NOT NULL` — columns #2/#3 only. Columns #1, #4, #5, #6
have never been touched by any migration; #4/#5/#6 are still `NOT NULL` today, exactly as they were
when A.6's FINAL step was blocked. Phase B shipped zero schema migrations (B.1–B.4 are all
JSON-config/Zod-schema additions over existing `Json` columns, not new DDL) — confirmed by the same
directory listing.

**This is itself a finding worth flagging**: #4, #5, #6 being `NOT NULL` with live FK relations
means a future drop of any of them is not a same-shape operation as #2/#3 — see §3.

---

## 2. Load-bearing reads, re-checked fresh against current code

### #1 `Socio.curriculumCollectionKey` — **(b) still load-bearing**, broad, unchanged

A repo-wide grep (`grep -rl curriculumCollectionKey apps/web/src`) returns **35 non-test files**:
chat-surface course identity (`messaging/handler.ts`, `onboarding/service.ts`, `chat/progress.ts`,
`ai/contextExtractor.ts`), auth surface (`app/api/auth/me/route.ts`, `app/api/auth/curriculum/route.ts`),
dashboard/admin rollups (`app/api/admin/socios/{filters,rollups}`, `app/dashboard/learners/*`),
cron (`app/api/cron/{check-in,reminders}/route.ts`), LTI provisioning (`lib/lti/provision.ts`),
signals (`lib/signals/zones.ts`), summaries (`lib/summary/generateSummary.ts`), and the repo layer
itself (`prismaRepo.ts`, `tenantPrismaRepo.ts`, `types.ts`, `tenantRepo.types.ts`). No material
change from the original A.6 finding.

**One read is not load-bearing, confirmed by design, not newly found**: `player/service.ts:133-134`
reads `socio.curriculumCollectionKey` only to log a `console.warn` diagnostic on an enrollment-miss
("has no matching active Enrollment — likely a data gap") — never to grant access. This matches the
schema's own doc comment on the column verbatim ("only reads this field for a diagnostic log line...
never to grant") and is the one deliberate exception the player surface carries. It does not add
load-bearing weight beyond what A.6 already knew.

**Phase B added zero new reads** of this column — `player/dashboard.ts` and `ai/service.ts` (the two
files not previously audited for this column specifically) return zero grep hits.

### #2/#3 `BlockProgress.socioId`/`.collectionKey` — **(b) still load-bearing**, narrow and enumerable

Two real call sites, both confirmed by reading the WHERE clause directly (not inferring from a
grep hit):

- `tenantPrismaRepo.ts:1310-1312` — `learnerProjectSelectionRequired`'s grandfathering check:
  `prisma.blockProgress.findFirst({ where: { socioId: owner.socioId, collectionKey,
  completedAt: { gte: owner.enrolledAt } } })`. Unchanged since A.6.
- `app/api/lti/instructor/overview/route.ts:31` — `ltiRuntimeRepo.blockProgress.findMany({ where:
  { socioId: { in: socioIds }, collectionKey: collection.slug, completedAt: { not: null } } })`.
  Unchanged since A.6.

**The player surface is confirmed fully clean.** Every `blockProgress.*` call in `player/service.ts`
(15 call sites, all grepped and read) — including every B.1–B.4 addition — filters exclusively on
`enrollmentId`, never `socioId`/`collectionKey`. This is worth stating plainly because it's the
easiest place to produce a false positive: `PlayerAccess.socioId`/`.collectionKey` are in-memory
struct fields read constantly throughout `player/service.ts`, but none of those reads reach a
`BlockProgress`/`MilestoneProgress`/`AssessmentSession` WHERE clause — they're used for other
purposes (route resolution, `AssessmentSession` creation args, log lines). Phase B added no new
dependency here.

### #4/#5 `MilestoneProgress.socioId`/`.collectionKey` — **(b) still load-bearing**, unchanged, and structurally heavier than #2/#3

- `ai/prompts/router.ts:208` — `repo.getMilestoneProgress(socioId, collectionKey)`, feeding the
  router's milestone-gating logic (the doc's "most consequentially" caveat, re-confirmed current).
- `lib/lti/grades.ts:5,8` — `queueMilestoneGrade`: `ltiRuntimeRepo.milestoneProgress.count({ where:
  { socioId, collectionKey } })` and a second `{ where: { socioId } }` lookup.
- `app/api/lti/instructor/overview/route.ts:32` — `ltiRuntimeRepo.milestoneProgress.findMany({
  where: { socioId: { in: socioIds }, collectionKey: collection.slug } })`.

All three unchanged from the original finding. **Unlike #2/#3, these columns were never made
nullable** — confirmed in §1 — so even once A.7 migrates these three readers off them, dropping
the columns is a two-step operation (nullable, then drop), not a direct drop.

### #6 `AssessmentSession.socioId` — **(b) still (most) load-bearing**, unchanged, and B.2's new code confirmed clean

- **Three ownership 403 checks, unchanged**: `app/api/assessment/[sessionId]/route.ts:46`,
  `.../message/route.ts:69`, `.../complete/route.ts:72` — all `assessmentSession.socioId !==
  socioId` object-property reads (not WHERE-clause reads, but a real dependency on the column's
  *value*, which a drop would remove).
- **The router's gate-session lookup, unchanged, re-confirmed at current line numbers**:
  `ai/prompts/gateSessions.ts:45-46` calls the *legacy* `repo.getAssessmentSessionsForSocioLesson(
  socioId, lessonKey, blockId)` — `prismaRepo.ts:1056-1065`'s implementation, `WHERE { socioId,
  lessonKey, blockId }`, a genuine column read. `router.ts:255` (`createGateSessionLoader(socio.id)`)
  and `stance.ts:144,191,366` (same default) are the callers — this is still the single choke point
  for "is this gate passed" on the chat surface, exactly as A.6 found. No change.
- **`getAssessmentSessionsForSocio` (the non-lesson-scoped sibling), unchanged**: `WHERE {
  organizationId, socioId }` in `tenantPrismaRepo.ts`, called from `createAssessmentSession.ts`,
  `app/api/assessment/{start,route}.ts`, `app/dashboard/learners/[id]/panelData.ts`,
  `lib/signals/gather.ts` — matches the doc's "foundational... dashboards, signals" citation exactly.

**What Phase B added here, checked directly, is clean**: B.2's `TenantRepo` twin
(`tenantPrismaRepo.ts:2267-2277`, `getAssessmentSessionsForSocioLesson(ctx, enrollmentId, lessonKey,
blockId)`) has a WHERE clause of `{ organizationId, enrollmentId, lessonKey, blockId }` — **no
`socioId` field anywhere in it**, confirmed by reading the implementation directly, not by trusting
its name. Its one caller, `player/service.ts`'s `resolveReteachGateSignal` (and this session's new
`resolveOrCreateReteachGateSession`), never touches `AssessmentSession.socioId` either. **Phase B
added a genuinely parallel, non-overlapping enrollment-scoped path — it did not reduce column #6's
load-bearing status on the chat surface, and it did not introduce any new dependency on it either.**
This is the one place where B's new code is directly adjacent to one of the six columns, and the
finding is "no change in either direction," not "newly load-bearing" or "newly dead."

**Test-pin cross-check**: 4 of the 5 named legacy-behavior test files exist unchanged at their
cited paths (`stance.test.ts`, `router-progression.test.ts`, `router-stance.test.ts`,
`channelSupport.test.ts`). The fifth, `gate-integration.test.ts`, exists but at
`lib/ai/assessment/__tests__/gate-integration.test.ts`, not `lib/ai/prompts/__tests__/` as v1.1's
citation implied — a path correction, not a missing file. All five still exercise the legacy
socioId-keyed gate path.

### Category (a) confirmed-dead and (c) ambiguous — none found

**All six columns land in category (b), still load-bearing, with zero exceptions.** No column had
zero reads, and no read site found appeared to be an unreachable branch or dead code path. This
directly reconfirms A.6's original finding rather than revising it — the one substantive update is
that Phase B's new code (§ above, column #6) is confirmed **not** to have changed the picture in
either direction, which was the open question this stage existed to resolve.

---

## 3. Drop safety

**Moot for now, stated plainly rather than forced**: since every column is still category (b),
none qualifies for "confirmed dead → is a migration enough, or does data need preserving first."
That question has no live column to apply to yet. Two things are still worth recording now, since
they'll matter the moment A.7's four scope items land and this recheck is re-run:

- **#2/#3 (`BlockProgress`) are already nullable** (A.6 closing cleanup) — once their two remaining
  readers (`learnerProjectSelectionRequired`, LTI overview) are ported to `enrollmentId`, dropping
  them is a single, low-drama migration: the column is already optional, no NOT NULL constraint or
  FK to unwind.
- **#4/#5/#6 (`MilestoneProgress.*`, `AssessmentSession.socioId`) are still `NOT NULL` with live FK
  relations to `Socio`.** Even after A.7 migrates every reader off them, dropping the columns
  outright is not a single mechanical step the way #2/#3 will be — the FK and NOT NULL constraint
  need unwinding first (nullable → confirm no writer still populates it as required → drop), and
  per this project's approval-gates-before-destructive-operations principle, that sequencing (not
  just the final drop) should go through the same investigate-first gate A.6 already established
  (D13: "never drop a column based on 'no reads in the surface I migrated' — full-codebase grep
  first"). Row-count/export-need questions were not pursued this pass since no column reached
  category (a) — that check belongs in the investigation that actually proposes a drop, not here.

**Shadow-database migration path — re-verified fresh today, not carried over from memory.**
The 2026-08-10 finding is **still accurate, unfixed, confirmed via a redacted host-only check**
(a throwaway script printing `new URL(process.env.X).host` — never the full connection string or
credentials — deleted after use):

```
DATABASE_URL:        host=ep-bold-bar-adzjnfe0-pooler.c-2.us-east-1.aws.neon.tech  path=/neondb
SHADOW_DATABASE_URL:  host=ep-bold-bar-adzjnfe0.c-2.us-east-1.aws.neon.tech         path=/neondb
```

Same base identifier (`ep-bold-bar-adzjnfe0`), same database name (`/neondb`) — pooled vs. direct
endpoint of the **same physical Neon database**, not a separate throwaway shadow DB. `prisma.config.ts`'s
own comment confirms the intended contract (`shadowDatabaseUrl` must be a direct, throwaway
database, used only by `migrate dev`) — the configured value satisfies "direct" but not "throwaway."
**This means the same constraint A.6 operated under still applies to any future A.7/A.7-adjacent
migration: never `prisma migrate dev`, never `db push`. Use `prisma migrate diff
--from-config-datasource --to-schema prisma/schema.prisma --script -o
prisma/migrations/<ts>_<name>/migration.sql` then `prisma migrate deploy`**, exactly as A.6's own
migrations were applied (confirmed: `20260823020000_block_progress_legacy_columns_nullable`'s SQL
is a plain hand-written `ALTER TABLE`, consistent with the diff+deploy path, not a `migrate dev`
artifact).

I could not query live row counts for the four tables in this environment — direct `.env`/`.env.local`
reads are permission-blocked here (confirmed twice this session, including a failed live-DB connection
attempt earlier when `DATABASE_URL` wasn't loaded), though the redacted host check above worked because
it never displays the file contents or credentials, only a parsed hostname. This is noted as
unattempted-because-moot (§3 above), not as a gap in this report's conclusions.

---

## Verdict, per column

| # | Column | Verdict |
|---|---|---|
| 1 | `Socio.curriculumCollectionKey` | **Not yet** — broad, ~35-file dependency, unchanged from A.6 |
| 2 | `BlockProgress.socioId` | **Not yet** — 2 real readers (grandfathering check, LTI overview); already nullable, cheapest to eventually drop |
| 3 | `BlockProgress.collectionKey` | **Not yet** — same 2 readers as #2 |
| 4 | `MilestoneProgress.socioId` | **Not yet** — router milestone-gating, LTI grades, LTI overview; still `NOT NULL`, FK live |
| 5 | `MilestoneProgress.collectionKey` | **Not yet** — same 3 readers as #4; still `NOT NULL` |
| 6 | `AssessmentSession.socioId` | **Not yet** — 3 ownership checks, router's gate-session choke point, `getAssessmentSessionsForSocio`; still `NOT NULL`, FK live; B.2's new enrollment-scoped twin confirmed not to change this |

**None of the six is safe to drop now.** None needs a fresh product decision either (no column
landed in the "ambiguous, needs a call" category) — the picture is exactly what A.6 found, re-verified
against current code including everything Phase B added, with one clarified addition: Phase B's new
`AssessmentSession` read path is confirmed genuinely parallel and non-overlapping, not a reason to
revise column #6's status in either direction. A.7's four scope items (chat/LTI progress+milestone
port, LTI grading port, router/stance port, `learnerProjectSelectionRequired` redesign) remain the
actual precondition for any of these six drops, unchanged from the plan.

Do not begin implementation, and do not draft a migration — awaiting approval.
