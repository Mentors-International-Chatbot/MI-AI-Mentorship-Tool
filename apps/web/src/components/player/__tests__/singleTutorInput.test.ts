import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One text input on the lesson player
 * ═══════════════════════════════════════════════════════════════════════════
 * The player used to show two: the `teach_back` block's own textarea with a
 * "Share with AI Mentor" button, and the docked "Ask AI Mentor" box below it.
 * Both posted to `/api/chat` and differed only by `intent`. Two chat boxes on
 * one screen is the complaint the redesign exists to remove, so this pins the
 * shape rather than the styling.
 *
 * A later pass merged that surviving input into the pinned `.player-current`
 * card for every block type that asks the learner for typed text
 * (onboarding_survey, teach_back, requiresResponse), leaving the docked aside
 * only for blocks that don't ask for anything. The single-textarea invariant
 * below now also guarantees that merge: `tutorInputPanel` is written once in
 * the source and referenced from two mutually-exclusive render spots, so
 * there is structurally nowhere for a second box to come from.
 *
 * Asserted against source, not a rendered tree: the app has no component test
 * environment (vitest runs in `node`, and there are no .tsx tests), and adding
 * one to guard a structural rule would cost more than it pins. The same
 * source-reading approach the anchoring-coverage test uses.
 */
const source = readFileSync(
  resolve(process.cwd(), "src/components/player/LessonPlayer.tsx"),
  "utf8",
);

/**
 * `source` with comments removed, for the handful of assertions that must be
 * about what the component *renders* rather than what it explains about
 * itself. Naive stripping — it would eat a `//` inside a string literal, and
 * this file has none — which is checked here rather than assumed.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
it("comment stripping does not eat code", () => {
  expect(source).not.toMatch(/"[^"\n]*\/\//);
  expect(code).toMatch(/export function LessonPlayer/);
  expect(code).toMatch(/<textarea/);
});

describe("lesson player has a single tutor input", () => {
  it("does not generate a lesson opener when the authored lesson mounts", () => {
    const afterThreadLoad = source.slice(source.indexOf("usePlayerThread(course, lessonKey)"), source.indexOf("const current = useMemo"));
    expect(afterThreadLoad).not.toMatch(/api\/chat/);
    expect(afterThreadLoad).not.toMatch(/lesson_entry|Introduce this lesson/);
  });

  it("renders exactly one textarea", () => {
    expect(source.match(/<textarea/g) ?? []).toHaveLength(1);
  });

  it("has no separate teach-back sender", () => {
    expect(source).not.toMatch(/sendTeachBack/);
  });

  it("defines the single input panel once and reuses it, never a second literal input block", () => {
    expect(source.match(/const tutorInputPanel = current \? <>/g) ?? []).toHaveLength(1);
    // Exactly three identifier occurrences once comments are stripped: the
    // definition, the merged-card spot, and the aside spot below. A fourth
    // would be a sign a copy crept back in somewhere.
    expect(code.match(/tutorInputPanel/g) ?? []).toHaveLength(3);
  });

  it("merges the input into the card for every text-answer block type, and only those", () => {
    expect(source).toMatch(/const isTextAnswerBlock = isSurvey \|\| teachingBack \|\| requiresResponse;/);
    expect(source).toMatch(/\{isTextAnswerBlock && !\(isSurvey && submittedComplete\.has\(current\.id\)\) && tutorInputPanel\}/);
  });

  it("keeps the aside only for blocks that don't ask for text, so it never doubles up with the merged input", () => {
    expect(source).toMatch(/\{!boundedMode && !isTextAnswerBlock && <aside className="player-card">/);
  });

  it("leaves onboarding_survey with no input at all once it is submittedComplete, not an empty box", () => {
    // isTextAnswerBlock is true for onboarding_survey regardless of review
    // state, so the exclusion has to be the second, narrower condition — the
    // bug this guards against is a bare <textarea> with nothing else in it.
    const mergedGate = source.slice(
      source.indexOf("{isTextAnswerBlock && !(isSurvey"),
      source.indexOf("{isTextAnswerBlock && !(isSurvey") + "{isTextAnswerBlock && !(isSurvey && submittedComplete.has(current.id)) && tutorInputPanel}".length,
    );
    expect(mergedGate).toContain("isSurvey && submittedComplete.has(current.id)");
  });

  it("derives the tutor intent from the current block instead of the widget", () => {
    expect(source).toMatch(/const teachingBack = current\?\.blockType === "teach_back"/);
    expect(source).toMatch(/teachingBack \? "teach_back" as const : isProjectSubmission \? "project" as const : "question" as const/);
  });

  it("sends the block id on every tutor turn, so the server can count teach-back turns", () => {
    // preparePlayerContext validates the intent/block pairing and computes
    // teachBackTurn itself; the client must not be the source of either.
    expect(source).toMatch(/body: JSON\.stringify\(\{ message: content, context: \{ surface: "player", courseCode: course, lessonKey, blockId, intent \} \}\)/);
  });

  it("derives the teach-back prompt into the thread verbatim, never through a model turn", () => {
    // The prompt is authored block text. Routing it through /api/chat would
    // return a paraphrase of it. Phase 3 replaced the client-side push with
    // derivation from the block body, which is verbatim by construction and
    // survives a refresh; the guarantee under test is unchanged.
    expect(source).toMatch(/content: \(block as TeachBack\)\.prompt/);
    const derivation = source.slice(source.indexOf("const threadItems"), source.indexOf("function onDragEnd"));
    expect(derivation).not.toMatch(/api\/chat/);
  });

  it("renders finished block content from the lesson body, not from stored messages", () => {
    // historyContent returns authored strings only — no generated summary of a
    // block the learner already read.
    expect(source).toMatch(/function historyContent\(block: Block, surveyAnswers\?: Record<string, string>\): string \| null/);
    const helper = source.slice(source.indexOf("function historyContent"), source.indexOf("export function LessonPlayer"));
    expect(helper).not.toMatch(/api\/chat/);
  });
});

/**
 * Pending state on tutor turns
 * ═══════════════════════════════════════════════════════════════════════════
 * Tutor turns run 3.5-5.2s. Before this, `busy` only greyed buttons, which is
 * invisible if the learner's eye is in the thread — the page read as frozen.
 */
describe("tutor turns show a pending indicator", () => {
  it("tracks tutor pending separately from block-completion busy", () => {
    // `busy` also covers completeBlock, which returns in well under a second
    // and needs no indicator.
    expect(source).toMatch(/const \[pending, setPending\] = useState<\{ learnerText\?: string \} \| null>\(null\)/);
  });

  it("sets and clears pending on both functions that reach the tutor", () => {
    // askTutor covers the input, both chips and teach-back submit; explainMore
    // is the second entry point.
    expect(source.match(/setPending\(\{/g) ?? []).toHaveLength(2);
    // Cleared in `finally`, so an error cannot leave it spinning forever.
    expect(source.match(/finally \{ setBusy\(false\); setPending\(null\); \}/g) ?? []).toHaveLength(2);
  });

  it("renders the indicator inside the thread, not at the top of the page", () => {
    const thread = source.slice(source.indexOf('className="player-thread"'), source.indexOf("player-current"));
    expect(thread).toMatch(/player-thinking/);
    expect(thread).toMatch(/aria-live="polite"/);
  });

  it("says something on failure instead of hanging", () => {
    expect(source).toMatch(/tutorError && <div className="player-message is-error" role="alert">/);
    // The learner's text goes back in the box so a failed turn costs nothing.
    expect(source).toMatch(/setQuestion\(content\);/);
  });

  it("disables the input while a turn is in flight", () => {
    expect(source).toMatch(/rows=\{3\} disabled=\{busy\}/);
  });
});

/**
 * Advancing never discards typed text
 * ═══════════════════════════════════════════════════════════════════════════
 * "Advance the lesson" and "send to the mentor" were separate controls in
 * separate places. Block 1's copy invites the learner to introduce themselves;
 * pressing Next on the card above sent nothing and threw the text away.
 */
describe("block advance sends before completing", () => {
  it("routes every primary control through advance(), not complete()", () => {
    expect(source).toMatch(/onClick=\{\(\) => advance\(\{ acknowledged: true \}\)\}/);
    expect(source).toMatch(/onClick=\{\(\) => advance\(answers\)\}/);
    expect(source).toMatch(/onClick=\{\(\) => advance\(order\)\}/);
  });

  it("sends first, awaits, then completes", () => {
    const fn = source.slice(source.indexOf("async function advance("), source.indexOf("async function advanceReviewedBlock"));
    expect(fn).toMatch(/const sent = await askTutor\(\);/);
    expect(fn).toMatch(/await complete\(response\);/);
    expect(fn.indexOf("askTutor")).toBeLessThan(fn.indexOf("await complete"));
  });

  it("aborts the advance when the send fails, rather than discarding by another door", () => {
    const fn = source.slice(source.indexOf("async function advance("), source.indexOf("async function advanceReviewedBlock"));
    expect(fn).toMatch(/if \(!sent\) return;/);
  });

  it("only sends when something was actually typed", () => {
    const fn = source.slice(source.indexOf("async function advance("), source.indexOf("async function advanceReviewedBlock"));
    expect(fn).toMatch(/if \(question\.trim\(\)\)/);
  });

  it("labels the control so the invitation is not contradicted", () => {
    expect(source).toMatch(/function primaryLabel\(typed: string\): string/);
    expect(source).toMatch(/typed\.trim\(\) \? "Send and continue" : "Next"/);
  });
});

/**
 * One control on a block that requires a typed response
 * ═══════════════════════════════════════════════════════════════════════════
 * `expectsResponse` used to be advisory. The card offered "Skip for now" and
 * the input panel offered "Ask a question", and the prominent one was the one
 * that abandoned the interaction, so the way out read as the way forward.
 *
 * The flag now gates advancement. What this pins is the shape: one control, on
 * the input rather than the card, disabled until there is something to send,
 * and a failure-only fallback so a broken tutor is never a locked door.
 */
describe("expectsResponse blocks offer exactly one way forward", () => {
  it("derives the requirement from the block, never from a key or course code", () => {
    expect(source).toMatch(/const requiresResponse = \(current\?\.blockType === "teach" && \(current as Teach\)\.expectsResponse === true\)\s*\|\|\s*\(current\?\.blockType === "project" && \(current as Project\)\.requiresSubmission === true\);/);
    // Asserted against comment-stripped source. The file documents at length
    // why a hardcoded "AIESS" came out of the /api/chat callers, and a test
    // that forbade naming the mistake would forbid explaining it.
    expect(code).not.toMatch(/stc-01|AIESS|SKILLS/);
  });

  it("drops the card's own button on those blocks, so there is no skip", () => {
    // Gated by the outer `!submittedComplete` on the teach branch itself
    // (same as quiz_checkpoint and drag_order), not repeated on the button.
    // Also gated on `pendingInterleave` (C.1) not being open for this block —
    // an orthogonal, later addition that must not reopen this door either.
    expect(source).toMatch(/current\.blockType === "teach" && !submittedComplete\.has\(current\.id\) && pendingInterleave\?\.blockId !== current\.id && <><ReactMarkdown remarkPlugins=\{\[remarkGfm\]\}>\{\(current as Teach\)\.content\}<\/ReactMarkdown>\{!requiresResponse && <button disabled=\{busy\} onClick=\{\(\) => advance\(\{ acknowledged: true \}\)\}>/);
    // No control renders that label any more, on any block. C.1's milestone
    // checkpoint is a deliberately different, always-optional affordance —
    // labeled "Not now" specifically so it doesn't reuse the retired phrase.
    expect(code).not.toMatch(/Skip for now/);
  });

  it("hides the block's own content once reviewed, same as quiz_checkpoint and drag_order", () => {
    // Once `submittedComplete`, the exchange already lives in the thread; the
    // card must not re-show the authored teach content underneath it.
    expect(source).toMatch(/\{current\.blockType === "teach" && !submittedComplete\.has\(current\.id\) && pendingInterleave\?\.blockId !== current\.id && <>/);
  });

  it("puts the single control under the input and disables it while the box is empty", () => {
    expect(source).toMatch(/requiresResponse && !submittedComplete\.has\(current\.id\)\s*\n\s*\? <button disabled=\{busy \|\| !question\.trim\(\)\} onClick=\{\(\) => advance\(\{ acknowledged: true \}\)\}>Send and continue<\/button>/);
  });

  it("leaves blocks without the flag exactly as they were", () => {
    // The ask button keeps its own labels and still routes to askTutor.
    // (E.3.5: guarded by !isSurvey too — onboarding_survey never asks the tutor.)
    expect(source).toMatch(/: !isSurvey && <button disabled=\{busy \|\| !question\.trim\(\)\} onClick=\{\(\) => askTutor\(\)\}>\{teachingBack \? \(teachBackTurn === 1 \? "Share with AI Mentor" : "Send follow-up"\) : "Ask a question"\}<\/button>/);
  });

  it("reveals a fallback only after a send has actually failed twice", () => {
    // (E.3.5: guarded by !isSurvey too — onboarding_survey never calls the
    // tutor, so it has no send-failure fallback to reveal.)
    expect(source).toMatch(/\{requiresResponse && !isSurvey && !submittedComplete\.has\(current\.id\) && sendFailures >= 2 && <button/);
    // complete(), not advance(): advance() would try to send again, which is
    // the thing that is failing.
    expect(source).toMatch(/onClick=\{\(\) => complete\(\{ acknowledged: true \}\)\}>Continue without sending<\/button>/);
  });

  it("counts failures per block and forgets them on success", () => {
    expect(source).toMatch(/setSendFailures\(\(value\) => value \+ 1\);/);
    expect(source).toMatch(/setSendFailures\(0\);\s*\n\s*if \(teachingBack/);
    // Reset on block change, so failures on block 1 cannot unlock block 4.
    // (E.3.5: setSurveyStepIndex now sits between the two — still resets
    // together with them on every block change.)
    expect(source).toMatch(/setTeachBackTurn\(savedTurn === 1 \? 2 : 1\); setSurveyStepIndex\([^)]*\); setSendFailures\(0\);/);
  });
});

/**
 * Teach-back waits for the learner
 * ═══════════════════════════════════════════════════════════════════════════
 * Turn 2 used to complete the block the instant it returned, burying the
 * mentor's closing feedback under the next block — and when that feedback ended
 * in a question, it read as the mentor abandoning its own question.
 *
 * The server still records turn 2 as complete; this is presentation only.
 */
describe("teach-back turn 2 does not auto-advance", () => {
  it("routes turn 2 into the review state, not straight to completed", () => {
    // `submittedComplete` is the same "recorded, still on screen, waiting for
    // Continue" state quiz blocks use.
    expect(source).toMatch(/if \(teachBackTurn === 2\) setSubmittedComplete\(\(value\) => new Set\(value\)\.add\(current\.id\)\);/);
    expect(source).not.toMatch(/if \(teachBackTurn === 2\) setCompleted\(/);
  });

  it("shows the same Continue control every reviewed block uses", () => {
    expect(source).toMatch(/\{submittedComplete\.has\(current\.id\) && <button disabled=\{busy\} onClick=\{advanceReviewedBlock\}>Continue<\/button>\}/);
  });

  it("tells the learner they may keep talking once the exchange is done", () => {
    expect(source).toMatch(/Keep talking with AI Mentor if you want to, or continue when you are ready\./);
  });
});
