import type { ResponseStyle } from "@/lib/journey-package/journey-package.schema";
import { deliveredTextMetrics } from "@/lib/player/telemetryMetrics";

export type ResponseStyleViolation =
  | "sentence_limit"
  | "sentence_word_limit"
  | "question_limit"
  | "question_position"
  | "question_focus"
  | "question_not_open"
  | "comma_chained_enumeration"
  | "markdown"
  | "ascii_punctuation"
  | "single_paragraph"
  | "self_reference"
  | "repeated_parent_opening"
  | "repeated_parent_question"
  | "stock_praise"
  | "prompt_starting_point"
  | "character_range"
  | "control_marker"
  | "incomplete_ending";

export type StyledPlayerIntent = "question" | "teach_back" | "lesson_entry" | "capstone" | "expand";

const MAX_SENTENCE_WORDS = 35;
const NORMAL_CHARACTER_RANGE = { min: 200, max: 420 };
const EXPANDED_CHARACTER_RANGE = { min: 450, max: 700 };
const STOCK_TEACHBACK_PRAISE = /\b(?:you(?:'ve| have)? nailed|complete shape|right (?:frame|order)|you(?:'ve| have)? (?:named|captured|listed|identified)(?: all| the| this)?|that(?:'s| is) exactly (?:the|right)|you(?:'ve| have) (?:got|mapped) the)\b/iu;
const PROMPT_DRAFT_REQUEST = /\b(?:write|draft|create|make|build)\b[^.!?]{0,50}\bprompt\b|\bprompt\b[^.!?]{0,50}\b(?:write|draft|create|make|build)\b/iu;
const PROMPT_STARTING_POINT = /\b(?:act as|role)\b[\s\S]*\b(?:context|using|use)\b[\s\S]*\b(?:output|create)\b/iu;

export function hasPromptStartingPoint(text: string): boolean {
  return PROMPT_STARTING_POINT.test(text);
}

/**
 * Whether a delivered reply's last non-blank character is a question mark.
 *
 * Deliberately the crude version of the check two lines down: no attempt at
 * "is it actually open" or "is it actually asking the learner something."
 * This gates the player's block advancement, not response-style acceptance —
 * it decides whether to hold the next block, and holding on a false positive
 * (a rhetorical "Sound good?") costs one extra Continue click, while missing a
 * real open question lets the lesson move on out from under it. Bias toward
 * the cheap miss.
 */
export function endsWithQuestion(text: string): boolean {
  return /\?(?:["')\]]|\s)*$/u.test(text.trim());
}

export function finalQuestionHasOneFocus(text: string): boolean {
  const finalSentence = text.trim().match(/[^.!?]*\?(?:["')\]]|\s)*$/u)?.[0];
  if (!finalSentence) return true;
  // Q-08 deliberately diagnoses one failed attempt by requesting its paired
  // input and output. It is one diagnostic focus even though both halves use
  // an interrogative; treating it as two unrelated questions contradicts the
  // approved acceptance exemplar.
  if (/\bwhat\b[^?]*\b(?:gave|give|provided?|input)\b[^?]*\band\s+what\b[^?]*\b(?:got|get|returned?|output|came back|produced?)\b/iu.test(finalSentence)) return true;
  // A choice inside one decision ("cost or speed") is still one focus. Reject
  // only a coordinated second question/clause, which is the doubled shape the
  // acceptance rule is meant to catch.
  return !/,\s*(?:and|or)\s+(?:(?:what|which|how|why|when|where|who)\b|(?:do|does|did|is|are|can|could|would|will|should|have|has)\s+\w+\b|if\b|whether\b)/iu.test(finalSentence);
}

function finalQuestionIsOpen(text: string): boolean {
  const finalSentence = text.trim().match(/[^.!?]*\?(?:["')\]]|\s)*$/u)?.[0]?.trim();
  if (!finalSentence) return true;
  return !/^(?:is|are|am|was|were|do|does|did|can|could|would|will|should|have|has|had|may|might)\b|^(?:would|do) you (?:like|want)\b|\bdoes that (?:make sense|feel clearer)\b/iu.test(finalSentence);
}

function repeatsParentQuestion(parentReply: string | undefined, expandedReply: string): boolean {
  if (!parentReply) return false;
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim();
  const parentQuestion = parentReply.match(/[^.!?]*\?/gu)?.at(-1);
  const expandedQuestion = expandedReply.match(/[^.!?]*\?/gu)?.at(-1);
  if (!parentQuestion || !expandedQuestion) return false;
  const meaningful = (value: string) => new Set(normalize(value).split(" ").filter((word) => word.length > 3 && !/^(?:what|which|that|this|your|with|from|would|could|should|have|does)$/u.test(word)));
  const parentWords = meaningful(parentQuestion);
  const expandedWords = meaningful(expandedQuestion);
  const overlap = [...parentWords].filter((word) => expandedWords.has(word)).length;
  return normalize(parentQuestion) === normalize(expandedQuestion) || (parentWords.size > 0 && overlap / Math.min(parentWords.size, expandedWords.size) >= 0.6);
}

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
  intent?: StyledPlayerIntent,
  parentIntent?: Exclude<StyledPlayerIntent, "expand">,
  learnerText?: string,
): ResponseStyleViolation[] {
  if (!style) return [];
  const metrics = deliveredTextMetrics(deliveredText);
  const violations: ResponseStyleViolation[] = [];
  const maxSentences = maxSentencesFor(style, expanded);
  if (maxSentences !== undefined && metrics.sentences > maxSentences) violations.push("sentence_limit");
  if (metrics.maxSentenceWords > MAX_SENTENCE_WORDS) violations.push("sentence_word_limit");
  if (style.maxQuestions !== undefined && metrics.questionCount > style.maxQuestions) violations.push("question_limit");
  if (!metrics.questionInFinalSentence) violations.push("question_position");
  if (!finalQuestionHasOneFocus(deliveredText)) violations.push("question_focus");
  if (!finalQuestionIsOpen(deliveredText)) violations.push("question_not_open");
  if (metrics.commaChainedEnumeration) violations.push("comma_chained_enumeration");
  if (style.markdown === "none" && metrics.markdown) violations.push("markdown");
  if (!metrics.asciiPunctuation) violations.push("ascii_punctuation");
  if (!metrics.singleParagraph) violations.push("single_paragraph");
  if (hasTutorSelfIntroduction(deliveredText, personaName)) violations.push("self_reference");
  if (expanded && repeatsParentOpening(parentReply, deliveredText)) violations.push("repeated_parent_opening");
  if (expanded && repeatsParentQuestion(parentReply, deliveredText)) violations.push("repeated_parent_question");
  if ((intent === "teach_back" || (intent === "expand" && parentIntent === "teach_back")) && STOCK_TEACHBACK_PRAISE.test(deliveredText)) violations.push("stock_praise");
  if (intent === "question" && PROMPT_DRAFT_REQUEST.test(learnerText ?? "") && !hasPromptStartingPoint(deliveredText)) violations.push("prompt_starting_point");
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
    "one paragraph",
    "no self-introduction or tutor persona name",
    "a complete final sentence",
  ].filter((item): item is string => item !== null);
  return [
    `Your draft failed the learner-visible output contract (${violations.join(", ")}).`,
    `Rewrite it to satisfy: ${requirements.join("; ")}.`,
    expanded
      ? "Use five complete sentences, each 12-28 words, and aim for 520-620 characters total."
      : "Use three complete sentences, each 10-25 words, and aim for 260-360 characters total.",
    ...(violations.includes("character_range") && currentCharacters !== undefined
      ? [currentCharacters < (expanded ? EXPANDED_CHARACTER_RANGE : NORMAL_CHARACTER_RANGE).min
        ? `The current draft is only ${currentCharacters} characters. Add grounded substance in separate short sentences and aim for ${expanded ? "520-620" : "260-360"} characters.`
        : `The current draft is ${currentCharacters} characters. Remove lower-priority detail and aim for ${expanded ? "520-620" : "260-360"} characters.`]
      : []),
    ...(violations.includes("sentence_word_limit")
      ? ["Split the overlong sentence at a natural boundary. Do not join the pieces with a semicolon or hyphen."]
      : []),
    ...(violations.includes("comma_chained_enumeration")
      ? [strict
        ? "Use no comma characters anywhere in the rewritten reply. Replace the enumeration with one short category."
        : "Remove every four-or-more-item enumeration. Replace it with a short category such as 'the input-output pair' or 'the workflow,' and do not preserve the list in different words."]
      : []),
    ...(violations.includes("repeated_parent_opening")
      ? [
        "Remove the entire first sentence that repeats the parent. Begin with the first genuinely new detail, and do not recap or reword the parent's opening.",
        ...(parentReply ? [`PARENT REPLY WHOSE OPENING MUST NOT BE REUSED:\n${parentReply}`] : []),
      ]
      : []),
    ...(violations.includes("repeated_parent_question")
      ? ["Remove the repeated parent question. End with no question or ask one genuinely new focused question."]
      : []),
    ...(violations.includes("stock_praise")
      ? [strict
        ? "Begin directly with the concept. Use no second-person words such as you or your and make no claim that the learner named, captured, listed, or completed anything."
        : "Remove stock praise. Respond to the learner's substance in fresh, specific words without saying they nailed, captured, named, or listed everything."]
      : []),
    ...(violations.includes("prompt_starting_point")
      ? [
        "Give the learner a usable prompt starting point before asking for more information.",
        "The draft should identify a role, relevant context, requested output, success criteria, and a constraint, using placeholders where learner-specific details are unknown.",
        "Briefly explain that the placeholders are theirs to replace, then ask one open question for the most important missing detail.",
      ]
      : []),
    ...(style.maxQuestions !== undefined
      ? [strict && (violations.includes("question_limit") || violations.includes("question_focus") || violations.includes("question_not_open") || violations.includes("repeated_parent_question"))
        ? "Use zero question-mark characters. Turn every question into a statement and do not ask a closing question."
        : `Use no more than ${style.maxQuestions} question-mark character${style.maxQuestions === 1 ? "" : "s"}. If you keep a question, put it last and make it open and focused; never use yes-no or coordinate a second question after a comma.`]
      : []),
    "Keep the most useful substance and recognized backend markers ([FLAG:...], [LESSON_COMPLETE:...], [MILESTONE:...], [ESCALATE|...], [FINANCIAL:...]). Remove all other bracketed drafting markers such as [END].",
    "Remove lower-priority detail instead of joining sentences with hyphens, semicolons, or long clause chains. If a list has more than three items, name its overall shape instead of enumerating it.",
    "Return only the rewritten final reply.",
  ].join("\n");
}

function intentCalibration(intent: StyledPlayerIntent | undefined): string[] {
  switch (intent) {
    case "lesson_entry":
      return [
        "LESSON ENTRY:",
        "- Open with a learner situation specific to this lesson, not a definition, welcome, agenda, or tutor introduction.",
        // No trailing question here, deliberately: this intent announces the
        // block the player is about to show, not a conversation turn the
        // learner is expected to answer. See the three-gate note in
        // LessonPlayer.tsx — a mentor question on this intent would hold the
        // next block open for an answer nobody is being asked to give.
        "- Connect that situation to why the subject matters, then stop. Do not end with a question.",
      ];
    case "question":
      return [
        "QUESTION:",
        "- Answer in the first sentence. Do not praise the question, defend the curriculum, or invent a learner industry or project.",
        "- For vague confusion, give one plain explanation before asking what remains unclear. For a failed attempt, diagnose briefly before requesting its input-output pair.",
        "- If asked to write a prompt, never refuse or delay the draft. Give a compact usable starting point now with role, context, output, success criteria, and one constraint. Add no lecture about prompting.",
      ];
    case "teach_back":
      return [
        "TEACH-BACK:",
        "- Begin with a subject noun phrase about the concept. Never begin with 'you' or 'that,' praise the learner, or claim they named every item. Do not repeat their list.",
        "- Deepen one point in domain-neutral terms unless the learner supplied a setting.",
      ];
    case "capstone":
      return [
        "CAPSTONE:",
        "- Name one useful project strength or gap without restating the submission. Ask about only one decision.",
      ];
    case "expand":
      return [
        "EXPANSION:",
        "- Start at the first new detail. Never recap, reorder, or paraphrase the parent reply, and do not repeat its question.",
        "- Deepen one point without a long list. Use no question when the parent already asked one.",
        "- Stay domain-neutral unless the learner supplied a setting.",
      ];
    default:
      return [];
  }
}

export function buildResponseStyleInstruction(
  style: ResponseStyle | undefined,
  expanded: boolean,
  intent?: StyledPlayerIntent,
  parentIntent?: Exclude<StyledPlayerIntent, "expand">,
): string {
  if (!style) return "";
  const maxSentences = maxSentencesFor(style, expanded);
  const lines = [
    "HARD LEARNER-VISIBLE OUTPUT CONTRACT:",
    expanded
      ? `- Use one paragraph of 4-5 short sentences, 65-85 words total, and ${EXPANDED_CHARACTER_RANGE.min}-${EXPANDED_CHARACTER_RANGE.max} characters. Stop after sentence 5.`
      : `- Use one paragraph of 2-3 short sentences, 35-55 words total, and ${NORMAL_CHARACTER_RANGE.min}-${NORMAL_CHARACTER_RANGE.max} characters. Stop after sentence 3.`,
  ];
  if (maxSentences !== undefined) {
    lines.push(
      `- Never exceed ${maxSentences} complete sentences or end mid-sentence.`,
    );
  }
  if (style.maxQuestions !== undefined) lines.push(
    `- Use at most ${style.maxQuestions} question-mark character${style.maxQuestions === 1 ? "" : "s"}; no embedded or rhetorical questions.`,
  );
  if (style.markdown === "none") lines.push("- Use plain text only: no Markdown headings, lists, emphasis, tables, links, or code fences.");
  lines.push(
    `- Keep every sentence under ${MAX_SENTENCE_WORDS} words, preferably 12-22. Use periods instead of comma chains. When a list would run past three items, name its overall shape instead of enumerating it.`,
    "- Use no preamble, section label, Markdown, newline, self-introduction, or tutor name.",
    "- Sound human through direct, specific attention to the learner's subject. Do not manufacture warmth with praise, welcomes, or enthusiasm about yourself.",
    "- Answer a direct question or confusion before redirecting.",
    "- A question is optional. If used, make it the short final sentence with one open focus. Never use yes-no or coordinate a second question after a comma.",
    ...intentCalibration(intent),
    ...(intent === "expand" && parentIntent ? [
      `- This expands a ${parentIntent.replace("_", "-")} reply. Preserve that purpose while adding depth.`,
    ] : []),
    "- Silently check the character range and sentence shapes once before returning only the reply.",
    "- Finish the final sentence completely.",
    "This contract overrides any earlier prompt wording that asks for more messages, detail, examples, or questions.",
  );
  return lines.join("\n");
}

export function resolvePlayerMaxTokens(style: ResponseStyle | undefined, expanded: boolean): number | undefined {
  return expanded ? style?.expanded?.maxOutputTokens ?? style?.maxOutputTokens : style?.maxOutputTokens;
}
