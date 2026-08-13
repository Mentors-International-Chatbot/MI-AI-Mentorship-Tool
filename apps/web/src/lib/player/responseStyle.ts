import type { ResponseStyle } from "@/lib/journey-package/journey-package.schema";
import { deliveredTextMetrics } from "@/lib/player/telemetryMetrics";

export type ResponseStyleViolation =
  | "sentence_limit"
  | "sentence_word_limit"
  | "question_limit"
  | "question_position"
  | "question_focus"
  | "question_not_open"
  | "markdown"
  | "ascii_punctuation"
  | "single_paragraph"
  | "self_reference"
  | "repeated_parent_opening"
  | "repeated_parent_question"
  | "stock_praise"
  | "character_range"
  | "control_marker"
  | "incomplete_ending";

export type StyledPlayerIntent = "question" | "teach_back" | "lesson_entry" | "capstone" | "expand";

const MAX_SENTENCE_WORDS = 35;
const NORMAL_CHARACTER_RANGE = { min: 200, max: 420 };
const EXPANDED_CHARACTER_RANGE = { min: 450, max: 700 };
const STOCK_TEACHBACK_PRAISE = /\b(?:you(?:'ve| have)? nailed|complete shape|right (?:frame|order)|you(?:'ve| have)? (?:named|captured|listed|identified)(?: all| the| this)?|that(?:'s| is) exactly (?:the|right)|you(?:'ve| have) (?:got|mapped) the)\b/iu;

export function finalQuestionHasOneFocus(text: string): boolean {
  const finalSentence = text.trim().match(/[^.!?]*\?(?:["')\]]|\s)*$/u)?.[0];
  if (!finalSentence) return true;
  return !/\b(?:or|versus)\b|,\s+and\s+(?:what|which|how|why|when|where|who)\b|\b(?:what|which|how|why|when|where|who)\b[^?]*\b(?:what|which|how|why|when|where|who)\b/iu.test(finalSentence);
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
  if (style.markdown === "none" && metrics.markdown) violations.push("markdown");
  if (!metrics.asciiPunctuation) violations.push("ascii_punctuation");
  if (!metrics.singleParagraph) violations.push("single_paragraph");
  if (hasTutorSelfIntroduction(deliveredText, personaName)) violations.push("self_reference");
  if (expanded && repeatsParentOpening(parentReply, deliveredText)) violations.push("repeated_parent_opening");
  if (expanded && repeatsParentQuestion(parentReply, deliveredText)) violations.push("repeated_parent_question");
  if ((intent === "teach_back" || (intent === "expand" && parentIntent === "teach_back")) && STOCK_TEACHBACK_PRAISE.test(deliveredText)) violations.push("stock_praise");
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
    ...(violations.includes("repeated_parent_question")
      ? ["Remove the repeated parent question. End with no question or ask one genuinely new focused question."]
      : []),
    ...(violations.includes("stock_praise")
      ? ["Remove stock praise. Respond to the learner's substance in fresh, specific words without saying they nailed, captured, named, or listed everything."]
      : []),
    ...(style.maxQuestions !== undefined
      ? [strict && (violations.includes("question_limit") || violations.includes("question_focus") || violations.includes("question_not_open"))
        ? "Use zero question-mark characters. Turn every question into a statement and do not ask a closing question."
        : `Use no more than ${style.maxQuestions} question-mark character${style.maxQuestions === 1 ? "" : "s"}; remove embedded, rhetorical, yes-no, either-or, and multi-part questions, keeping only one genuinely open focused question.`]
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
        "LESSON ENTRY CALIBRATION:",
        "- Open with the lesson's subject, not a welcome, lesson number, agenda, or description of yourself.",
        "- Give the learner one useful reason the subject matters, then end with one focused question.",
      ];
    case "question":
      return [
        "QUESTION CALIBRATION:",
        "- Answer the learner's actual question in the first sentence. Do not praise the question or defend the curriculum.",
        "- If the learner did not name an industry or project, keep the answer and any example domain-neutral even when the lesson material contains industry examples.",
        "- Do not invent a named job, business, industry, or project as an example when the learner gave none.",
        "- Confusion: state the distinction plainly before asking what remains unclear.",
        "- Job concern: answer honestly; routine work within roles often changes before whole roles disappear.",
        "- Request for help: provide a usable starting point and ask only for the learner-specific input you still need.",
        "- Never withhold a draft because writing it is part of learning. Give the useful starting point first.",
        "- If the learner asks you to write a prompt, do it now. Do not ask for their goal before providing a draft and do not substitute a lecture about prompt construction.",
        "- For 'can you just write the prompt for me,' the first sentence MUST be this usable draft: 'Act as [role]. Using [context], create [output]. A good result [criteria]. Avoid [constraint].' Then ask for only one missing learner-specific detail.",
        "- Failed attempt: identify the two likeliest causes, then ask what input and output they saw.",
        "- Calibration for flat confusion: 'The part that usually trips people up here is the difference between what the model produces and what it knows. Which part is not landing?'",
        "- Calibration for a requested draft: 'I can get you most of the way. Tell me what a correct output must look like, and I will draft around it.'",
      ];
    case "teach_back":
      return [
        "TEACH-BACK CALIBRATION:",
        "- Respond to the learner's specific idea. Avoid stock praise such as 'you nailed it,' 'complete shape,' or 'right order.'",
        "- Do not repeat or re-list what the learner just said. Confirm the substance in fresh words, then deepen one point.",
        "- Do not claim the learner supplied an order, sequence, or every required item unless their message actually did.",
        "- If the learner did not name an industry or project, keep feedback domain-neutral even when the lesson material contains industry examples.",
        "- Do not invent a named job, business, industry, or project as an example when the learner gave none.",
        "- Do not invent a named dataset, inventory, or workplace scenario when the learner gave none. Deepen the concept itself.",
        "- Calibration: 'That covers the full safety chain. The step people often skip is the response plan, because it matters only after something breaks.'",
      ];
    case "capstone":
      return [
        "CAPSTONE CALIBRATION:",
        "- Work from the learner's stated project and evidence. Name one concrete strength or gap without restating the whole submission.",
        "- Ask about one decision only. Do not combine two alternatives or two separate questions into one sentence.",
      ];
    case "expand":
      return [
        "EXPANSION CALIBRATION:",
        "- Continue from the parent reply with genuinely new material. Do not recap, reorder, or paraphrase what the learner just read.",
        "- Go deeper on one useful point instead of broadening into a list.",
        "- Do not repeat the parent's closing question. A question is optional; if used, ask one new thing at the end.",
        "- Prefer no question when the parent already asked one. Spend the extra space on the explanation the learner requested.",
        "- Do not introduce an industry example unless the learner or their project supplied that industry.",
        "- Do not invent a named job, business, or project as an example. Stay conceptual when the learner supplied no setting.",
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
    "- Do not join two complete thoughts with only a comma. Use a period or rewrite the sentence.",
    `- The delivered reply must be ${expanded ? `${EXPANDED_CHARACTER_RANGE.min}-${EXPANDED_CHARACTER_RANGE.max}` : `${NORMAL_CHARACTER_RANGE.min}-${NORMAL_CHARACTER_RANGE.max}`} characters.`,
    "- Use ASCII punctuation only: straight quotes, apostrophes, periods, commas, colons, semicolons, question marks, exclamation marks, and ordinary hyphens. Never use em dashes, en dashes, curly quotes, or the ellipsis character.",
    "- Return one paragraph with no real or escaped newline sequences.",
    "- Never introduce or name yourself. Do not say you are here, glad, excited, happy, the tutor, the mentor, or the guide. The first sentence must be about the subject.",
    "- Answer a direct question or confusion before redirecting or questioning the learner.",
    "- For learner questions and teach-backs, use an industry domain only when the learner or their project introduces it. Do not import a course-authored industry example into a general exchange.",
    "- If you ask a question, it must be the final sentence, genuinely open, and focused on one thing. Never hide two questions behind one question mark or an either-or construction.",
    ...(expanded ? ["- Do not repeat or paraphrase the parent's opening sentence. Start with new material that extends it."] : []),
    ...intentCalibration(intent),
    ...(intent === "expand" && parentIntent ? [
      `- This expands a ${parentIntent.replace("_", "-")} reply. Preserve that purpose while adding depth.`,
    ] : []),
    "- Finish the final sentence completely; never trail off because of the output limit.",
    "This contract overrides any earlier prompt wording that asks for more messages, detail, examples, or questions.",
  );
  return lines.join("\n");
}

export function resolvePlayerMaxTokens(style: ResponseStyle | undefined, expanded: boolean): number | undefined {
  return expanded ? style?.expanded?.maxOutputTokens ?? style?.maxOutputTokens : style?.maxOutputTokens;
}
