import type { ResponseStyle } from "@/lib/journey-package/journey-package.schema";

export function buildResponseStyleInstruction(style: ResponseStyle | undefined, expanded: boolean): string {
  if (!style) return "";
  const maxSentences = expanded ? style.expanded?.maxSentences ?? style.maxSentences : style.maxSentences;
  const lines = ["RESPONSE FORMAT FOR THIS LEARNER-VISIBLE TURN:"];
  if (maxSentences !== undefined) lines.push(`- Use at most ${maxSentences} complete sentences.`);
  if (style.maxQuestions !== undefined) lines.push(`- Ask at most ${style.maxQuestions} question${style.maxQuestions === 1 ? "" : "s"}.`);
  if (style.markdown === "none") lines.push("- Use plain text only: no Markdown headings, lists, emphasis, tables, links, or code fences.");
  lines.push("- Finish the final sentence completely; never trail off because of the output limit.");
  return lines.join("\n");
}

export function resolvePlayerMaxTokens(style: ResponseStyle | undefined, expanded: boolean): number | undefined {
  return expanded ? style?.expanded?.maxOutputTokens ?? style?.maxOutputTokens : style?.maxOutputTokens;
}
