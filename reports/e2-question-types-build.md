# Stage E.2 — Three New Question Types Build

Date: 2026-08-25

Approved decisions:

- binary, equal-weight scoring per authored question;
- a separate normalized 0–1 web-quiz passing score;
- unlimited retries while a web quiz remains below that score.

## Delivered shape

- Added `fill_in_blank`, `drag_to_order`, and `matching` as additive
  `quizQuestionSchema.format` values with format-specific validation.
- Kept the existing flat schema rather than restructuring existing questions into a new union.
- Added `webQuizPassingScore` at package and block-override levels, defaulting to `1` so existing
  behavior remains all-correct unless a course explicitly configures another threshold.
- Routed package/block threshold resolution through the existing `mergeAssessmentConfig` choke
  point.
- Restricted rich formats to `quiz_checkpoint` blocks with `assessment.mode: "web_quiz"`; the
  legacy inline renderer cannot accept content it cannot operate.
- Added one pure server-side format dispatcher for answer validation and correctness.
- Kept `multiple_choice` and `short_answer` raw-equality behavior unchanged.
- Kept Option B from E.1: quiz answers still post through `completeBlock` and persist in
  `BlockProgress.response`; no `AssessmentSession`, snapshot, table, or route was added.
- Kept `BoundedAssessmentContainer` payload-agnostic. Format-specific controls live under
  `WebQuizExperience` in `QuizQuestionField`.
- Added accessible controls: text input for fill, keyboard/pointer sortable list for ordering,
  and labeled selects with one-use choices for matching.
- Preserved server-side answer-key redaction and explicit feedback rendering for every new answer
  shape. Unknown feedback still renders nothing, never raw JSON.
- Below-threshold web quizzes never stamp completion, even after arbitrarily many attempts. They
  reveal no missed answer key and remain retriable until the configured score is met.
- Plain quiz checkpoints retain their existing two-attempt completion and feedback wording.

## Verification — raw output

### `npx tsc --noEmit`

```text
```

Exit code: `0`

### `npm test`

```text
> web@0.1.0 test
> vitest run


 RUN  v4.1.1 /Users/michaelbertoldo/dev/oci/apps/web


[SKIPPED] activeFlagWhere agrees with isFlagActive
  src/lib/flags/__tests__/active.test.ts
  TEST_DATABASE_URL is not set, so isFlagActive/activeFlagWhere equivalence is UNVERIFIED.
  Point it at a disposable Neon branch. Never DATABASE_URL — that is shared dev data.
  This is a hard failure in CI.


 Test Files  137 passed (137)
      Tests  1601 passed | 1 skipped (1602)
   Start at  13:13:55
   Duration  4.97s (transform 5.23s, setup 0ms, import 23.86s, tests 4.50s, environment 20ms)
```

Exit code: `0`

### ESLint on every touched TypeScript/TSX file

```text
```

Exit code: `0`

### Existing-course package validation/census

```text
✅ PB&J package is valid against journeyPackageSchema v1.0
   Lessons: 1
   Blocks in lesson 1: 8
   Tracked dimensions: sequencing, confidence
pbj-basics: valid; 1 checkpoint questions; formats=multiple_choice
skills-tool-calls: valid; 4 checkpoint questions; formats=multiple_choice
ai-essentials-1.1.1: valid; 38 checkpoint questions; formats=multiple_choice
ai-essentials-1.1.2: valid; 38 checkpoint questions; formats=multiple_choice
mi-colombia-curriculum: migration transform contains 0 quiz_checkpoint blocks (static census)
```

Exit code: `0`

## Existing-course behavior boundary

- `mi-colombia-curriculum` has no checkpoint questions and its chat-surface transform is
  untouched.
- `pbj-basics`, `skills-tool-calls`, and both checked AI Essentials artifacts validate with the
  same existing `multiple_choice` content.
- No named live package authors `short_answer`; its permissive schema and strict raw-equality
  grader were nevertheless pinned by regression tests and left unchanged.
- No named live package currently authors `assessment.mode: "web_quiz"`, so the new threshold and
  unlimited-retry policy are opt-in and do not alter an existing course.
- The player-surface `reteach_gate` schema rejection remains in place for Stage E.4.
