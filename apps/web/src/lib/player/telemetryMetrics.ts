export function deliveredTextMetrics(text: string) {
  const sentenceMatches = text.trim().match(/[^.!?]+(?:[.!?]+|$)/gu) ?? [];
  const sentences = sentenceMatches.map((item) => item.trim()).filter(Boolean);
  const questionCount = (text.match(/\?/gu) ?? []).length;
  const markdown = /(^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+\.\s|```|>\s)|\*\*|__|\[[^\]]+\]\([^)]+\)/u.test(text);
  const sentenceWordCounts = sentences.map((sentence) => sentence.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)?.length ?? 0);
  const questionInFinalSentence = questionCount === 0 || (sentences.length > 0 && !sentences.slice(0, -1).some((sentence) => sentence.includes("?")) && sentences.at(-1)!.includes("?"));
  const asciiPunctuation = !/[\u2013\u2014\u2018\u2019\u201C\u201D\u2026]/u.test(text);
  const singleParagraph = !/[\r\n]|\\[rn]/u.test(text);
  return { characters: text.length, sentences: sentences.length, questionCount, markdown, sentenceWordCounts, maxSentenceWords: Math.max(0, ...sentenceWordCounts), questionInFinalSentence, asciiPunctuation, singleParagraph };
}
