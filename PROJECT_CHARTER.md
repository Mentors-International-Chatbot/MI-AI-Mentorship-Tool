# AI Mentoring Tool – Mentors International (100 Socio Pilot)

## 1. Project Overview
**One-Sentence Goal**: Design and pilot an AI-powered WhatsApp mentoring system that delivers Mentors International–aligned, personalized, 24/7 support to socios while reducing mentor workload and maintaining high socio satisfaction.

**Primary Users**:
- Socios (micro-entrepreneurs in Colombia)
- Regional mentors / managers at Mentors International

**Primary Interface**:
- WhatsApp (text only)

## 2. Success Definition
**Primary Success Metrics**:
- High socio satisfaction (qualitative feedback)
- Reduced mentor time per socio
- Mentor trust in AI-generated summaries and recommendations

**Secondary Signals**:
- Sustained socio engagement
- Clear red/green flags surfaced
- Smooth human intervention when needed

**Explicit Non-Goals (Pilot)**:
- Full analytics dashboard
- Bancolombia reporting
- Voice or multimedia
- Advanced financial diagnostics
- Predictive risk scoring

## 3. Core Assumptions
- Socios enter via Bancolombia with name + WhatsApp number
- WhatsApp number is the primary identity
- Internal MI Socio ID will be created
- Consent is explicitly confirmed in first AI interaction
- Spanish only
- Text only
- Self-reported business data is acceptable
- Human mentors remain available for escalation

## 4. Constraints & Guardrails
**Content Constraints (Hard Rules)**:
- AI must align with Mentors International curriculum
- No legal advice
- No tax advice
- No recommending loans
- No guessing when uncertain

**Behavioral Constraints**:
- Supportive, teacher-mentor tone
- Gentle guidance
- Simplified language
- Action-first responses
- Family- and context-aware

**Escalation Rules**:
- AI flags concerns but continues engagement
- Human mentors may inject into conversation
- AI announces live mentor handoff
- Mentors see summaries only, not raw transcripts

## 5. Pilot Scope
- **Size**: 100 socios
- **Duration**: 4–8 weeks of active interaction
- **Geography**: Colombia
- **Languages**: Spanish only

## 6. High-Level System Flow (Conceptual)
1. Socio signs up with Bancolombia
2. MI receives name + WhatsApp number
3. MI creates Socio ID
4. Socio receives WhatsApp onboarding message
5. AI confirms consent
6. AI learns socio context (business, challenges)
7. Ongoing AI mentorship over WhatsApp
8. Weekly AI summary generated
9. Mentor reviews summary in dashboard
10. Human mentor intervenes if needed

## 7. Phased Planning Roadmap
**(Please refer to task.md for active tracking of these phases)**

### Phase 0 – Alignment & Design
- Lock scope, language, tone, and boundaries
- Outputs: Agreed success metrics, AI behavior principles, Escalation philosophy, Non-goal list

### Phase 1 – Onboarding & Identity
- Ensure clean socio entry and consent
- Outputs: Onboarding flow, Consent confirmation script, Manual number transfer protocol

### Phase 2 – AI Mentorship Experience
- Define what the AI does and does not do
- Outputs: AI interaction principles, Example conversation flows, Inactivity check-in policy

### Phase 3 – Data & Metrics Collection
- Decide what data matters now
- Outputs: Weekly data capture plan, Self-report acceptance rules

### Phase 4 – Weekly Summary & Flagging
- Enable mentor oversight without overload
- Outputs: Weekly summary template, Flag definitions

### Phase 5 – Mentor Dashboard (Concept Only)
- Plan mentor interaction with AI outputs
- Outputs: Dashboard feature list, Mentor workflow map

### Phase 6 – Pilot Evaluation Plan
- Decide how success will be judged
- Outputs: Pilot evaluation rubric, Go / no-go criteria

## 9. Key Risks & Mitigations
- **Risk**: AI gives misaligned advice. **Mitigation**: Strict curriculum grounding + humility rules.
- **Risk**: Mentors don’t trust summaries. **Mitigation**: Keep summaries short, actionable, and conservative.
- **Risk**: Over-engineering too early. **Mitigation**: Pilot non-goals explicitly enforced.


New Plans

# Prompt-Layer Abstraction Spec (v1)

**Goal:** remove every MI-specific assumption from the conversational pipeline (prompt layers, onboarding, sentiment, check-ins) by moving it into course-scoped configuration. After this work, adding a course requires **zero code changes** — a course defines its identity, terminology, learner context, onboarding, and check-ins as data.

**Companion to:** `MI_Platform_Abstraction_Plan_v1.md` (this spec executes the "MI identity in prompt Layer 1–2 → config" and "onboarding steps → config" rows of its abstraction map, scoped to the conversational layer only).

**Feeds into:** the journey-package spec deliverable for Sam — every schema addition in §3 belongs in that spec as well.

---

## 1. Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| D1 | Config home | **All framing config lives in journey-package metadata** (one home, travels with the course). Schema is structured so an org-level `ProgramVersion.config` split can be layered on later without migration — see §7. |
| D2 | Participant noun | Default **"participant"**, configurable per course, localized per language. |
| D3 | Domain framing | **Generic by default** (no domain assumption, no intake question). Courses may opt in to a configurable `learnerContext` (MI: business; trade course: trade). Full course-lead-authored onboarding arrives with the Course Design System — this spec only reserves the shape. |
| D4 | Onboarding | Course-configurable step list `{ field, prompt, required }` per the abstraction plan. **Language selection stays universal/platform-level at login** — never a course step. |
| D5 | Sentiment | **Nothing hardcoded.** Generic emotion/confusion detection now; analyzer framing reads course metadata. Course-designer-selected tracked dimensions come later — config shape reserved now (aligns with existing `trackedDimensions` in the journey-package schema). |
| D6 | Scheduled reports | Generalized **optional scheduled check-ins** (any accountability report, any cadence). MI's financial check-in becomes the first configured instance. **Off by default.** |
| D7 | App branding | **Scoped out.** Login page, emails, admin chrome, page titles stay "Mentors International" for now — white-label work is a later phase. This spec touches only the conversational pipeline. |
| D8 | Localization | **English-first.** Every configurable string is a `LocalizedString` with `en` required, `es`/`pt` optional, fallback to `en`. MI supplies `es`. |

---

## 2. Hardcode inventory → config mapping

Every remaining conversational-layer hardcode from the audit grep, mapped to its config field and execution phase. (Bucket 2 — MI curriculum content in `lessons/data.ts` — is course *content*, not framing; untouched. Bucket 3 — app branding — scoped out per D7.)

| Hardcode | Location | Becomes | Phase |
|---|---|---|---|
| `CHATBOT_NAME: 'Martín'` | `config/service.ts:25` | `meta.identity.mentorName` (fallback only) | A *(done in mentor-name fix)* |
| "Mentors International" header | `chat/page.tsx` | `meta.identity.displayName` | A *(done)* |
| "Martín"/"MI" prose in DB core prompt | `core:mi-colombia-curriculum` row | injected from `identity` at build time | A *(done)* |
| "socio" as the learner noun in prompt prose | `context.ts`, `task.ts`, `summary/` | `meta.terminology.participant` | B |
| "Tipo de negocio", business personalization | `context.ts:34,47,62,71,83` | `meta.learnerContext` (absent → omit block) | B |
| "pregúntale... en qué consiste [su negocio]" | `task.ts:136` | `learnerContext.intakeQuestion` (absent → don't ask) | B |
| "adapta ejemplos al negocio del socio" | `task.ts:184`, `content.ts:46,123,128` | `learnerContext.personalizationInstruction` (absent → generic "adapt examples to the participant's interests/context") | B |
| Welcome messages ("Mentor Virtual de Mentors International… fortalecer tu negocio") | `i18n/languages.ts:40–213` | `meta.onboarding.welcome` + step prompts | C |
| Onboarding ask-name / ask-business sequence | `languages.ts`, handler state machine | `meta.onboarding.steps[]` | C |
| businessType/location extraction fields | `contextExtractor.ts:10,15` | `learnerContext.fields[]` (absent → skip extraction) | D |
| "micro-emprendedores colombianos" analyzer frame | `sentiment/analyzer.ts:13` | generic detector + `courseName`/`learnerContext.label` interpolation | D |
| "negocio no especificado" | `summary/generateSummary.ts:200` | terminology + learnerContext | D |
| Weekly financial report cron + prompt | `cron/financial-checkin/route.ts`, `task.ts:271` | `meta.scheduledCheckins[]`, gated off by default | E |
| Feedback prompt "útil… para tu negocio" | `handler.ts:197`, `languages.ts:194` | terminology-neutral template | C |

---

## 3. Schema additions (journey-package metadata)

Extends `journeyPackageSchema` in `apps/web/src/lib/journey-package/journey-package.schema.ts`. All new fields **optional** — existing packages (PBJ) validate unchanged and receive defaults.

```ts
// Shared primitive
const localizedString = z.object({
  en: z.string().min(1),          // required (D8)
  es: z.string().optional(),
  pt: z.string().optional(),
});
// Resolution: requested language → en. Never empty.

const identitySchema = z.object({
  mentorName: z.string().default('Tutor'),
  displayName: z.string().optional(),   // header label; default = course title
});

const terminologySchema = z.object({
  participant: localizedString.default({ en: 'participant' }),
  // singular only in v1; add plural/possessive forms if prompt templates need them
});

const learnerContextSchema = z.object({
  label: localizedString,                       // "your business" / "your trade"
  intakeQuestion: localizedString,              // asked once, early
  personalizationInstruction: localizedString,  // Layer-3 instruction text
  fields: z.array(z.object({
    key: z.string(),                            // e.g. "businessType"
    extractionHint: z.string(),                 // for contextExtractor
  })).default([]),
}).optional();                                  // ABSENT = generic mode (D3)

const onboardingStepSchema = z.object({
  id: z.string(),
  field: z.string(),                            // socio/profile field it fills
  prompt: localizedString,
  required: z.boolean().default(false),
});

const onboardingSchema = z.object({
  welcome: localizedString.optional(),          // default = generic welcome template
  steps: z.array(onboardingStepSchema).default([]),
  // Language selection is NOT a step (D4) — platform handles it before onboarding.
});

const scheduledCheckinSchema = z.object({
  id: z.string(),
  cadence: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
  prompt: localizedString,
  captureMarker: z.string().optional(),         // e.g. 'FINANCIAL' for MI; parsed like existing markers
  enabled: z.boolean().default(false),          // D6: off unless the course turns it on
});

// meta additions:
//   identity: identitySchema.default({})
//   terminology: terminologySchema.default({})
//   learnerContext: learnerContextSchema        (optional)
//   onboarding: onboardingSchema.default({})
//   scheduledCheckins: z.array(scheduledCheckinSchema).default([])
// trackedDimensions: already exists — D5's future per-course dimension mentoring
// binds here; no schema change needed now, sentiment framing reads identity +
// learnerContext.label.
```

**Defaults live in one file** (`src/lib/courses/defaults.ts`): the neutral English values used when a course omits a field. No default may contain MI content. Resolution order everywhere: course value → platform default. Language: requested → `en`.

### MI's configuration under this schema (illustrative)

```ts
identity: { mentorName: 'Martín', displayName: 'Mentors International' },
terminology: { participant: { en: 'partner', es: 'socio' } },
learnerContext: {
  label: { en: 'your business', es: 'tu negocio' },
  intakeQuestion: { en: 'What kind of business do you run?', es: '¿Qué tipo de negocio tienes?' },
  personalizationInstruction: { en: 'Adapt examples to the participant's business…', es: 'Adapta los ejemplos al negocio del socio…' },
  fields: [{ key: 'businessType', extractionHint: 'type of business, e.g. clothing shop' },
           { key: 'location', extractionHint: 'business location' }],
},
onboarding: { steps: [
  { id: 'name', field: 'name', prompt: { en: "What's your name?", es: '¿Cómo te llamas?' }, required: true },
  { id: 'business', field: 'businessDescription', prompt: { en: 'Tell me about your business.', es: 'Cuéntame de tu negocio.' }, required: false },
]},
scheduledCheckins: [{ id: 'financial-weekly', cadence: 'weekly',
  prompt: { en: 'Time for your weekly business report…', es: 'Es momento de tu reporte semanal…' },
  captureMarker: 'FINANCIAL', enabled: true }],
```

PBJ sets **none of this** beyond identity — and gets a generic English tutor with no intake question, no check-ins, participant-neutral language. That is the acceptance picture for D3.

---

## 4. Consumption map (who reads what)

| Config field | Consumers |
|---|---|
| `identity.mentorName` | `core.ts` name injection · chat header (via `/api/progress`) |
| `identity.displayName` | chat header · lesson header context |
| `terminology.participant` | `context.ts`, `task.ts`, `summary/`, feedback prompts — all "socio" prose |
| `learnerContext.*` | `context.ts` (context block), `task.ts:136` (intake), `task.ts/content.ts` (personalization), `contextExtractor.ts` (fields), `summary/` |
| `onboarding.welcome/steps` | handler onboarding state machine · `languages.ts` welcome path (replaced) |
| `scheduledCheckins` | new generic check-in cron (replaces `financial-checkin` route) · `task.ts` check-in prompt builder |
| sentiment framing | `sentiment/analyzer.ts` — generic detector prompt interpolating `courseName` + `learnerContext.label` (or "the course" when absent) |

`CourseMeta` (`src/lib/courses/course-meta.ts`) is the **single loader** — it resolves metadata + defaults + language once and is the only import path for consumers. No consumer touches raw journey-package JSON.

---

## 5. Execution phases

Each phase = one Cursor prompt, one commit, independently verifiable. Order is dependency-driven; B–D can't start before A′ lands the schema + loader.

**Phase A′ — Schema + loader (foundation).** Add §3 schemas to `journeyPackageSchema` (all optional). Create `defaults.ts`. Extend `CourseMeta` + loader with full resolution (course → default, language → en). Write MI's config values into MI's package/seed. *Exit:* `tsc` clean; PBJ package validates untouched; `getCourseMeta('mi-colombia-curriculum')` returns Martín/socio/negocio values; `getCourseMeta('pbj-basics')` returns pure defaults.

**Phase B — Prompt layers (Layers 2–4).** `context.ts`, `task.ts`, `content.ts`: replace every "socio"/"negocio" framing string with `terminology` / `learnerContext` reads. When `learnerContext` is absent: omit the business-context block, skip the intake question, use the generic personalization line. *Exit:* fresh PBJ socio is never asked about a business anywhere in a full lesson run; MI socio experience is byte-for-byte equivalent to today.

**Phase C — Onboarding + welcome.** Handler's onboarding state machine iterates `onboarding.steps` instead of the hardcoded name→business sequence; welcome text from `onboarding.welcome` (default template when unset); feedback prompt de-MI'd. `languages.ts` retains only platform chrome (headers, buttons, errors) — zero course framing. *Exit:* PBJ onboarding = name only (or nothing, per its config); MI onboarding unchanged; grep for "Mentors International|negocio" in `languages.ts` returns only entries scheduled for deletion.

**Phase D — Sentiment + extraction + summaries.** Analyzer prompt generic + interpolated. `contextExtractor` driven by `learnerContext.fields` (skip when empty). `generateSummary` terminology-neutral. *Exit:* no hardcoded audience in analyzer; PBJ runs no business extraction; summaries never say "negocio" for non-MI.

**Phase E — Scheduled check-ins.** Generic cron reads `scheduledCheckins` across courses; MI's financial check-in becomes config (`enabled: true`, `captureMarker: 'FINANCIAL'`); old route retired. *Exit:* PBJ receives no check-ins; MI's weekly financial report fires exactly as today, from config.

**Final acceptance (the D5 priority):**
```
grep -rn "Mentors International|Mentores|Martín|negocio|micro-emprended|socio" \
  src/lib/ai/ src/lib/sentiment/ src/lib/messaging/ src/lib/summary/ src/lib/i18n/ \
  --include="*.ts"
```
returns **zero** hits outside test fixtures and Bucket-2 curriculum content. That grep is the definition of done.

---

## 6. Non-goals (explicit)

App branding — login, emails, admin/dashboard chrome, page `<title>` (D7). Course Design System authoring UI (D3 — this spec makes the config *exist*; authoring it visually comes later). Per-course tracked-dimension selection UI (D5 — shape reserved, no UI). New languages beyond es/en/pt. Bucket-2 curriculum content migration (already covered by abstraction-plan Phase 3).

## 7. Future hooks (designed-for, not built)

**Org-level config split (D1-b):** when `ProgramVersion.config` needs to own terminology/tone org-wide, resolution becomes course → org → platform default — a one-line change in the `CourseMeta` loader, no schema migration, because all reads already flow through the loader.
**Course-authored onboarding (D3/D4):** the Course Design System writes `onboarding.steps` through a UI; the runtime engine built in Phase C requires no changes.
**Per-course mentoring dimensions (D5):** course designer selects `trackedDimensions`; sensing layer already consumes per-course dimensions — the selection UI binds to the existing field.
**Check-in marker types (D6):** new `captureMarker` values register alongside existing marker parsing; adding a marker type is a parser entry, not a pipeline change.

## 8. Risks

MI regression is the main one — MI's behavior must be reproduced from config byte-for-byte, so Phases B/C/E each carry an explicit "MI unchanged" verification, and the seed keeps upsert semantics so config fixes redeploy by re-running the seed. Second risk: partial migration (some consumers on `CourseMeta`, some on old constants) recreating the two-sources-of-truth bug this spec exists to kill — mitigated by deleting each hardcode *in the same commit* that adds its config read, never leaving both paths alive.