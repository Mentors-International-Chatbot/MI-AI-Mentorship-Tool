# Multi-Channel Delivery Architecture — v1

One backend engine, multiple delivery surfaces. WhatsApp, Web, and Canvas are adapters over a single headless engine that owns auth, data, AI, and configuration. Courses declare which channels they support and how they behave on each. Nothing channel-specific leaks into the engine; nothing engine-specific leaks into an adapter.

**Companion docs:** `MI_Platform_Abstraction_Plan_v1.md` (tenancy), `Prompt_Layer_Abstraction_Spec_v1.md` (per-course prompts), `Platform_Backlog_Canvas_Plan_v1.md` (Canvas/LTI specifics, dashboard config).

## 1. What already conforms (don't rebuild)

- **Single engine entry:** WhatsApp webhook and web `/api/chat` both call the same `handleMessage` pipeline. Canvas (LTI-launched web) reuses the web path entirely — the chat UI inside the iframe hits the same routes.
- **Channel identity:** `socios.channelType`, and `assessment_sessions.channel` stamps the condition every score was earned under.
- **Channel-aware behavior exists:** gated assessments degrade to inline on WhatsApp; the capability difference is already handled in one place.
- **Config-driven engine:** journey packages drive lessons, assessment rules, calibration, tracked dimensions. Prompts are DB-backed (`system_prompts`) with the per-course abstraction spec'd in Prompt_Layer_Abstraction.

What's missing is not machinery — it's named seams: a capability model, a course↔channel compatibility declaration, and one identity layer with three credential sources.

## 2. Layered architecture

```
┌────────────────────────────────────────────────────────────┐
│  DELIVERY ADAPTERS                                          │
│  WhatsApp (webhook)  │  Web (browser)  │  Canvas (LTI/iframe)│
│  identity: phone     │  identity: JWT   │  identity: LTI      │
│                      │  cookie login    │  launch token       │
├────────────────────────────────────────────────────────────┤
│  IDENTITY & AUTH LAYER (one resolver, three credential srcs)│
│  → Socio / Mentor + TenantContext                           │
├────────────────────────────────────────────────────────────┤
│  ENGINE (channel-agnostic)                                  │
│  router · prompt builder (4-layer) · sensing · assessment   │
│  engine · alerts · summaries · progression                  │
├────────────────────────────────────────────────────────────┤
│  CONFIGURATION (journey package + org config)               │
│  lessons · prompts · dimensions · calibration · dashboard   │
│  panels · delivery declarations (new, §4)                   │
├────────────────────────────────────────────────────────────┤
│  DATA (Prisma / Neon, org-tagged, tenant-scoped repo)       │
└────────────────────────────────────────────────────────────┘
```

Rules that keep it clean:

- The engine **never** branches on `channelType` directly. Adapters translate channel reality into **capabilities** (§3); the engine branches on capabilities. (The existing WhatsApp assessment degradation should migrate to this form when touched next — it's the one place channel logic lives today.)
- Auth is **ONE** middleware with three accepted credential sources — cookie JWT, LTI token (ltik-style), WhatsApp sender verification — all resolving to the same identity + TenantContext. Never three parallel auth systems.
- Adapters own **presentation only:** message formatting, buttons/cards vs plain text, iframe sizing. Zero business logic.

## 3. Channel capability model

A small typed object each adapter provides; the engine consumes it.

| Capability | WhatsApp | Web | Canvas (embedded web) |
|---|---|---|---|
| `separateThreads` | ✗ | ✓ | ✓ (inside iframe) |
| `richCards` / metadata | ✗ (text + ≤3 reply buttons) | ✓ | ✓ |
| `navigation` (pages) | ✗ | ✓ | ✓ (in-frame) |
| `mediaEmbed` | limited | ✓ | ✓ |
| `sessionPersistence` | implicit (phone) | cookie | token (3rd-party cookie constraints) |
| `gradePassback` | ✗ | ✗ | ✓ (AGS) |
| `pushInitiation` (cron nudges) | ✓ | ✗ (needs email/none) | ✗ (Canvas notifications later) |

Engine behaviors keyed to capabilities, not channels:

- `separateThreads=false` → assessment runs inline (existing behavior, reframed)
- `richCards=false` → gate renders as text + reply button
- `gradePassback=true` → `completeAssessment` syncs score (config-gated)
- `pushInitiation=false` → scheduled check-ins deliver on next visit instead

## 4. Course ↔ channel compatibility (journey package addition)

Courses declare where they can run and how they adapt. All optional; defaults preserve current behavior.

```ts
meta.delivery: z.object({
  supportedChannels: z.array(z.enum(["whatsapp","web","canvas"]))
    .default(["web"]),
  perChannel: z.record(z.enum(["whatsapp","web","canvas"]), z.object({
    // narrow, additive overrides — e.g. WhatsApp-specific pacing or a
    // shorter welcome; NOT a fork of the course
    conciseness: z.enum(["very_brief","brief","standard"]).optional(),
    disabledBlockTypes: z.array(z.string()).optional(), // e.g. media-heavy
  })).optional(),
}).optional()
```

- **Import-time validation:** a course whose blocks require a capability a declared channel lacks → warning (degradation defined) or error (no defined degradation). E.g., interactive/quiz segments (future) on WhatsApp.
- **Enrollment/launch guard:** a socio can only enter a course via a channel the course supports. MI declares `["whatsapp","web"]`; BYU declares `["web","canvas"]`; PB&J everything.

## 5. Per-course AI prompts

Already spec'd — `Prompt_Layer_Abstraction_Spec_v1.md` is the plan of record (identity, terminology, learnerContext, onboarding, per-course language). This doc adds only: the prompt layer receives the capability set so formatting rules (e.g., "no markdown — WhatsApp doesn't render it") come from the channel adapter's declaration, not hardcoded prose in the core prompt. Trace which prompt ran via the AiInvocation logging (backlog item 2).

## 6. Dashboards: two placements, one rule

The split: **Canvas embed = monitoring (read). OCI standalone = configuration (read + write).**

| Concern | Canvas-embedded dashboard | OCI standalone dashboard |
|---|---|---|
| Student progress / lesson status | ✓ | ✓ |
| Dimension trends, assessment scores (per-course panels) | ✓ | ✓ |
| Alerts / flags needing attention | ✓ | ✓ |
| Journey package / course config editing | ✗ | ✓ |
| Prompt & AI behavior configuration | ✗ | ✓ |
| Dashboard panel configuration | ✗ | ✓ |
| Cross-course / cross-cohort org views | ✗ (course-scoped by launch) | ✓ |

- The embedded dashboard is the **same React dashboard**, course-scoped by the LTI launch context, rendered in the iframe (`frame-ancestors` + token-auth constraints per the Canvas plan). Instructor launches land here.
- Panels are per-course config (`meta.dashboard.panels`, backlog item 5) in BOTH placements — one panel renderer, two shells.
- Both placements respect the viewer's language (`preferredLanguage`, backlog item 4).

## 7. Ownership split: Canvas People vs OCI web (proposed resolution)

**Principle:** Canvas owns WHO (for Canvas-delivered courses); OCI owns WHAT and HOW — always.

| Domain | Owner | Mechanism |
|---|---|---|
| Enrollment / roster / sections (Canvas courses) | Canvas | People in Canvas; LTI launch auto-provisions; optional REST roster sync fills gaps |
| Identity for Canvas users | Canvas | LTI launch claims → LmsUserLink → Socio/Mentor |
| Identity for WhatsApp / direct-web users | OCI | existing signup/phone flows; enrollment via join codes (future EnrollmentInvitation) |
| Grades (Canvas courses) | Canvas gradebook, fed by OCI | AGS passback on assessment completion |
| Course content (journey packages) | OCI | authored/imported in OCI; Canvas only launches into it |
| AI/prompt/assessment/dimension configuration | OCI | course-lead tools on OCI web |
| Detailed analytics & telemetry | OCI | `metric_observations`; Canvas embed shows the course-scoped summary |

Consequences worth naming:

- A Canvas-linked course should **disable OCI-side self-signup for that course** (enrollment source of truth is Canvas) — config flag on LmsCourseLink, not global.
- **De-enrollment:** Canvas removal should deactivate the link, not delete the socio (their history/telemetry persists for the org).
- The same course CAN run on Canvas for BYU and direct-web for another org — the link table is per-org-per-instance, the package is portable. This is the course-agnostic property holding.

## 8. Open decisions

1. Canvas Teacher role → OCI mentor (monitoring) vs Course Lead (config authority)? **Proposal:** Teacher→mentor by default; Course Lead assignment is an explicit OCI-side grant. (Config authority shouldn't be implied by an LMS role.)
2. Does WhatsApp need scheduled-nudge parity for Canvas courses (email? Canvas notifications API?) or is pull-only acceptable for BYU? **Proposal:** pull-only for v1.
3. Roster sync depth: launch-time auto-provision only (lazy) vs REST bulk sync (eager)? **Proposal:** lazy for LTI-A; eager only if instructors need to see not-yet-launched students on the dashboard.
4. Where does the WhatsApp adapter's phone-number→course mapping live once multiple courses exist on WhatsApp? (Today: `curriculum_collection_key` on the socio. Fine until one phone number serves two courses.)

## 9. Sequencing (relative to existing backlog)

Nothing here is a new project — it re-frames planned work:

1. **Capability model** — introduce the typed capability object when the next channel-branching change happens (likely LTI-A); migrate the existing WhatsApp assessment degradation to it opportunistically.
2. **`meta.delivery` schema** — add alongside the next journey-package schema change (small, additive).
3. **Dashboard panels + i18n** (backlog items 4/5) — build the panel renderer once, both shells use it.
4. **LTI-A** delivers the Canvas adapter + identity source; the embedded dashboard shell follows as LTI-B/C work.
5. Update `Platform_Architecture_Briefing.docx` for Brad with §2's diagram and §7's ownership table — this is the multi-tenancy + delivery story in one page, and it supersedes the RLS-era framing.
