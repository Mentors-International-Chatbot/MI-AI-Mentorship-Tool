import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assembleOrderedModelMessages } from "@/lib/ai/modelMessages";
import { assemblePromptLayers } from "../builder";

type Fixture = {
  layers: [string, string, string, string];
  history: Array<{ role: string; content: string }>;
  incomingText: string;
  systemPrompt: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
};

describe("frozen MI model input", () => {
  it("keeps assembled prompt bytes and message order deterministic", () => {
    const fixture = JSON.parse(readFileSync(resolve(__dirname, "../__fixtures__/mi-model-input.json"), "utf8")) as Fixture;
    const systemPrompt = assemblePromptLayers(fixture.layers);
    expect(systemPrompt).toBe(fixture.systemPrompt);
    expect(assembleOrderedModelMessages(systemPrompt, fixture.history, fixture.incomingText)).toEqual(fixture.messages);
  });
});
