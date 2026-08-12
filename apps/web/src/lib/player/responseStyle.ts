import type { ResponseStyle } from "@/lib/journey-package/journey-package.schema";
import { deliveredTextMetrics } from "@/lib/player/telemetryMetrics";

export type ResponseStyleViolation =
  | "sentence_limit"
  | "question_limit"
  | "markdown"
  | "control_marker"
  | "incomplete_ending";

function maxSentencesFor(style: ResponseStyle, expanded: boolean): number | undefined {
  return expanded ? style.expanded?.maxSentences ?? style.maxSentences : style.maxSentences;
}

/** Validates the learner-visible text, never the raw model markers. */
export function responseStyleViolations(
  deliveredText: string,
  style: ResponseStyle | undefined,
  expanded: boolean,
): ResponseStyleViolation[] {
  if (!style) return [];
  const metrics = deliveredTextMetrics(deliveredText);
  const violations: ResponseStyleViolation[] = [];
  const maxSentences = maxSentencesFor(style, expanded);
  if (maxSentences !== undefined && metrics.sentences > maxSentences) violations.push("sentence_limit");
  if (style.maxQuestions !== undefined && metrics.questionCount > style.maxQuestions) violations.push("question_limit");
  if (style.markdown === "none" && metrics.markdown) violations.push("markdown");
  // Recognized backend markers are removed before this validation. Catch
  // malformed marker/drafting prefixes while preserving domain prose such as
  // [SKU].
  if (/\[(?:(?:FLAG|LESSON|MILESTONE|ESCALATE|FINANCIAL|END|DRAFT|RESPONSE|ANSWER|FINAL|COMPLETE)[A-Z0-9_-]*)(?:[:|][^\]]+)?\]/u.test(deliveredText)) violations.push("control_marker");
  // Emoji and closing punctuation may follow the terminal mark; that is still
  // a complete ending ("Ready? 🤔"), not a mid-sentence truncation.
  if (!/[.!?](?:["')\]]|\p{Extended_Pictographic}|\uFE0F|\s)*$/u.test(deliveredText.trim())) {
    violations.push("incomplete_ending");
  }
  return violations;
}

export function buildResponseStyleRepairInstruction(
  style: ResponseStyle,
  expanded: boolean,
  violations: readonly ResponseStyleViolation[],
  strict = false,
): string {
  const maxSentences = maxSentencesFor(style, expanded);
  const requirements = [
    maxSentences !== undefined ? `at most ${maxSentences} complete sentences total` : null,
    style.maxQuestions !== undefined ? `at most ${style.maxQuestions} question${style.maxQuestions === 1 ? "" : "s"}` : null,
    style.markdown === "none" ? "plain text with no Markdown" : null,
    "a complete final sentence",
  ].filter((item): item is string => item !== null);
  return [
    `Your draft failed the learner-visible output contract (${violations.join(", ")}).`,
    `Rewrite it to satisfy: ${requirements.join("; ")}.`,
    ...(style.maxQuestions !== undefined
      ? [strict && violations.includes("question_limit")
        ? "Use zero question-mark characters. Turn every question into a statement and do not ask a closing question."
        : `Use no more than ${style.maxQuestions} question-mark character${style.maxQuestions === 1 ? "" : "s"}; remove embedded and rhetorical questions, keeping only the most useful question.`]
      : []),
    "Keep the most useful substance and recognized backend markers ([FLAG:...], [LESSON_COMPLETE:...], [MILESTONE:...], [ESCALATE|...], [FINANCIAL:...]). Remove all other bracketed drafting markers such as [END].",
    "Remove lower-priority detail instead of joining sentences with hyphens, semicolons, or long clause chains.",
    "Return only the rewritten final reply.",
  ].join("\n");
}

export function buildResponseStyleInstruction(style: ResponseStyle | undefined, expanded: boolean): string {
  if (!style) return "";
  const maxSentences = maxSentencesFor(style, expanded);
  const lines = [
    "HARD OUTPUT CONTRACT FOR THIS LEARNER-VISIBLE TURN (check before sending):",
  ];
  if (maxSentences !== undefined) {
    lines.push(
      `- The ENTIRE reply must contain at most ${maxSentences} complete sentences, including any title, greeting, example, feedback, and question.`,
      `- If your draft has more than ${maxSentences} sentences, rewrite it shorter before responding; do not merely stop mid-sentence.`,
      "- Keep sentences short. Remove lower-priority detail instead of joining sentences with hyphens, semicolons, or long chains of clauses.",
    );
  }
  if (style.maxQuestions !== undefined) lines.push(
    `- Ask at most ${style.maxQuestions} question${style.maxQuestions === 1 ? "" : "s"}. This means no more than ${style.maxQuestions} question-mark character${style.maxQuestions === 1 ? "" : "s"}; do not add rhetorical or embedded questions.`,
  );
  if (style.markdown === "none") lines.push("- Use plain text only: no Markdown headings, lists, emphasis, tables, links, or code fences.");
  lines.push(
    "- Prefer one compact paragraph with no preamble or section label.",
    "- Finish the final sentence completely; never trail off because of the output limit.",
    "This contract overrides any earlier prompt wording that asks for more messages, detail, examples, or questions.",
  );
  return lines.join("\n");
}

export function resolvePlayerMaxTokens(style: ResponseStyle | undefined, expanded: boolean): number | undefined {
  return expanded ? style?.expanded?.maxOutputTokens ?? style?.maxOutputTokens : style?.maxOutputTokens;
}
