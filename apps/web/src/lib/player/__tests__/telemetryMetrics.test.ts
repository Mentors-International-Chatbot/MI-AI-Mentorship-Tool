import { describe, expect, it } from "vitest";
import { deliveredTextMetrics } from "../telemetryMetrics";

describe("delivered player telemetry", () => {
  it("counts characters, sentences, and questions", () => {
    expect(deliveredTextMetrics("One sentence. Another question?")).toEqual({
      characters: 31,
      sentences: 2,
      questionCount: 1,
      markdown: false,
      sentenceWordCounts: [2, 2],
      maxSentenceWords: 2,
      questionInFinalSentence: true,
      asciiPunctuation: true,
      singleParagraph: true,
      commaChainedEnumeration: false,
    });
  });

  it("detects a comma-chained enumeration with four items", () => {
    expect(deliveredTextMetrics("Define the role, task, context, constraints, and output format.").commaChainedEnumeration).toBe(true);
    expect(deliveredTextMetrics("Define the role, task, and output format.").commaChainedEnumeration).toBe(false);
    expect(deliveredTextMetrics("The model cannot create facts from missing, outdated, or conflicting information.").commaChainedEnumeration).toBe(false);
    expect(deliveredTextMetrics("The workflow has five parts. Name the overall shape instead.").commaChainedEnumeration).toBe(false);
  });

  it("detects common Markdown chrome", () => {
    expect(deliveredTextMetrics("- first\n- second").markdown).toBe(true);
    expect(deliveredTextMetrics("Use **care** here.").markdown).toBe(true);
  });
});
