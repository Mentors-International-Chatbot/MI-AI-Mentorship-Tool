# Stage E.1 — Bounded Container Build

Date: 2026-08-25
Decision: Option B — one bounded shell above divergent payload internals.

The player container owns entry, attempt framing, terminal completion, verdict,
and clean return. `reteach_gate` retains `AssessmentSession` plus conversational
turn routes. `web_quiz` retains deterministic grading and `BlockProgress`.

The Stage E.4 player-surface schema rejection remains unchanged.

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


 Test Files  133 passed (133)
      Tests  1563 passed | 1 skipped (1564)
   Start at  12:35:40
   Duration  4.31s (transform 5.29s, setup 0ms, import 19.83s, tests 4.04s, environment 15ms)
```

Exit code: `0`

### ESLint on touched TypeScript/TSX files

```text
```

Exit code: `0`

## Existing-course behavior boundary

- `mi-colombia-curriculum`: chat delivery remains on the legacy surface path.
- `skills-tool-calls` and the current `ai-essentials` package: blocks without an
  assessment mode keep their existing player render/grading path.
- `pbj-basics`: the intentional Track E correction now honors its default
  `showScoreToLearner: false` across terminal prose, `/message`, `/complete`, and
  GET reloads. This is the explicitly identified behavior correction, not an
  accidental regression.
- Project blocks remain outside E.1; no project schema or application code was
  added.
