export function hasCommaChainedEnumeration(text: string): boolean {
  const sentences = text.trim().match(/[^.!?]+(?:[.!?]+|$)/gu) ?? [];
  return sentences.some((sentence) => {
    // The style rule permits up to three named items. Split a potential list
    // on commas and its final conjunction, then require four short list-shaped
    // parts. The word ceiling keeps ordinary multi-clause prose from being
    // mislabeled as an enumeration.
    if ((sentence.match(/,/gu) ?? []).length < 2 || !/\b(?:and|or)\b/iu.test(sentence)) return false;
    const parts = sentence
      .replace(/,\s+(?=(?:and|or)\b)/giu, " ")
      .split(/\s*,\s*|\s+(?:and|or)\s+/giu)
      .map((part) => part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim())
      .filter(Boolean);
    if (parts.length < 4) return false;
    const wordCounts = parts.map((part) => part.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)?.length ?? 0);
    // Four actual list items often produce five split parts because the prose
    // before the list stays attached to item one. For exactly four parts,
    // require a compact first item; this avoids treating ordinary clauses plus
    // a three-item phrase ("missing, outdated, or conflicting data") as a
    // four-item enumeration.
    return parts.length >= 5
      ? wordCounts.slice(-4).every((count) => count <= 8)
      : wordCounts[0] <= 4 && wordCounts.slice(1).every((count) => count <= 8);
  });
}

export function deliveredTextMetrics(text: string) {
  const sentenceMatches = text.trim().match(/[^.!?]+(?:[.!?]+|$)/gu) ?? [];
  const sentences = sentenceMatches.map((item) => item.trim()).filter(Boolean);
  const questionCount = (text.match(/\?/gu) ?? []).length;
  const markdown = /(^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+\.\s|```|>\s)|\*\*|__|\[[^\]]+\]\([^)]+\)/u.test(text);
  const sentenceWordCounts = sentences.map((sentence) => sentence.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)?.length ?? 0);
  const questionInFinalSentence = questionCount === 0 || (sentences.length > 0 && !sentences.slice(0, -1).some((sentence) => sentence.includes("?")) && sentences.at(-1)!.includes("?"));
  const asciiPunctuation = !/[\u2013\u2014\u2018\u2019\u201C\u201D\u2026]/u.test(text);
  const singleParagraph = !/[\r\n]|\\[rn]/u.test(text);
  const commaChainedEnumeration = hasCommaChainedEnumeration(text);
  return { characters: text.length, sentences: sentences.length, questionCount, markdown, sentenceWordCounts, maxSentenceWords: Math.max(0, ...sentenceWordCounts), questionInFinalSentence, asciiPunctuation, singleParagraph, commaChainedEnumeration };
}
