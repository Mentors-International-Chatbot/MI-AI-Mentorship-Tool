# Platform Backlog & Canvas Integration — Plan v1

Six items captured **2026-07-27**. Ordered by dependency and value, not arrival. Everything follows the standing principle: course-agnostic, configuration over custom code, no hardcoded tenant/course assumptions.

## Item index

| # | Item | Size | Category |
|---|---|---|---|
| 1 | Password show/hide button broken on login/signup | XS | Bug |
| 2 | AI prompt trace logging (per-operation, in-depth for testing) | S–M | Observability |
| 3 | Easier login (teacher re-creates account every time) | — | Solved by #6 (LTI launch) for Canvas users; small session fix for everyone else |
| 4 | Mentor dashboard hardcoded Spanish → per-user language | M | Bucket 3 / i18n |
| 5 | Dashboard panels (revenue trends, weekly summaries, dimensions) configurable per course | M | Bucket 3 / config |
| 6 | Canvas integration (LTI 1.3 launch + REST API grade sync) | L | New integration |
| 7 | Enrollment guard — course selection can drift from the socio's anchored org | XS–S | Multi-tenancy |

## 1. Password visibility toggle (bug)

The eye/show-password button on login/signup does nothing. Almost certainly a missing state hook or the input `type` not switching between `password`/`text`. One component, one fix, add to the next small-fixes batch. Files: `login/LoginForm.tsx`, `login/LoginClient.tsx`, signup form.

## 2. AI prompt trace logging

**Goal:** for every LLM call, know exactly which prompt was sent, built from which pieces, at which version — queryable during testing.

**Design — one trace record per invocation:**

```
AiInvocation (new table, or structured log behind a flag — see decision)
  id, createdAt
  socioId?, assessmentSessionId?
  operation: lesson_delivery | assessment_turn | sensing |
             assessment_sensing | sentiment | summary | onboarding
  mode (router mode when applicable)
  model, promptTokensApprox, responseLength, latencyMs (already computed today)
  promptVersion: composite of layer versions, e.g.
    { core: "db:1.0", context: "v2", task: "v3", content: lessonKey,
      language: "en", evaluator: "v2-gist" }
  promptHash: sha256 of the final assembled prompt
  promptText: full text — ONLY when AI_TRACE=full (env flag), else null
```

**Implementation notes:**

- Every prompt builder exports a version string constant; bump on edit. The assessment evaluator and sensing prompts get versions too — today they're anonymous, which is why grader-tuning rounds were hard to compare.
- `MetricObservation` already has `modelVersion`/`promptVersion` columns — populate them from the same source so telemetry and traces line up.
- V1 can be a structured `console.log` JSON line + optional DB persist behind `AI_TRACE`. The DB table matters once you want to diff two grader runs by prompt version — which you literally needed this week.

**Decision needed:** log-only v1 vs table from day one. **Recommend the table** — it's one migration and the querying is the point.

## 3. Easier login

Two distinct populations, two answers:

**Canvas users** (the BYU teacher and his students): solved properly by Item 6. LTI launch = click the tool inside Canvas → identity asserted by Canvas → OCI creates-or-finds the account automatically → straight into the course. No account creation, no password, ever. The teacher's complaint is the textbook LTI use case. **Do not build a parallel login improvement for this population.**

**Everyone else** (WhatsApp-less web users, mentors, admins): smaller fixes:

- **Session longevity:** check JWT expiry; a short expiry forces re-login and feels like "making a new account" to a non-technical user. Extend + refresh-on-activity.
- **"Remember me"** on the login form.
- *(Later, optional)* magic-link email login — cheap with the existing jose JWT infra, removes passwords entirely. Defer unless demand.

**Worth checking first:** ask the teacher what actually happens — does he forget credentials, does his session expire, or did he genuinely lose the account? The fix differs. If he's been testing with fresh signups because that's the demo flow, LTI makes it moot.

## 4. Dashboard i18n (mentor/admin views still hardcoded Spanish)

The infrastructure mostly exists and is unused:

- `mentors.preferredLanguage` column exists (April migration) — the dashboard ignores it.
- The chat already has the `UI_STRINGS`-by-language pattern and `coerceUiLanguage` resolution.

**Work:**

- `DASHBOARD_STRINGS: Record<SupportedLanguage, {...}>` in `i18n/languages.ts` (or a sibling file — it'll be large), covering every label in `dashboard/*`, `admin/*`.
- Resolve language: **mentor/admin's own preference** (their row) → platform default. **NOT the socio's language** — the dashboard viewer's, a distinction the current hardcoding obscures.
- Language selector in the dashboard header (same component pattern as chat).
- Sweep the hardcoded Spanish strings — `dashboard.ts` participant noun labels (the deferred Bucket 3 item), page headers, table columns, panel titles.

Mechanical but wide. Good Claude Code batch job with a checklist of files, low risk (pure display strings).

## 5. Configurable dashboard panels per course

**Problem:** the mentor dashboard hardcodes MI's panels — revenue trends, financial snapshots, weekly summaries. A PB&J or BYU course has no revenue; a trades course might track different dimensions entirely.

**Design — panels are config, data comes from the metric pipeline:**

Journey-package `meta` addition (fits the `Prompt_Layer_Abstraction_Spec` pattern; all optional, defaults preserve current MI behavior only for MI):

```ts
dashboard: z.object({
  panels: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("dimension_trend"),
               dimensionKey: key,                    // must exist in trackedDimensions
               title: localizedString.optional() }),
    z.object({ type: z.literal("assessment_scores") }),   // per-lesson gate results
    z.object({ type: z.literal("weekly_summary") }),
    z.object({ type: z.literal("financial_snapshots") }), // MI-specific data source,
                                                          // only renders if enabled
  ])).default([]),
}).optional()
```

- `dimension_trend` panels read `metric_observations` (now persisting) filtered by org + dimension key — the flywheel data finally has a consumer.
- MI's package enables `financial_snapshots` + revenue panels; other courses simply don't, and the dashboard renders only what the course declares.
- `superRefine`: every `dimensionKey` referenced must exist in `trackedDimensions` (same cross-ref pattern as assessment config).
- Dashboard page: replace hardcoded sections with a panel-renderer switch over the config. Unknown/absent config → a sensible generic default (progress + assessment scores), never MI panels.

**Depends on:** Item 4 landing first is convenient (same files), not required.

## 6. Canvas integration (the big one)

### Two protocols, two jobs — use both

**LTI 1.3** (launch + identity + grade passback). The LMS-industry standard for embedding external tools. OIDC-based, all over HTTPS. Canvas launches OCI with a signed JWT asserting: who the user is, their role (instructor/student), and which Canvas course they came from. This is the front door: SSO, no account creation, per-course context. LTI's companion spec **AGS** (Assignment & Grade Services) handles writing scores back to the Canvas gradebook.

**Canvas REST API** (token over HTTPS). For everything launch doesn't give you: roster pulls, course metadata, creating assignment line items outside a launch. This is the plain "http protocol" connection you described — an access token in an `Authorization` header against `https://<canvas-instance>/api/v1/...`.

**Recommendation:** LTI 1.3 first — it solves login (Item 3), org resolution, and course mapping in one mechanism, and it's what makes OCI feel native inside Canvas rather than bolted on. REST API second, for grade sync robustness and roster features.

### Data model (course-agnostic — works for any LMS later, any tenant)

```
LmsIntegration        — one per org × LMS instance
  id, organizationId, provider ("canvas"), issuer, clientId,
  deploymentId, jwksUrl / keys, canvasBaseUrl, apiToken (encrypted)

LmsCourseLink         — the mapping that makes it course-agnostic
  id, lmsIntegrationId, lmsCourseId (Canvas course id),
  programId / curriculumCollectionKey   ← which OCI course it launches into

LmsUserLink
  id, lmsIntegrationId, lmsUserId (Canvas sub), socioId (or mentorId for
  instructors), role
```

Deployment-specific linkage lives in the DB (it's per-instance), **NOT** in the journey package (which is portable course content). The package can optionally declare grade-sync preferences:

```ts
meta.lms: z.object({
  gradeSync: z.object({
    enabled: z.boolean().default(false),
    scoreSource: z.enum(["assessment_gate"]).default("assessment_gate"),
    lineItemPer: z.enum(["lesson","course"]).default("lesson"),
  }).default({}),
}).optional()
```

### Launch flow (what actually happens)

1. Instructor installs OCI as an LTI tool in Canvas (one-time: client id, redirect URLs, JWKS — standard registration).
2. Student clicks the OCI assignment/link in Canvas.
3. Canvas → OIDC login initiation → OCI validates the launch JWT.
4. OCI looks up `LmsCourseLink` by the Canvas course id → resolves the OCI program + organization (**org resolution via the integration, not the fallback chain — a fourth, strongest tier**).
5. `LmsUserLink` lookup: existing → session issued, straight into `/chat` for that course. New → socio created automatically (name/email from the claim), linked, enrolled. Zero manual signup. **This is Item 3 solved.**
6. Instructor-role launches land on the mentor dashboard instead.

### Grade passback

On `completeAssessment` (the hook already exists and already writes MetricObservations): if the session's course has `gradeSync.enabled` and the socio has an `LmsUserLink`, post the gating-dimension score to the AGS line item for that lesson. Failure = log + retry queue, **never block completion**. The teach-back score becomes a real Canvas grade — which, for the BYU course, turns OCI from "external chatbot" into "graded course activity."

### Embedded presentation (iframe inside Canvas) — requirements

OCI displays embedded in Canvas's iframe (the default LTI placement). Three engineering requirements this adds, first one critical:

1. **Cookie strategy — the #1 LTI failure mode.** Session cookies inside a Canvas iframe are third-party cookies: Safari blocks them entirely, Chrome is deprecating them. A cookie-only session means "launch succeeds, student sees a login screen." Mitigations, layered:
   - `SameSite=None; Secure` on session cookies when the request is an embedded/LTI context (necessary, not sufficient).
   - **Token-carried session** for the embedded flow — pass a signed session token via query param / request rather than depending on the cookie. `ltijs`'s `ltik` token exists precisely for this; prefer it over hand-rolling.
   - **"Open in new window" fallback** button when cookie write fails (detect via a cookie-check round trip) — standard production LTI practice.
2. **`frame-ancestors` allowlist.** OCI must permit framing by Canvas and only Canvas: `Content-Security-Policy: frame-ancestors 'self' https://*.instructure.com https://<byu-canvas-domain>`. Verify no existing `X-Frame-Options: DENY` header (Vercel/Next config); do NOT allow framing from arbitrary origins.
3. **Frame-fit UI.** Canvas iframes are height-constrained; use the LTI `lti.frameResize` postMessage to request height, and sanity-check any full-viewport layout assumptions in `/chat` and the assessment page. In-frame navigation (gate card → assessment page → back) stays inside the iframe and needs no special handling.

### Phasing

- **Phase LTI-A:** `ltijs` (or equivalent) mounted in the Next.js app, tool registration against a Canvas test instance (BYU sandbox or canvas.instructure.com free tier), launch → identity → auto-provision → chat, rendering inside the Canvas iframe. Tables above. **Acceptance must include an embedded-launch test in Safari specifically** (the strictest cookie-blocking browser) — if it only works in Chrome, the cookie strategy isn't done. This phase alone solves the teacher's login pain.
- **Phase LTI-B:** grade passback via AGS on assessment completion, config-gated per course.
- **Phase LTI-C (as needed):** REST-API roster sync, deep-linking individual lessons as separate Canvas assignments.

### Open decisions (need answers before LTI-A is prompted)

1. What does the BYU course actually need first — students launching from Canvas (→ LTI-A) or just grades appearing in Canvas (→ could shortcut with REST-only, but you lose the login win)? **Recommend LTI-A regardless.**
2. Canvas test environment: does BYU IT give you a sandbox, or start on a free Canvas instance? (Registration needs admin access to some Canvas.)
3. Instructor launch → mentor dashboard mapping: is a Canvas "Teacher" an OCI mentor, a Course Lead, or both?

## 7. Enrollment guard — course selection can drift from the socio's anchored org

Captured **2026-08-02**, alongside the ParticipantProfile creation work.

`POST /api/auth/curriculum` now creates a `ParticipantProfile` at course selection — that profile is the tenancy anchor every org-scoped query filters on. The gap it leaves:

- `resolveOrgWithSource` tier 1 short-circuits on an existing profile, so **a socio's organization is fixed permanently at their first course selection**.
- `Socio.curriculumCollectionKey` stays mutable — re-selecting a course rewrites it freely.

So a socio can end up anchored to org A while their curriculum key points at org B's collection. They appear on org A's mentor dashboards while taking org B's course, and org B's mentors cannot see them at all. Silent, permanent, and decided by a course picker.

**Zero impact today** — one organization exists and both collections belong to it. This is recorded, not urgent.

**The fix is not re-resolving on course change** (that would let a course picker move a socio between tenants, which is worse). It is a guard: if the socio already has a `ParticipantProfile`, verify the selected collection belongs to that same org and reject the selection if it does not. Small, and it lives in `apps/web/src/app/api/auth/curriculum/route.ts` next to `anchorParticipantProfile`.

**Do it when either lands:**
1. A second organization — the moment the collision becomes reachable.
2. `LmsCourseLink` (§6). **This is the direct collision:** §6 step 4 resolves org through the LTI integration as "a fourth, strongest tier." A tier that outranks tier 1 meets a profile already anchored by a course picker, and the two will disagree. Whoever builds the fourth tier must decide which wins — settle it there rather than discovering it in production.

### 7a. Sub-note: the two socio-creation paths disagree on default language

Recording only, no code change.

| Path | Sets `language` | Result |
|---|---|---|
| `prismaRepo.createSocio` (`apps/web/src/lib/repo/prismaRepo.ts:248`) | explicitly `DEFAULT_LANGUAGE` (`i18n/languages.ts` = `'en'`) | English |
| `POST /api/auth/signup` (`signup/route.ts`) | not set — DB default applies (`schema.prisma` = `@default("es")`) | Spanish |

Invisible today because the web join flow's language picker `PATCH`es `/api/auth/me` and overwrites both before it matters.

It stops being invisible at **§6 step 5**: LTI auto-provision is a third socio-creation path, and it has no picker in the flow. Whoever builds it has to choose a language deliberately — from the LTI launch claim's locale, most likely — rather than rediscovering that the two existing paths disagree and inheriting whichever they happened to read first.
