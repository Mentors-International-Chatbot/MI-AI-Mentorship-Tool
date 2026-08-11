export function deliveredTextMetrics(text: string) {
  const sentenceMatches = text.trim().match(/[^.!?]+(?:[.!?]+|$)/gu) ?? [];
  const questionCount = (text.match(/\?/gu) ?? []).length;
  const markdown = /(^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+\.\s|```|>\s)|\*\*|__|\[[^\]]+\]\([^)]+\)/u.test(text);
  return { characters: text.length, sentences: sentenceMatches.filter((item) => item.trim()).length, questionCount, markdown };
}
