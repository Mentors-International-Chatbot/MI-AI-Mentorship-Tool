# Decoupled Sensing/Steering — Implementation Plan

## Root cause
`router.ts` (`determineMode`) currently makes one classification decision per
message and locks the entire reply into that mode. Reteach vs. advance is
decided from a single last-message score check (`RETEACH_THRESHOLD`), with no
persisted signal about how the student is trending across turns. This means:
(a) a misclassified turn has no correction mechanism, and (b) the AI can't
blend "reteach a little + still advance" the way a real tutor does.

This plan adds a fast, structured **sensing** pass that runs every turn and
persists continuous per-dimension state, then has prompt assembly read that
state directly instead of relying only on a single mode label. The existing
curriculum-position state machine (`LESSON_START`/`LESSON_DELIVERY`/
`FREEFORM_QUESTION` progression) is NOT replaced — it still decides *where*
in the lesson sequence the student is. What changes is *how the reteach
decision is made* and *what context Layer 3 gets*.

## What NOT to build (yet)
- No `TrackedDimension` config table — hardcode a small `DIMENSION_DEFINITIONS`
  constant (2 dimensions to start: comprehension, confusion). Config-driven
  dimensions come later once the abstraction plan's `ProgramVersion` schema
  lands.
- No Redis/cache layer yet — read/write `SocioDimensionState` via Prisma
  directly. Flag as a follow-up once message volume matters.
- No Bayesian Knowledge Tracing math yet — start with a simpler exponential
  moving average for the numeric update. BKT is a clean upgrade later; don't
  block this plan on it.

---

## Step 1 — Schema: `SocioDimensionState`

**File:** `apps/web/prisma/schema.prisma`

Add:

```prisma
model SocioDimensionState {
  id            String   @id @default(cuid())
  socioId       String
  socio         Socio    @relation(fields: [socioId], references: [id])
  dimensionKey  String   // "comprehension" | "confusion" (matches DIMENSION_DEFINITIONS)
  level         Float    // 0-10, continuous
  trend         String   // "improving" | "flat" | "declining"
  confidence    Float    // 0-1, sensing model's certainty
  evidence      String?  // short excerpt/summary backing this update
  updatedAt     DateTime @updatedAt

  @@unique([socioId, dimensionKey])
}
```

Add the inverse relation on `Socio`. Run `npx prisma migrate dev --name add_dimension_state`.

## Step 2 — Constants: dimension definitions

**File:** `apps/web/src/lib/ai/prompts/constants.ts`

Add:

```typescript
export const DIMENSION_DEFINITIONS = [
  { key: 'comprehension', label: 'Comprehension', category: 'comprehension' as const },
  { key: 'confusion', label: 'Confusion', category: 'emotional' as const },
] as const;

export const RETEACH_LEVEL_THRESHOLD = 4;   // comprehension below this → reteach candidate
export const CONFUSION_ESCALATE_THRESHOLD = 7; // confusion above this → flag for supervisor
```

Keep `RETEACH_THRESHOLD` (the existing per-message score constant) as a fallback
input, not a replacement — see Step 5.

## Step 3 — Sensing pass (new file)

**File:** `apps/web/src/lib/ai/sensing/senseDimensions.ts` (new directory)

```typescript
import { DIMENSION_DEFINITIONS } from '@/lib/ai/prompts/constants';

interface SensedDimension {
  dimensionKey: string;
  level: number;       // 0-10
  confidence: number;  // 0-1
  evidence: string;    // ≤15 words, short excerpt/justification
}

export async function senseDimensions(params: {
  incomingText: string;
  priorState: Record<string, { level: number; trend: string }>;
  lessonContext: string; // short summary of current lesson topic
}): Promise<SensedDimension[]> {
  // Fast, structured-output-only call. Use a smaller/cheaper model than
  // the one generating the reply — this call never writes prose.
  // Prompt: given the message + prior levels + lesson context, output
  // ONLY a JSON array matching SensedDimension[] for each key in
  // DIMENSION_DEFINITIONS. No conversational text.
  // Implementation: reuse existing LangChain client setup from
  // apps/web/src/lib/ai/service.ts, but a separate lightweight invoke
  // with response_format constrained to JSON.
}
```

Root-cause note for whoever implements this call: it must NOT share a prompt
with `buildSystemPrompt` — it needs its own minimal system prompt describing
just the dimension schema and asking for JSON only. Mixing it into the main
4-layer prompt reintroduces the exact coupling this plan removes.

## Step 4 — Numeric update (pure math, no LLM)

**File:** `apps/web/src/lib/ai/sensing/updateDimensionState.ts` (new)

```typescript
import { prisma } from '@/lib/prisma'; // adjust to existing db client import

const SMOOTHING = 0.3; // weight on new observation vs. prior level

export async function updateDimensionState(
  socioId: string,
  sensed: { dimensionKey: string; level: number; confidence: number; evidence: string }[],
) {
  for (const s of sensed) {
    const prior = await prisma.socioDimensionState.findUnique({
      where: { socioId_dimensionKey: { socioId, dimensionKey: s.dimensionKey } },
    });

    const newLevel = prior
      ? prior.level + SMOOTHING * (s.level - prior.level)
      : s.level;

    const trend = !prior ? 'flat'
      : newLevel > prior.level + 0.3 ? 'improving'
      : newLevel < prior.level - 0.3 ? 'declining'
      : 'flat';

    // Upsert — never skip-if-exists, this must update every turn
    await prisma.socioDimensionState.upsert({
      where: { socioId_dimensionKey: { socioId, dimensionKey: s.dimensionKey } },
      create: { socioId, dimensionKey: s.dimensionKey, level: newLevel, trend, confidence: s.confidence, evidence: s.evidence },
      update: { level: newLevel, trend, confidence: s.confidence, evidence: s.evidence },
    });
  }
}
```

## Step 5 — Wire into the service pipeline

**File:** `apps/web/src/lib/ai/service.ts`

Before the existing `determineMode` call, add:

```typescript
const priorState = await getDimensionStateMap(socio.id); // new repo helper, keyed by dimensionKey
const sensed = await senseDimensions({ incomingText, priorState, lessonContext: /* current lesson title */ });
await updateDimensionState(socio.id, sensed);
const liveState = await getDimensionStateMap(socio.id); // re-read post-update
```

Pass `liveState` alongside the existing `routerResult` into `buildSystemPrompt`.
This is additive — `determineMode` still runs and still decides
`LESSON_START`/`LESSON_DELIVERY`/`FREEFORM_QUESTION` from curriculum position.
What changes is the RETEACH decision in `router.ts`:

**File:** `apps/web/src/lib/ai/prompts/router.ts`

Change the RETEACH branch from a single-message score check to also consult
`liveState.comprehension.level < RETEACH_LEVEL_THRESHOLD`. Keep the existing
score-based check as an OR condition — don't remove it, this is a fallback
for when sensing confidence is low. Document this clearly as two signals
feeding one decision, not a replacement.

## Step 6 — Feed continuous state into Layer 3

**File:** `apps/web/src/lib/ai/prompts/layers/task.ts`

Add `dimensionState` as a parameter to `buildTaskPrompt`. When present, append
a short block to the task prompt text: e.g. "Student's current comprehension:
4/10, trending down. Confusion: 6/10. Blend a brief reteach into your next
response rather than only advancing or only reteaching." This is the actual
mechanism that lets the model write one blended reply instead of a hard
mode-locked one — the model is told the *numbers*, not just a bucket.

## Step 7 — Test endpoint support

**File:** `apps/web/src/app/api/test-ai/route.ts`

Extend the existing optional-fields body to accept:
```typescript
dimensionState?: { comprehension?: number; confusion?: number };
```
When provided, skip the sensing call entirely and construct `liveState`
directly from the supplied values — mirrors the existing `mode` override
pattern already in this file. Lets you test reteach-blending behavior without
needing several real turns to build up state.

## Build order
1. Steps 1–2 (schema + constants) — no behavior change, safe to land alone
2. Step 3–4 (sensing + update, unwired) — testable in isolation via a script
3. Step 7 (test endpoint) — lets you validate Steps 3–4
4. Steps 5–6 (wire into pipeline + Layer 3) — full integration
5. Test with real conversations, adjust thresholds based on results

## Benefits of this approach
- **Continuous feedback loop:** Every turn updates dimension state, building a richer picture of the student over time
- **Blended responses:** AI can mix reteach + advance instead of hard mode switches
- **Evidence-based:** Each dimension update includes evidence excerpt for debugging/transparency
- **Graceful degradation:** Falls back to existing score-based logic when sensing confidence is low
- **Testable in isolation:** Each step can be validated independently before full integration

## Future enhancements (not in this plan)
- Bayesian Knowledge Tracing for more sophisticated updates
- Config-driven dimension definitions (via ProgramVersion schema)
- Redis/cache layer for high-volume deployments
- Additional dimensions (motivation, engagement, mastery)
- Dimension trend visualization in mentor dashboard
