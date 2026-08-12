import type { ResponseStyle } from "@/lib/journey-package/journey-package.schema";
import { deliveredTextMetrics } from "@/lib/player/telemetryMetrics";

export type ResponseStyleViolation =
  | "sentence_limit"
  | "sentence_word_limit"
  | "question_limit"
  | "question_position"
  | "markdown"
  | "ascii_punctuation"
  | "single_paragraph"
  | "self_reference"
  | "repeated_parent_opening"
  | "character_range"
  | "control_marker"
  | "incomplete_ending";

const MAX_SENTENCE_WORDS = 35;
const NORMAL_CHARACTER_RANGE = { min: 200, max: 420 };
const EXPANDED_CHARACTER_RANGE = { min: 450, max: 700 };

export function hasTutorSelfIntroduction(text: string, personaName?: string): boolean {
  const name = personaName?.trim();
  const namesSelf = name ? new RegExp(`\\b(?:I am|I'm|this is)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu").test(text) : false;
  return namesSelf || /\b(?:I am|I'm)\s+(?:here|glad|excited|happy|your (?:tutor|mentor|guide)|the (?:tutor|mentor|guide))\b/iu.test(text);
}

function normalizedOpeningWords(text: string): string[] {
  const opening = text.trim().match(/^[^.!?]+[.!?]?/u)?.[0] ?? text.trim();
  return opening.toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Exact opening reuse is especially jarring on the synthetic expand action. */
export function repeatsParentOpening(parentReply: string | undefined, expandedReply: string): boolean {
  if (!parentReply) return false;
  const parentWords = normalizedOpeningWords(parentReply);
  const expandedWords = normalizedOpeningWords(expandedReply);
  if (parentWords.length === 0 || expandedWords.length === 0) return false;
  const prefixLength = Math.min(8, parentWords.length, expandedWords.length);
  return parentWords.slice(0, prefixLength).join(" ") === expandedWords.slice(0, prefixLength).join(" ");
}

function maxSentencesFor(style: ResponseStyle, expanded: boolean): number | undefined {
  return expanded ? style.expanded?.maxSentences ?? style.maxSentences : style.maxSentences;
}

/** Validates the learner-visible text, never the raw model markers. */
export function responseStyleViolations(
  deliveredText: string,
  style: ResponseStyle | undefined,
  expanded: boolean,
  personaName?: string,
  parentReply?: string,
): ResponseStyleViolation[] {
  if (!style) return [];
  const metrics = deliveredTextMetrics(deliveredText);
  const violations: ResponseStyleViolation[] = [];
  const maxSentences = maxSentencesFor(style, expanded);
  if (maxSentences !== undefined && metrics.sentences > maxSentences) violations.push("sentence_limit");
  if (metrics.maxSentenceWords > MAX_SENTENCE_WORDS) violations.push("sentence_word_limit");
  if (style.maxQuestions !== undefined && metrics.questionCount > style.maxQuestions) violations.push("question_limit");
  if (!metrics.questionInFinalSentence) violations.push("question_position");
  if (style.markdown === "none" && metrics.markdown) violations.push("markdown");
  if (!metrics.asciiPunctuation) violations.push("ascii_punctuation");
  if (!metrics.singleParagraph) violations.push("single_paragraph");
  if (hasTutorSelfIntroduction(deliveredText, personaName)) violations.push("self_reference");
  if (expanded && repeatsParentOpening(parentReply, deliveredText)) violations.push("repeated_parent_opening");
  const characterRange = expanded ? EXPANDED_CHARACTER_RANGE : NORMAL_CHARACTER_RANGE;
  if (deliveredText.length < characterRange.min || deliveredText.length > characterRange.max) violations.push("character_range");
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
  currentCharacters?: number,
  parentReply?: string,
): string {
  const maxSentences = maxSentencesFor(style, expanded);
  const requirements = [
    maxSentences !== undefined ? `at most ${maxSentences} complete sentences total` : null,
    style.maxQuestions !== undefined ? `at most ${style.maxQuestions} question${style.maxQuestions === 1 ? "" : "s"}` : null,
    style.markdown === "none" ? "plain text with no Markdown" : null,
    `between ${(expanded ? EXPANDED_CHARACTER_RANGE : NORMAL_CHARACTER_RANGE).min} and ${(expanded ? EXPANDED_CHARACTER_RANGE : NORMAL_CHARACTER_RANGE).max} delivered characters`,
    `no sentence over ${MAX_SENTENCE_WORDS} words`,
    "any question only in the final sentence",
    "ASCII punctuation only and one paragraph",
    "no self-introduction or tutor persona name",
    "a complete final sentence",
  ].filter((item): item is string => item !== null);
  return [
    `Your draft failed the learner-visible output contract (${violations.join(", ")}).`,
    `Rewrite it to satisfy: ${requirements.join("; ")}.`,
    ...(violations.includes("character_range") && currentCharacters !== undefined
      ? [currentCharacters < (expanded ? EXPANDED_CHARACTER_RANGE : NORMAL_CHARACTER_RANGE).min
        ? `The current draft is only ${currentCharacters} characters. Add grounded substance in separate short sentences and aim for ${expanded ? "520-620" : "260-360"} characters.`
        : `The current draft is ${currentCharacters} characters. Remove lower-priority detail and aim for ${expanded ? "520-620" : "260-360"} characters.`]
      : []),
    ...(violations.includes("sentence_word_limit")
      ? ["Split the overlong sentence at a natural boundary. Do not join the pieces with a semicolon or hyphen."]
      : []),
    ...(violations.includes("repeated_parent_opening")
      ? [
        "Remove the entire first sentence that repeats the parent. Begin with the first genuinely new detail, and do not recap or reword the parent's opening.",
        ...(parentReply ? [`PARENT REPLY WHOSE OPENING MUST NOT BE REUSED:\n${parentReply}`] : []),
      ]
      : []),
    ...(style.maxQuestions !== undefined
      ? [strict && violations.includes("question_limit")
        ? "Use zero question-mark characters. Turn every question into a statement and do not ask a closing question."
        : `Use no more than ${style.maxQuestions} question-mark character${style.maxQuestions === 1 ? "" : "s"}; remove embedded and rhetorical questions, keeping only the most useful question.`]
      : []),
    "Keep the most useful substance and recognized backend markers ([FLAG:...], [LESSON_COMPLETE:...], [MILESTONE:...], [ESCALATE|...], [FINANCIAL:...]). Remove all other bracketed drafting markers such as [END].",
    "Remove lower-priority detail instead of joining sentences with hyphens, semicolons, or long clause chains. If a list has more than three items, name its overall shape instead of enumerating it.",
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
    `- Keep every sentence at ${MAX_SENTENCE_WORDS} words or fewer. If a list has more than three items, name its overall shape instead of enumerating it.`,
    `- The delivered reply must be ${expanded ? `${EXPANDED_CHARACTER_RANGE.min}-${EXPANDED_CHARACTER_RANGE.max}` : `${NORMAL_CHARACTER_RANGE.min}-${NORMAL_CHARACTER_RANGE.max}`} characters.`,
    "- Use ASCII punctuation only: straight quotes, apostrophes, periods, commas, colons, semicolons, question marks, exclamation marks, and ordinary hyphens. Never use em dashes, en dashes, curly quotes, or the ellipsis character.",
    "- Return one paragraph with no real or escaped newline sequences.",
    "- Never introduce or name yourself. Do not say you are here, glad, excited, happy, the tutor, the mentor, or the guide. The first sentence must be about the subject.",
    "- Answer a direct question or confusion before redirecting or questioning the learner.",
    "- For learner questions and teach-backs, use an industry domain only when the learner or their project introduces it. Do not import a course-authored industry example into a general exchange.",
    "- If you ask a question, it must be the final sentence and genuinely open. Never ask a rhetorical question and answer it yourself.",
    ...(expanded ? ["- Do not repeat or paraphrase the parent's opening sentence. Start with new material that extends it."] : []),
    "BEHAVIOR CALIBRATION:",
    "- General learner question: answer in general terms. Industry examples in lesson material are teaching examples, not a persona or default context.",
    "- Flat confusion: name the likely distinction, then ask one narrow question. Do not summarize the lesson.",
    "- Off-topic but reasonable question: answer honestly and briefly. Do not say it is outside the course scope and do not deflect back to the lesson.",
    "- Challenge to the material: concede what is obvious, then name the less-obvious execution problem. Do not defend the curriculum.",
    "- Request for the answer: give a useful starting point and ask only for the learner-specific input you cannot supply. Do not refuse flatly or lecture about learning.",
    "- Failed attempt: diagnose the likely cause before teaching, using one question to narrow it.",
    "- Teach-back: confirm the substance without repeating the learner's list, then deepen one point.",
    "- Expansion: continue with new material instead of recapping the parent reply.",
    "CALIBRATION EXAMPLES (match the behavior, never copy them verbatim):",
    "- Confusion: 'Fluency and accuracy are different. A model can produce convincing text without checking a source. What part feels contradictory?'",
    "- Job concern: 'Probably some jobs, though routine work inside jobs often changes before whole roles disappear. Which kind of work are you worried about?'",
    "- Challenge: 'The rule is obvious. Applying it under time pressure is where teams fail. Where would that failure be hardest to notice?'",
    "- Asked to write it: 'I can draft most of it. Tell me what a correct output must look like, and I will build around that.'",
    "- Failed attempt: 'That usually means missing context or an ambiguous instruction. What did you provide, and what came back?'",
    "- Teach-back: 'That is the complete shape, in the right order. Which part would be hardest to set up in practice?'",
    "- Expansion: 'Take monitoring, because it sounds easy and is not. Quality can decline slowly unless someone checks a stable set of cases over time.'",
    "- Finish the final sentence completely; never trail off because of the output limit.",
    "This contract overrides any earlier prompt wording that asks for more messages, detail, examples, or questions.",
  );
  return lines.join("\n");
}

export function resolvePlayerMaxTokens(style: ResponseStyle | undefined, expanded: boolean): number | undefined {
  return expanded ? style?.expanded?.maxOutputTokens ?? style?.maxOutputTokens : style?.maxOutputTokens;
}
