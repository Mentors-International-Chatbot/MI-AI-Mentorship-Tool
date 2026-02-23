---
name: Lesson Delivery Pipeline
overview: Wire the existing 4-layer prompt system to actually teach lessons by creating structured lesson data (JSON), adding progress tracking to the database, and updating the router/webhook to deliver curriculum instead of defaulting to freeform Q&A.
todos:
  - id: lessons-json
    content: Create src/lib/lessons/data.ts with LessonData type and structured JSON for lessons 1-5 (from mentors_manual_key_points.txt)
    status: pending
  - id: prisma-progress
    content: Add SocioProgress model to Prisma schema, run migration, update Socio relation
    status: pending
  - id: repo-progress
    content: Add SocioProgress type and 4 repo methods (getSocioProgress, advanceMessage, completeLesson, initProgress) to types.ts and prismaRepo.ts
    status: pending
  - id: onboarding-init
    content: Call repo.initProgress(socio.id) in onboarding service when socio becomes ACTIVE
    status: pending
  - id: router-update
    content: Update router to read real progress, load lesson data, and return LESSON_START/LESSON_DELIVERY/FREEFORM with populated LessonDeliveryState
    status: pending
  - id: service-update
    content: Update AI service to pass incomingText to router and progress to builder
    status: pending
  - id: webhook-markers
    content: Update webhook to call completeLesson on [LESSON_COMPLETE] markers and advanceMessage after lesson delivery responses
    status: pending
isProject: false
---

# Lesson Delivery Pipeline

## Current State

The 4-layer prompt system is fully built but inert. The router in [prompts/router.ts](apps/web/src/lib/ai/prompts/router.ts) always returns `FREEFORM_QUESTION` because nothing provides `SocioProgress` data. The `LESSON_DELIVERY`, `LESSON_START`, and `RETEACH` task prompts in [prompts/layers/task.ts](apps/web/src/lib/ai/prompts/layers/task.ts) are dead code.

```mermaid
flowchart LR
    subgraph today [Today]
        msg[Message In] --> router[Router]
        router -->|"always FREEFORM"| builder[Prompt Builder]
        builder --> ai[Claude Haiku]
    end
    subgraph target [Target]
        msg2[Message In] --> router2[Router]
        router2 -->|"reads progress"| mode{Mode?}
        mode -->|LESSON_START| builder2[Prompt Builder]
        mode -->|LESSON_DELIVERY| builder2
        mode -->|FREEFORM| builder2
        builder2 -->|"lesson JSON injected"| ai2[Claude Haiku]
        ai2 -->|"[LESSON_COMPLETE:1]"| markers[Marker Parser]
        markers -->|"advance progress"| db[(SocioProgress)]
    end
```



## Step 1: Structure Lessons 1-5 into JSON

Create [src/lib/lessons/data.ts](apps/web/src/lib/lessons/data.ts) with a `LessonData` type and hardcoded JSON for lessons 1-5. The raw curriculum is in [data/curriculum/mentors_manual_key_points.txt](apps/web/data/curriculum/mentors_manual_key_points.txt) -- each lesson already has clearly marked REFLECTION, KEY CONCEPTS, EXERCISE, and COMMITMENT sections.

**Type definition:**

```typescript
export interface LessonMessage {
  order: number;
  type: 'escenario' | 'explicación' | 'ejemplo' | 'pregunta';
  contentEs: string;
}

export interface LessonData {
  lessonNumber: number;
  titleEs: string;
  category: string;
  keyConcepts: string[];
  selfCheckQuestions: string[];
  exercise: string;
  commitment: string;
  messages: LessonMessage[];
}
```

**Message breakdown per lesson** (4 messages each, matching the Layer 3 `messageType` field):

- Message 1 (`escenario`): Hook the socio with a relatable everyday scenario
- Message 2 (`explicación`): Teach the key concepts from the curriculum
- Message 3 (`ejemplo`): Walk through the exercise with a concrete example
- Message 4 (`pregunta`): Ask them to apply it + state the commitment

**Exported functions:**

- `getLessonData(lessonNumber: number): LessonData` -- returns the lesson or throws
- `getLessonTitle(lessonNumber: number): string` -- used by the context layer (replaces the current `LESSON_TITLES` record in [layers/context.ts](apps/web/src/lib/ai/prompts/layers/context.ts))

The content for each message should be 2-3 sentences in Colombian Spanish -- enough to guide the AI but short enough that the AI adapts it naturally to the socio's context.

**5 lessons to structure:**

- Lesson 1: Registros Financieros (Financial Records)
- Lesson 2: Entidades Separadas (Separate Entities)
- Lesson 3: Presupuesto del Negocio (Business Budget)
- Lesson 4: Ahorro (Saving)
- Lesson 5: Punto de Equilibrio (Break-Even Point)

## Step 2: Add SocioProgress to the Database

**New Prisma model** in [schema.prisma](apps/web/prisma/schema.prisma):

```prisma
model SocioProgress {
  id                    String   @id @default(uuid())
  socioId               String   @unique @map("socio_id")
  currentLessonNumber   Int      @default(1) @map("current_lesson_number")
  currentMessageIndex   Int      @default(0) @map("current_message_index")
  completedLessons      Int[]    @default([]) @map("completed_lessons")
  weeklyUnderstanding   Int?     @map("weekly_understanding")
  weeklyImplementation  Int?     @map("weekly_implementation")
  lastLessonCompletedAt DateTime? @map("last_lesson_completed_at")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  socio Socio @relation(fields: [socioId], references: [id])

  @@map("socio_progress")
}
```

Add the reverse relation on `Socio`: `progress SocioProgress?`

**New repo types** in [repo/types.ts](apps/web/src/lib/repo/types.ts):

```typescript
export type SocioProgress = {
  id: string;
  socioId: string;
  currentLessonNumber: number;
  currentMessageIndex: number;
  completedLessons: number[];
  weeklyUnderstanding: number | null;
  weeklyImplementation: number | null;
  lastLessonCompletedAt: Date | null;
};
```

**New repo methods** (added to the `Repo` interface and [prismaRepo.ts](apps/web/src/lib/repo/prismaRepo.ts)):

- `getSocioProgress(socioId: string): Promise<SocioProgress>` -- returns progress, creates default if none exists
- `advanceMessage(socioId: string): Promise<SocioProgress>` -- increments `currentMessageIndex` by 1
- `completeLesson(socioId: string, lessonNumber: number, scores: { understanding?: number; implementation?: number }): Promise<SocioProgress>` -- adds lesson to `completedLessons`, increments `currentLessonNumber`, resets `currentMessageIndex` to 0, saves scores, sets `lastLessonCompletedAt`
- `initProgress(socioId: string): Promise<SocioProgress>` -- creates the initial progress record (called during onboarding)

**Migration:** Run `npx prisma migrate dev --name add_socio_progress`

**Update onboarding:** In [onboarding/service.ts](apps/web/src/lib/onboarding/service.ts), when a socio transitions to `ACTIVE`, call `repo.initProgress(socio.id)` to create their progress record.

## Step 3: Wire Lesson Delivery into the Webhook

Three files change:

### 3a. Update the Router ([prompts/router.ts](apps/web/src/lib/ai/prompts/router.ts))

The router currently ignores progress. Change `determineMode` to:

1. Accept the incoming message text as a second parameter
2. Call `repo.getSocioProgress(socio.id)` to get real progress
3. Load the lesson data via `getLessonData(progress.currentLessonNumber)`
4. Apply this priority logic:

```
if progress.currentMessageIndex > 0 AND < lesson.messages.length:
  → LESSON_DELIVERY (mid-lesson)
  Special case: if on last message and user sent a score <= 3 → RETEACH

if progress.currentMessageIndex == 0 AND currentLessonNumber <= 5:
  → LESSON_START (ready for next lesson)

else:
  → FREEFORM_QUESTION
```

1. When returning `LESSON_START` or `LESSON_DELIVERY`, populate the `RouterResult.lesson` field with a full `LessonDeliveryState` built from the JSON data -- this is what the builder and content layer consume

### 3b. Update the AI Service ([ai/service.ts](apps/web/src/lib/ai/service.ts))

- Pass `incomingText` to `determineMode` so the router can parse scores
- Pass the `SocioProgress` from the router result to `buildSystemPrompt` so Layer 2 (context) and Layer 4 (content) get real data

### 3c. Update the Webhook ([webhook/meta/route.ts](apps/web/src/app/api/webhook/meta/route.ts))

When the marker parser finds `lessonsCompleted`, actually advance progress:

```typescript
for (const lessonNum of aiResponse.markers.lessonsCompleted) {
    await repo.completeLesson(socio.id, lessonNum, {});
}
```

Also advance the message index after each AI response in a lesson delivery context. The simplest approach: have `generateAIResponse` return the resolved `InteractionMode` alongside the text, so the webhook knows whether to call `advanceMessage`.

## What NOT to Build

- **ProgramConfig table** -- hardcode `maxLessonsPerDay = 1`, `lessonsPerWeek = 2` as constants
- **Check-in service** -- skip for now; lessons come first
- **Mentor dashboard** -- no UI until the bot teaches
- **Lessons 6-28** -- 5 is enough for the pilot; same JSON shape scales to all 28

## End-to-End Flow After Implementation

```mermaid
sequenceDiagram
    participant S as Socio
    participant W as Webhook
    participant R as Router
    participant B as PromptBuilder
    participant AI as Claude Haiku
    participant DB as PostgreSQL

    S->>W: "Hola!"
    W->>DB: getSocioProgress()
    DB-->>W: lesson=1, msgIndex=0
    W->>R: determineMode(socio, "Hola!")
    R-->>W: LESSON_START, lesson=1
    W->>B: buildSystemPrompt(socio, routerResult, progress)
    B-->>W: 4-layer prompt with lesson 1 content
    W->>AI: invoke(systemPrompt + history + "Hola!")
    AI-->>W: "¡Hola María! Imagina que tienes..."
    W->>DB: advanceMessage() → msgIndex=1
    W->>S: WhatsApp message

    Note over S,DB: ...messages 2-4 of lesson 1...

    S->>W: "8" (understanding score)
    AI-->>W: "¡Excelente! [LESSON_COMPLETE:1]"
    W->>DB: completeLesson(1, {understanding: 8})
    Note over DB: lesson=2, msgIndex=0, completed=[1]
    W->>S: "¡Excelente!" (marker stripped)
```



