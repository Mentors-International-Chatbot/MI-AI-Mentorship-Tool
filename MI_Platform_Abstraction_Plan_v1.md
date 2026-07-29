# MI Platform Abstraction — Plan of Action v1

**Status:** Proposed
**Supersedes:** Phases 0–11 sequencing in `AI_Mentorship_Platform_Architecture.pdf` (architecture principles from that brief remain in force)
**Repo:** Mentors-International-Chatbot/MI-AI-Mentorship-Tool — `apps/web`

## 1. Objective

Convert the MI-specific WhatsApp/web mentorship app into a multi-tenant, configuration-driven platform. Mentors International becomes org #1 / program #1, expressed entirely through configuration. A second program (BYU "AI in Business Strategies" or trade-school fork) launches with zero core-code changes.

## 2. Success criteria

- MI and a second program run concurrently on the same deploy
- No `if (org === "Mentors International")` branching anywhere
- No tenant-specific tables or schema changes for program #2
- Curriculum, terminology, metrics, alert rules, onboarding, AI tone: all loaded from versioned config
- Cross-tenant isolation tests pass (zero unauthorized reads/writes)
- Cohorts pinned to immutable ProgramVersion (research reproducibility requirement)

## 3. Architecture rules (non-negotiable)

1. **Configuration over branching** — program differences live in validated JSON config, never in conditionals
2. **Stable core / configurable layer** — auth, tenancy, orchestration, alert engine are core; terminology, curriculum, metrics, tone are config
3. **Universal entities** — Socio → ParticipantProfile, BusinessProgress → MetricObservation, etc.
4. **Published config is immutable** — changes create a new ProgramVersion; active cohorts stay on theirs
5. **AI observes, rules decide** — AI emits observations; deterministic AlertRules + humans create/escalate alerts
6. **Repo interface pattern holds** — all DB access through tenant-scoped repositories (existing pattern, now with mandatory org context)

## 4. Scope cuts vs. the original brief (confirm with Brad)

| Cut/Deferred | Rationale |
|---|---|
| Pinecone / vector RAG | Curriculum is sequential + injected per-lesson via 4-layer prompts; JSON lessons in Postgres generalize fine. RAG only needed for free-form Q&A over arbitrary uploads → Tier 3 commercial |
| PostgreSQL RLS + DB role separation | Awkward with Prisma + Neon pooled connections (`SET LOCAL` breaks under transaction pooling). App-layer tenancy + adversarial test suite suffices for two trusted tenants. RLS gates commercial onboarding, per original brief's own readiness gate |
| Maker-checker publishing | Single-admin publish for V1; state machine designed to add reviewer later |
| Active-cohort migration tooling | No active cohorts will need migration during V1 |
| Alert hysteresis / aggregation / persistence windows | Keep dedup + cooldown only; add the rest when alert-volume data proves fatigue |
| Dashboard zoo (Choke Point Analyzer, Risk Radar, Heatmaps, Experiments) | Generalize existing RYG triage + metric cards into config-driven components; defer the rest |
| Automated mentor matching, SSO, billing, SMS, mobile | Unchanged from original deferred list |

## 5. Domain model (Prisma, Phase 1)

**Tenancy:** Organization, OrganizationMembership
**Programs:** Program, ProgramVersion (holds config JSON), Cohort, Enrollment, EnrollmentInvitation
**People:** ParticipantProfile, MentorProfile, MentoringRelationship
**Content:** ContentCollection, Lesson, LessonVersion (JSON body)
**Measurement:** MetricDefinition, MetricObservation, AlertRule, Alert, AlertReview

Every tenant-owned row carries `organizationId`; program-scoped rows also carry `programId` (+ `programVersionId`, `cohortId` where applicable).

**MetricObservation fields** (serves product + research schema in one shot): `signalType`, `value`, `confidence`, `evidenceRefs`, `modelVersion`, `promptVersion`, `verificationStatus`, `source` (`self_reported | human_recorded | system_observed | calculated | ai_inferred`), `observedAt`

## 6. ProgramVersion config schema (zod-validated JSON)

```json
{
  "terminology": { "participantSingular": "", "participantPlural": "", "mentorSingular": "", "adminTitle": "" },
  "languages": ["es-CO"],
  "branding": { "displayName": "" },
  "aiBehavior": { "tone": "", "teachingStyle": "", "languageInstruction": "" },
  "onboarding": { "steps": [{ "id": "", "promptKey": "", "field": "", "validation": "" }] },
  "curriculum": { "contentCollectionId": "", "lessonOrder": ["lessonIds"] },
  "metrics": [{ "key": "", "type": "", "source": "", "scale": "", "label": "" }],
  "alertRules": [{ "id": "", "metricKey": "", "operator": "", "threshold": 0, "severity": "", "cooldownHours": 0 }],
  "graduation": { "requiredLessons": [], "requiredMetrics": [] },
  "notifications": { "schedules": [] }
}
```

States: `draft → published → archived`. Publish = atomic, immutable, audit-logged. Publication validation: zod pass, referenced lessons exist, alert rules reference defined metrics.

## 7. Phases

### Phase 0 — Inventory & migration prep (3–4 days)

- Grep audit: `socio`, `colombia`, hardcoded Spanish strings outside config, WhatsApp logic outside the adapter, direct lesson imports from `src/lib/lessons/data.ts`
- Table/endpoint inventory → legacy-to-generalized field map (doc in repo)
- Verified Neon backup; documented rollback
- **Exit:** every legacy table/field/endpoint has a written migration path

#### Migration history state (added 2026-07-28)

On **2026-07-28** `npx prisma migrate resolve --applied 00000000000000_init` was run against the dev DB: `_prisma_migrations` was empty, which blocked `migrate deploy` with P3005 for the new `20260728173037_add_ai_invocations` migration. That row is stamped `applied_steps_count = 0` with `started_at == finished_at`, so the baseline SQL was recorded but never executed — the dev DB's actual shape still derives from the pre-migration `db push` history. The pending squash must account for this row when picking a baseline, and note that it carries a checksum of the current `00000000000000_init/migration.sql`: rewriting that file in place without clearing the row will fail `migrate deploy` on a checksum mismatch.

### Phase 1 — Generalized schema + MI backfill (1–2 weeks)

- Add all Section 5 models via Prisma migration
- Backfill script (upsert, not skip-if-exists): MI as Organization, Colombia as Program, ProgramVersion v1, current cohort, socios → ParticipantProfile + Enrollment, mentors → MentorProfile + MentoringRelationship
- UI labels read from terminology config (one `useTerminology()` source)
- **Exit:** app runs entirely on generalized entities; "socio" appears only in MI's terminology JSON

### Phase 2 — App-layer tenancy (1 week)

- `organizationId` on every tenant-owned table (done in Phase 1 migration; enforced here)
- Tenant context: JWT → middleware → service → repo. Repo method signatures require org context (compile-time enforcement)
- Adversarial vitest suite: cross-tenant API reads/writes, guessed IDs, repo-level raw access, export paths
- **Exit:** zero unauthorized cross-tenant access across the test suite

### Phase 3 — Config, versioning, JSON curriculum (2 weeks)

- Migrate all 28 lessons from `src/lib/lessons/data.ts` → LessonVersion rows under MI ContentCollection (seed via upsert)
- ProgramVersion config blob + zod schemas + publication state machine + atomic publish
- 4-layer prompt assembly reads Layer 1–2 (identity, context framing) and tone from ProgramVersion config; SystemPrompt table content keys off `programVersionId`
- Config preview endpoint for admin dashboard
- **Exit:** changing curriculum or tone = publishing config, not editing code

### Phase 4 — Enrollment via program codes (1 week)

- EnrollmentInvitation: `tokenHash`, `displayCode`, `cohortId`, `maxUses`, `usageCount`, `expiresAt`, `status`, `createdBy`
- Signup page accepts code → validate (expiry, uses, rate limit) → create Enrollment pinned to cohort + programVersion → launch configured onboarding
- Onboarding state machine generalized: steps read from config (replaces hardcoded `NEW → AWAITING_NAME → ACTIVE`)
- Magic link + QR = same token, different presentation
- **Exit:** a participant can join any program with a code; no program-specific signup code paths

### Phase 5 — Config-driven metrics & alerts (1–2 weeks)

- Sentiment pipeline + `[FLAG]` / `[ESCALATE]` / `[LESSON_COMPLETE]` markers emit MetricObservation rows (full metadata fields)
- Deterministic AlertRule evaluator (runs post-message, reads rules from ProgramVersion config)
- Dedup + cooldown; structured review outcomes: `confirmed | false_positive | insufficient_evidence | duplicate | not_actionable`
- Hard rule: `ai_inferred`-only alerts cap at medium severity, `verificationStatus = unverified`
- Mentor RYG triage reads from Alert table instead of ad-hoc flags
- **Exit:** alert behavior changes via config; all alerts traceable to observations + rule version

### Phase 6 — Second-program pilot (1 week)

- Configure program #2 (BYU or trade-school) entirely through seed/admin UI: new org, terminology, lessons, metrics, alert rules, web-first channel
- Run isolation suite with both tenants live
- **Exit:** acceptance gates — zero core-code changes, zero schema changes, isolation tests green

**Total: ~7–9 weeks.** Phases 1–3 are the critical path (no parallel feature work). Phases 4 + 5 parallelize across the team after Phase 2 lands.

## 8. Abstraction map — where each hardcoded thing goes

| Hardcoded today | Becomes |
|---|---|
| "Socio" / Spanish role labels in UI + prompts | `ProgramVersion.config.terminology` |
| 28 lessons in `src/lib/lessons/data.ts` | LessonVersion rows (JSON) under MI ContentCollection |
| Colombian Spanish baked into prompts | `config.languages` + `config.aiBehavior.languageInstruction` |
| MI identity in prompt Layer 1–2 | Assembled from ProgramVersion config + SystemPrompt keyed by `programVersionId` |
| Single implicit org/program | Organization / Program / ProgramVersion rows; MI is just row #1 |
| `NEW → AWAITING_NAME → ACTIVE` onboarding | `config.onboarding.steps` (state machine engine stays core) |
| Sentiment thresholds + flag semantics | MetricDefinition + AlertRule config |
| Mentor assignment on participant record | MentoringRelationship entity |
| Open signup | Code-gated EnrollmentInvitation → cohort-pinned Enrollment |
| RYG triage logic | Alert engine reading config rules; dashboard renders Alert rows |
