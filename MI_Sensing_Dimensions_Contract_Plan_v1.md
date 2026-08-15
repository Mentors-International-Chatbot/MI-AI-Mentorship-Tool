# MI Sensing Dimensions Contract — Separate Project

## Status

Tracked separately from AI Essentials. Do not fold this work into AIESS acceptance or publication.

## Finding

The active MI sentiment prompt (`db:1.0`) does not declare a dimensions contract. The AI Essentials B3 comparison therefore supplied a small controlled contract explicitly; that probe verifies signal availability under ideal scripted inputs, not byte-identical MI production behavior.

## Required sequence

1. Capture and check in a representative full MI Colombia lesson-run fixture before changing prompt resolution or sensing inputs.
2. Add the canonical dimensions contract centrally so every applicable course receives it through one resolver; do not supply it ad hoc in individual routes.
3. Require the merged contract in the sensing prompt while preserving existing MI presentation and message sequencing.
4. Re-run the frozen MI lesson fixture and require byte-for-byte identical learner-visible output.
5. Measure observation and sentiment persistence separately from learner-visible narration, and document any intended sensing-only changes.

## Acceptance gates

- The pre-change MI Colombia fixture exists and identifies the exact prompt/config versions used.
- Learner-visible output is byte-identical before and after the central contract change.
- Existing MI tests remain green.
- Dimension observations use declared keys only and permit `null` for untouched dimensions.
- The change is reviewed and shipped independently of AI Essentials publication.

## Explicit non-goals

- No AI Essentials publication decision.
- No Canvas/LTI validation.
- No rewriting of MI curriculum or tutor narration.
- No use of synthetic B3 results as a substitute for the production-shaped MI regression fixture.
