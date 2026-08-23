import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A.5 (Platform Restructure Phase A, Stage 5) — the collectionKey fed into
 * the actual AI generation call.
 * ═══════════════════════════════════════════════════════════════════════════
 * Before this fix, handler.ts silently discarded playerContext.collectionKey
 * (enrollment-derived, correct for the course this turn is actually in) and
 * re-derived from socio.curriculumCollectionKey — the single legacy field —
 * for every turn, chat and player alike. Unreachable before the Stage 5 gate
 * flip (the old gate made it impossible to hold a playerContext for a course
 * curriculumCollectionKey didn't already name), but the flip alone would have
 * turned this into a live, silent content mismatch: a multi-enrolled learner
 * granted valid access to course B would receive course A's prompt/lesson
 * context for the actual AI turn.
 *
 * Asserted against source, not a rendered call, for the same reason
 * endsWithQuestionMetadata.test.ts does: handleIncomingMessage pulls in the
 * full player write path (playerRuntimeRepo, alerts, LTI grade queueing,
 * milestone snapshots), and building a faithful mock of all of it to pin one
 * line would cost far more than the line is worth.
 */
const source = readFileSync(resolve(process.cwd(), "src/lib/messaging/handler.ts"), "utf8");

describe("handler.ts collectionKey prefers playerContext over curriculumCollectionKey", () => {
  it("the collectionKey fed into generateAIResponse prefers playerContext.collectionKey", () => {
    expect(source).toMatch(
      /const collectionKey = playerContext\?\.collectionKey \?\? socio\.curriculumCollectionKey;/,
    );
  });

  it("this is the same collectionKey passed to generateAIResponse", () => {
    // Pin that the variable this line assigns is the one actually threaded
    // into generation, not a shadowed or differently-named local.
    const declarationIndex = source.indexOf("const collectionKey = playerContext?.collectionKey ?? socio.curriculumCollectionKey;");
    expect(declarationIndex).toBeGreaterThan(-1);
    const generateCallIndex = source.indexOf("const aiResponse = await generateAIResponse(");
    expect(generateCallIndex).toBeGreaterThan(declarationIndex);
    const callArgs = source.slice(generateCallIndex, source.indexOf(");", generateCallIndex));
    expect(callArgs).toMatch(/generationMessage,\s*\n\s*collectionKey,/);
  });

  it("runPassiveAnalysis (context extraction) receives the same enrollment-derived collectionKey", () => {
    expect(source).toMatch(/collectionKey: playerContext\?\.collectionKey,/);
  });
});
