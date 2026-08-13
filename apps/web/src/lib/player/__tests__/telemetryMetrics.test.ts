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
    });
  });

  it("detects common Markdown chrome", () => {
    expect(deliveredTextMetrics("- first\n- second").markdown).toBe(true);
    expect(deliveredTextMetrics("Use **care** here.").markdown).toBe(true);
  });
});
