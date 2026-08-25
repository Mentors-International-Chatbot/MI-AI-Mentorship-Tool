# Stage E.2 — Three New Question Types Investigation

Date: 2026-08-25

Scope: investigation and design only. No application code, schema, tests, package content, or
database state changed. Stage E.1 is treated as shipped with the approved Option B architecture:
the bounded shell is shared, while `web_quiz` continues to grade synchronously through
`completeBlock`/`BlockProgress` and `reteach_gate` continues to use `AssessmentSession` and its
snapshot.

The requested new `quizQuestionSchema.format` values are exactly `fill_in_blank`,
`drag_to_order`, and `matching`. The existing top-level lesson block named `drag_order` is a
different type and remains unchanged.

## 1. Current schema, reproduced in full

`apps/web/src/lib/journey-package/journey-package.schema.ts:124-189` currently defines:

```ts
export function normalizeOption(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
}

export const quizQuestionSchema = z
  .object({
    id: key,
    prompt: z.string().min(1),
    format: z.enum(["multiple_choice", "short_answer"]),
    options: z.array(z.string()).optional(),
    answerKey: z.union([z.string(), z.array(z.string())]).optional(),
    explanation: z.string().min(1).optional(),
    dimensionKey: key.optional(),
    graded: z.boolean().default(true),
  })
  .refine(
    (q) => q.format !== "multiple_choice" || (q.options?.length ?? 0) >= 2,
    { message: "multiple_choice questions need at least 2 options", path: ["options"] },
  )
  .superRefine((q, ctx) => {
    if (q.format !== "multiple_choice") return;
    const options = q.options ?? [];
    const normalized = options.map(normalizeOption);
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({
        code: "custom",
        message: "multiple_choice options must be unique after Unicode and whitespace normalization",
        path: ["options"],
      });
    }
    if (q.graded) {
      if (typeof q.answerKey !== "string" || options.filter((o) => o === q.answerKey).length !== 1) {
        ctx.addIssue({
          code: "custom",
          message: "multiple_choice answerKey must equal exactly one raw option",
          path: ["answerKey"],
        });
      }
    } else if (q.answerKey !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "an ungraded question must not declare an answerKey",
        path: ["answerKey"],
      });
    }
  });
```

The important behavioral details are:

- `graded` defaults to `true`.
- Only `multiple_choice` has format-specific validation. It requires at least two options,
  rejects normalized duplicate options, requires one raw option string as the key when graded,
  and forbids a key when ungraded.
- `short_answer` has no format-specific refinement. The schema does not currently require a key,
  constrain a key's shape, forbid `options`, or forbid a key on an ungraded short answer.
- At package level (`journey-package.schema.ts:903-920`), graded checkpoint questions require an
  explanation for non-legacy schema versions and any `dimensionKey` must exist.
- The baseline diagnostic reuses `quizQuestionSchema`, but package-level validation
  (`journey-package.schema.ts:933-955`) separately requires every diagnostic question to remain
  `multiple_choice`, graded, explained, and dimension-linked. Adding formats to the shared enum
  therefore does not make them valid diagnostic formats.
- `sanitizePlayerBlock` (`player/service.ts:158-165`) removes `answerKey` and `explanation` from
  every checkpoint question before it reaches the browser. New correct-answer material must keep
  flowing through those fields, or receive an equally explicit server-side redaction.

## 2. Live-package census and non-breaking boundary

The four named live courses were checked at their source-of-truth package/build inputs. Counts
below are authored questions, not learner attempts.

| Collection | Source checked | Quiz blocks | Checkpoint MC | Checkpoint short answer | Diagnostic MC |
|---|---|---:|---:|---:|---:|
| `mi-colombia-curriculum` | `scripts/migrate-mi-content.ts` + legacy lesson source | 0 | 0 | 0 | 0 |
| `pbj-basics` | `examples/pbj-journey-package.ts` | 1 | 1 | 0 | 0 |
| `skills-tool-calls` | `examples/skills-tool-calls-package.ts` | 4 | 4 | 0 | 0 |
| `ai-essentials` | `content/ai-essentials.package.json` v1.1.1 | 38 | 38 | 0 | 7 |
| **Total** |  | **43** | **43** | **0** | **7** |

The current published AI Essentials artifact is also represented by
`content/ai-essentials-1.1.2.package.json`; it has the same 38 checkpoint MC questions and seven
diagnostic MC questions. It is a later version of the same collection, so it is not double-counted
in the table.

Static evidence:

- `rg` finds one `format: "multiple_choice"` in PBJ and four in Skills.
- The MI transform creates only `teach` blocks and contains no `quiz_checkpoint` or question
  format authoring.
- `jq` over each AI Essentials package finds 38 checkpoint `multiple_choice` and seven diagnostic
  `multiple_choice` questions.
- Repository-wide production/source search finds no authored `short_answer` outside the schema
  declaration itself. Tests exercise the schema shape indirectly, but no named live package does.

The zero-impact rule for BUILD is therefore precise: all 43 existing checkpoint MC questions must
parse, sanitize, render, grade, retry, persist, and reveal feedback exactly as before; all seven
diagnostic MC questions must do the same. `short_answer` has zero live instances, but its permissive
schema and raw strict-equality grading still must not be tightened as an accidental side effect.

## 3. Additive schema design

### Recommended representation

Keep the existing flat object and extend it conditionally. Do not replace it with a
`z.discriminatedUnion` in this stage. A discriminated union would be aesthetically cleaner, but it
would change the inferred TypeScript shape and force every existing consumer/fixture through a
structural rewrite. Adding enum members, one optional rendering field, one additional `answerKey`
arm, and format-scoped `superRefine` branches follows the existing MC precedent and leaves stored
packages valid without migration.

Proposed additive field surface:

```ts
format: z.enum([
  "multiple_choice",
  "short_answer",
  "fill_in_blank",
  "drag_to_order",
  "matching",
]),
options: z.array(z.string()).optional(),
matchingPrompts: z.array(z.object({
  id: key,
  text: z.string().min(1),
})).optional(),
answerKey: z.union([
  z.string(),
  z.array(z.string()),
  z.record(key, z.string()),
]).optional(),
```

The fields mean:

- `fill_in_blank`: `prompt` contains the sentence or phrase around the blank; `answerKey` is one
  accepted string or an array of accepted strings. No `options` are needed.
- `drag_to_order`: `options` is the public pool of sortable labels and `answerKey: string[]` is the
  hidden correct sequence. Using the existing `options` field avoids creating a second generic
  choice-pool field.
- `matching`: `matchingPrompts` is the public left column, `options` is the public right-column
  choice pool, and `answerKey: Record<promptId, rawOption>` is the hidden mapping. The mapping is
  deleted by the existing sanitizer, so no authored `{left, right}` pair is sent intact to the
  browser.

Proposed validation arms:

- `fill_in_blank`: a graded question requires a non-empty string key or a non-empty array of
  non-empty accepted strings, unique after NFKC/whitespace/case normalization. An ungraded one
  forbids a key. `options` and `matchingPrompts` are forbidden.
- `drag_to_order`: at least two non-empty, normalized-unique `options`; a graded key must be a
  complete, duplicate-free permutation of the raw options. An ungraded one forbids a key.
  `matchingPrompts` is forbidden.
- `matching`: at least two normalized-unique prompts and options, equal cardinality, unique prompt
  IDs, and—when graded—an object key whose keys exactly equal all prompt IDs and whose values are a
  duplicate-free permutation of all raw options. An ungraded one forbids a key.
- Existing `multiple_choice` and `short_answer` validation stays byte-for-byte in behavior.

The same normalization already used to reject visually duplicate MC options should be used for
new labels and accepted fill answers. Fill grading should apply NFKC normalization, collapse
whitespace, trim, and case-fold; it should not silently remove punctuation. Authors can express
legitimate spelling or punctuation alternatives explicitly in the accepted-answer array.

### Reachability constraint

The legacy inline checkpoint renderer (`LessonPlayer.tsx:725-730`) renders only `options` as radio
buttons. It cannot render a text blank, an ordered array, or a matching map. The E.1 bounded
`WebQuizExperience` is the intended rich-format surface.

BUILD should add one package-level cross-check: `fill_in_blank`, `drag_to_order`, and `matching`
are valid only inside a `quiz_checkpoint` whose `assessment.mode` is `web_quiz`. Without this check,
the schema would accept a package that the inline player cannot operate. Existing
`multiple_choice` and `short_answer` remain legal in either checkpoint mode to avoid changing
current schema behavior. Diagnostics remain MC-only through their existing cross-check.

## 4. Server grading and response shapes

Today `gradePlayerBlock` assumes every question response is a string, validates only MC options,
and grades all formats with `answer === answerKey` (`player/service.ts:595-610`). That cannot accept
arrays or mappings.

The grading choke point should be a pure format dispatcher used by `gradePlayerBlock`, not three
new branches scattered through route/component code:

```ts
type QuizAnswer = string | string[] | Record<string, string>;

gradeQuizQuestion(question, answer)
  -> { correct: boolean; earned: number; possible: number }
```

Validation and correctness by format:

- `multiple_choice`: require a raw option string and retain exact raw equality. No normalization
  change to existing grading.
- `short_answer`: require a string and retain today's exact `answer === answerKey` behavior.
- `fill_in_blank`: require a non-empty string and compare its normalized value against the
  normalized accepted key set.
- `drag_to_order`: require a string array that is an exact permutation of the public options;
  correctness is exact sequence equality with the hidden key.
- `matching`: require an object with exactly all prompt IDs, values drawn from options exactly
  once; correctness is exact mapping equality with the hidden key.

The top-level response remains one JSON object keyed by question ID, so Option B's transport and
persistence path does not change:

```json
{
  "mc-1": "Option B",
  "blank-1": "large language model",
  "order-1": ["collect", "check", "send"],
  "match-1": { "term-1": "definition C", "term-2": "definition A" }
}
```

That object already fits the completion route's `unknown` request body and Prisma's JSON-typed
`BlockProgress.response`; no route, table, `AssessmentSession`, or snapshot is needed. Server-side
schema/shape validation remains mandatory because browser completeness checks are only UX.

`PlayerFeedback.questions[].correctAnswer` must add the matching-map shape, and
`BlockFeedback` must render that shape explicitly. It must never stringify an unknown object.
The existing key-release rule remains: correct questions may reveal their answer/explanation;
missed questions reveal neither until the retry is exhausted. `showScoreToLearner: false` still
suppresses the entire feedback object, including sub-item correctness, exactly as E.1 established.

## 5. Rich UI inside the E.1 bounded seam

No change belongs in `BoundedAssessmentContainer`. It should continue to know only entry,
active/verdict phases, attempt label, error, and return. All new work stays in the `web_quiz`
payload component beneath that seam.

Recommended payload structure:

```text
BoundedAssessmentContainer (unchanged)
└── WebQuizExperience
    └── QuizQuestionField (dispatches on format)
        ├── multiple_choice: radio group (existing behavior)
        ├── short_answer: text input (existing bounded behavior)
        ├── fill_in_blank: sentence/phrase plus inline text input
        ├── drag_to_order: keyboard-accessible sortable list
        └── matching: one labeled select per left-side prompt
```

- `fill_in_blank`: render the authored prompt and one text input. Accepted answers never reach
  the browser.
- `drag_to_order`: reuse the installed `@dnd-kit` primitives and the existing sortable-list
  visual language, but store raw option strings in that question's array answer. The initial
  visible order should be deterministically mixed before delivery/render and must not be allowed
  to equal the hidden key merely because the author listed items in solution order.
- `matching`: render one native/select-like choice control for each `matchingPrompts` item. Disable
  a right-side choice once used elsewhere, while still allowing the learner to change a match.
  This is keyboard, touch, and screen-reader operable without implementing inaccessible drawn
  connector lines.
- A shared `isCompleteQuizAnswer(question, answer)` should drive submit-button state; the current
  `.trim()` check assumes every answer is a string and cannot remain.
- Retry state remains inside `WebQuizExperience`. A retry keeps the learner's prior selections so
  they can revise them.

## 6. Two design forks discovered

### Fork 1 — scoring granularity for compound questions

Two reasonable policies exist:

- **Binary per authored question.** A drag sequence or matching set earns 1 only when the entire
  question is correct. This preserves the current `correct: boolean` contract, makes every
  authored question equal weight, and is the smallest additive change. It can be harsh: one
  misplaced item makes a large matching/order question worth zero.
- **Fractional within a compound question.** Matching earns correct-pair credit and ordering earns
  position or sequence credit, then each question's 0–1 result is averaged so large questions do
  not automatically outweigh small ones. This is more forgiving, but requires a policy for order
  distance (correct positions vs. adjacent pairs vs. longest subsequence), extends feedback, and
  introduces grading semantics not specified by the target document.

**Recommendation: binary per question for v1.** It matches existing grading and leaves partial
credit as a later additive policy once real authored quizzes show whether it is needed. This needs
human approval; BUILD should not silently choose it.

### Fork 2 — the stated 70% pass gate is not implemented today

This is independent of the three answer formats but blocks the acceptance target. Current
`web_quiz` behavior is:

- `rawScore = correct graded questions / graded questions` (0–1);
- `allCorrect`, not a configured threshold, determines first-attempt success;
- attempt two sets `complete: true` regardless of score;
- `mergeAssessmentConfig().passing.threshold` is read into the merged object but never used by
  web-quiz grading;
- that existing threshold is documented as being on a tracked dimension's own scale (commonly 7
  on a 0–10 dimension), so treating it directly as a normalized quiz ratio would be incorrect;
- `blocking` and `allowRetake` also do not currently determine web-quiz exhaustion behavior.

Two viable scope decisions follow:

- **A — keep E.2 format-only.** Preserve all-correct/two-attempt-completes behavior while adding
  the formats. This is the smallest stage and guarantees current semantics, but AI Essentials
  cannot truthfully author “≥70% to advance”; a new pass-policy stage must ship before E.5.
- **B — close web-quiz pass policy in E.2.** Add a quiz-specific normalized config field (for
  example `webQuizPassingScore`, constrained 0–1) rather than overloading the dimension-scale
  `passing.threshold`, then make `gradePlayerBlock` compare the aggregate score with it. This
  also requires a human decision on failed-attempt exhaustion: a blocking quiz cannot both stop
  after a cap and advance below threshold. The reference document explicitly leaves retry caps
  open, so BUILD cannot safely infer that policy.

**Recommendation: B**, because E.2 is the grading-engine stage and E.5 depends on it as the
acceptance palette. Use an explicit normalized quiz score field rather than mode-dependent units
on `passing.threshold`. Before BUILD, a human still needs to specify whether a learner below 70%
gets unlimited retries, a fixed cap followed by non-blocking completion, or a fixed cap followed
by a still-blocked remediation path. That choice materially changes learner progression.

## 7. Proposed BUILD breakdown (after approval only)

1. Extend the flat question schema, add format validation and the web-quiz-only reachability
   cross-check; add valid/invalid schema tests for all three formats and regression fixtures for
   existing MC/short answer.
2. Add the pure format-dispatch grading helper and structured answer validation; add correctness,
   malformed-response, key-redaction, retry, and feedback tests per format.
3. Extend the web-quiz payload UI with format-specific controls and accessible interaction tests;
   leave the generic bounded container unchanged.
4. Implement the approved pass-policy scope from Fork 2 (in this stage if B is approved, otherwise
   record the explicit pre-E.5 dependency).
5. Run raw `tsc --noEmit`, full test suite, and eslint on touched files; re-run the four-course
   census/validation and explicitly verify all existing MC and short-answer behavior.
6. Write the BUILD verification report and commit the fully verified stage.

## Approval required — stop here

Recommended design: extend the current flat schema with format-scoped validation; keep answer keys
in the existing sanitized field; restrict the three rich formats to `assessment.mode: "web_quiz"`;
grade through one pure dispatcher under the unchanged E.1 Option B container seam; use binary
per-question scoring for v1; and include a separate normalized web-quiz pass threshold in E.2.

No BUILD work has started. Approval is needed on both scoring granularity and, most importantly,
the 70%-gate/retry-exhaustion policy before implementation.
