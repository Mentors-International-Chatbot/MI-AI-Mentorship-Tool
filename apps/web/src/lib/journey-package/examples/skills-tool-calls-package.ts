import type { JourneyPackageInput } from "../journey-package.schema";

/**
 * Skills & Tool Calls — a one-lesson focus-group course on the player surface.
 *
 * Authored by hand rather than run through the Learn Machine converter, which
 * is AI Essentials-specific: it hardcodes a lesson list and asserts lesson and
 * block counts.
 *
 * Deliberately minimal configuration. There is no `projectSelection`, so the
 * project-setup gate in `learnerHome` and `getLessonDto` returns false; no
 * `onboarding`, so the diagnostic gate never fires; no `outcome`, so there is
 * no capstone; and no `helpRequest`. A participant logs in and lands on block 1.
 *
 * The single tracked dimension exists only because `teach_back.dimensionKey` is
 * required and cross-validated against `config.trackedDimensions`. Block 6 is
 * the one teach_back in the course.
 *
 * Blocks 2 and 3 are ungraded `quiz_checkpoint` blocks: selectable options with
 * no correct answer, which is what an icebreaker is. They carry `graded: false`
 * per question, so no `answerKey` is invented for a question that has none and
 * no V2 grader can later act on fiction. The choice is recorded; nothing is
 * judged, and `BlockProgress.score` stays null rather than reading zero.
 */
export const skillsToolCallsPackage: JourneyPackageInput = {
  schemaVersion: "1.2",
  metadata: {
    packageId: "skills-tool-calls",
    title: "Skills & Tool Calls",
    description: "A one-lesson introduction to AI skills and tool calls, built around a weekly sales report.",
    languages: ["en"],
    version: "2026.5",
    author: { name: "OCI" },
    // Without this the runtime falls back to LEGACY_DELIVERY (chat) and the
    // learner is routed to /chat instead of the player.
    delivery: { surface: "player", supportedChannels: ["web"] },
  },
  config: {
    /**
     * Copied from AI Essentials, which is the only tuned set the platform has.
     *
     * Its absence was not a neutral default: `buildResponseStyleInstruction`
     * and `responseStyleViolations` both return early when `responseStyle` is
     * undefined, so this course shipped with no output contract in the prompt,
     * no validation, no repair loop, and `temperature: 0.7` instead of 0.3.
     * Tutor replies ran to 12+ sentences with Markdown headings that the
     * sanitizer then flattened into run-on prose.
     *
     * `expanded` matters as much as the base numbers: without it an "Explain
     * more" turn has no sentence cap and no token cap at all.
     */
    responseStyle: {
      maxSentences: 3,
      maxOutputTokens: 240,
      markdown: "none",
      maxQuestions: 1,
      expanded: { maxSentences: 6, maxOutputTokens: 480 },
    },
    trackedDimensions: [
      {
        key: "comprehension",
        label: "Understanding of skills and tool calls",
        category: "comprehension",
        primary: true,
        scale: { min: 0, max: 10 },
        calibrationMode: "zero_start",
      },
    ],
    alertRules: [],
  },
  curriculum: {
    collectionKey: "skills-tool-calls",
    lessons: [
      {
        key: "skills-and-tool-calls",
        // Set explicitly: the player renders `category ?? "AI Essentials"` as
        // the header eyebrow, so omitting it labels this course as another one.
        category: "Skills & Tool Calls",
        title: "Skills & Tool Calls",
        keyConcepts: ["skill", "tool-call", "automation"],
        selfCheckQuestions: [],
        blocks: [
          {
            id: "stc-01-welcome",
            order: 1,
            blockType: "teach",
            role: "scenario",
            concepts: [],
            contentVersion: 3,
            presentation: "narrated",
            // The copy asks the learner to introduce themselves, so the control
            // has to offer to send it. Without this the button read "Next" and
            // advancing discarded what they typed.
            expectsResponse: true,
            content: [
              "Welcome to your learning journey.",
              "",
              "Today you'll learn how to use AI Skills and Tool Calls — two things that turn AI from something you re-explain every time into something that just does the job.",
              "",
              "First, introduce yourself to AI Mentor in the box below — your name and what you're studying — then press Next for a couple of quick questions about where you're starting from.",
            ].join("\n"),
          },
          {
            id: "stc-02-skills-poll",
            order: 2,
            blockType: "quiz_checkpoint",
            concepts: ["skill"],
            contentVersion: 2,
            title: "Where you're starting from",
            questions: [{
              id: "stc-q-skills",
              prompt: "What do you know about AI skills?",
              format: "multiple_choice",
              options: ["A lot", "Some", "You mean like basketball skills?"],
              graded: false,
            }],
          },
          {
            id: "stc-03-tool-calls-poll",
            order: 3,
            blockType: "quiz_checkpoint",
            concepts: ["tool-call"],
            contentVersion: 2,
            title: "Where you're starting from",
            questions: [{
              id: "stc-q-tool-calls",
              prompt: "What do you understand about AI tool calls?",
              format: "multiple_choice",
              options: ["A lot", "Some", "No clue"],
              graded: false,
            }],
          },
          {
            id: "stc-04-transition",
            order: 4,
            blockType: "teach",
            role: "explanation",
            concepts: [],
            contentVersion: 1,
            presentation: "narrated",
            content: "Thanks. Now here's a situation where you'd actually need both.",
          },
          {
            id: "stc-05-scenario",
            order: 5,
            blockType: "teach",
            role: "scenario",
            concepts: ["automation"],
            contentVersion: 1,
            presentation: "rendered",
            content: [
              "You're interning at an athletic apparel retailer. Every week you have to build a report for a Monday meeting, and you usually don't get the data until five minutes before it starts.",
              "",
              "The report has to:",
              "",
              "- Pull last week's sales data from a spreadsheet",
              "- Calculate week-over-week growth, top products, and regional breakdowns",
              "- Flag any product whose sales dropped 10% or more",
              "- Format all of it into one output with the same layout, the same chart types, and the same tone every week",
            ].join("\n"),
          },
          {
            id: "stc-06-how-would-you",
            order: 6,
            blockType: "teach_back",
            concepts: ["automation"],
            contentVersion: 1,
            dimensionKey: "comprehension",
            delivery: "inline",
            evaluatesConcepts: ["automation"],
            prompt: "How would you handle this? Type whatever comes to mind. There's no wrong answer yet.",
          },
          {
            id: "stc-07-what-is-a-skill",
            order: 7,
            blockType: "teach",
            role: "explanation",
            concepts: ["skill"],
            contentVersion: 1,
            presentation: "rendered",
            content: [
              "A **skill** is a reusable procedure you save once. It tells the AI exactly how to handle one specific kind of task: the steps, the judgment calls, and any tools it needs.",
              "",
              "It applies automatically when the AI recognizes a matching request, so you don't re-explain the process every time.",
              "",
              "That's what separates it from a one-time instruction. An instruction disappears when the conversation ends. A skill persists and repeats consistently.",
              "",
              "You can also invoke one directly with a slash command.",
            ].join("\n"),
          },
          {
            id: "stc-08-questions-skill",
            order: 8,
            blockType: "quiz_checkpoint",
            concepts: ["skill"],
            contentVersion: 2,
            title: "Check yourself",
            questions: [{
              id: "stc-q-what-is-a-skill",
              prompt: "What is an AI skill?",
              format: "multiple_choice",
              options: [
                "A saved, reusable set of instructions the AI follows whenever it recognizes a matching task",
                "A one-time instruction you give during a conversation",
                "A setting that makes the AI respond faster",
                "A file the AI creates when it finishes a task",
              ],
              answerKey: "A saved, reusable set of instructions the AI follows whenever it recognizes a matching task",
              explanation: "A skill persists. A one-time instruction disappears when the conversation ends.",
              graded: true,
            }],
          },
          {
            id: "stc-09-what-are-tool-calls",
            order: 9,
            blockType: "teach",
            role: "explanation",
            concepts: ["tool-call"],
            contentVersion: 1,
            presentation: "rendered",
            content: [
              "A **tool call** is when the AI reaches outside of writing text and actually does something — looks something up, runs a calculation, or sends information to another app.",
              "",
              "It happens in the moment. The AI decides which action the current step needs, sends the details, and uses the result to keep going.",
              "",
              "Without tool calls, an AI can't check current information, take real actions, or connect to your other systems.",
            ].join("\n"),
          },
          {
            id: "stc-10-questions-tool-calls",
            order: 10,
            blockType: "quiz_checkpoint",
            concepts: ["tool-call"],
            contentVersion: 2,
            title: "Check yourself",
            questions: [{
              id: "stc-q-what-is-a-tool-call",
              prompt: "What is a tool call?",
              format: "multiple_choice",
              options: [
                "When the AI reaches outside of writing text to do something — look something up, run a calculation, or send data to another app",
                "When you ask the AI a question",
                "When the AI saves your instructions for later",
                "When the AI writes code",
              ],
              answerKey: "When the AI reaches outside of writing text to do something — look something up, run a calculation, or send data to another app",
              explanation: "Writing about a calculation is text. Running it is a tool call.",
              graded: true,
            }],
          },
          {
            id: "stc-11-back-to-scenario",
            order: 11,
            blockType: "teach",
            role: "deepening",
            concepts: ["skill", "tool-call"],
            contentVersion: 1,
            presentation: "rendered",
            content: [
              "Now you'll build it yourself. Same problem as before:",
              "",
              "Weekly sales report. Data arrives five minutes before the meeting. Pull the numbers, calculate week-over-week growth, top products, and regional breakdowns, flag anything down 10% or more, and format it the same way every single week.",
              "",
              "The skill handles the process. The tool calls reach into your spreadsheet and produce the output.",
            ].join("\n"),
          },
          {
            id: "stc-12-explain-both",
            order: 12,
            blockType: "teach_back",
            concepts: ["skill", "tool-call"],
            contentVersion: 1,
            dimensionKey: "comprehension",
            delivery: "inline",
            evaluatesConcepts: ["skill", "tool-call"],
            // Placed here rather than after each concept: block 11 has just
            // said the skill handles the process and the tool calls reach the
            // spreadsheet, so asking for both together tests whether the
            // learner connected them. One merged teach-back also keeps the
            // demo to four typed responses instead of six.
            prompt: "In your own words, how do a skill and a tool call work together to produce that weekly report?",
          },
          {
            id: "stc-12-your-turn",
            order: 13,
            blockType: "teach",
            role: "example",
            concepts: ["skill", "tool-call", "automation"],
            contentVersion: 1,
            presentation: "rendered",
            content: [
              "**1. Get the data**",
              "Open this and make your own copy:",
              "https://docs.google.com/spreadsheets/d/1lui72O2qhwXOkg8vHZ2x6SIzW1PFTmpsOWRpDSEiNfg/copy",
              "",
              "**2. Open Claude**",
              "Go to claude.ai. Sign in, or create a free account.",
              "",
              "**3. Turn on code execution**",
              "Settings → enable code execution and file creation. Skills need this.",
              "",
              "**4. Connect Google Drive**",
              "Settings → Connectors → Google Drive → Connect. Approve the permissions.",
              "",
              "**5. Build the skill**",
              "Create a skill that does everything the scenario asks for, using your copy of the sheet.",
              "",
              "**6. Refine it**",
              "Run it. See what's wrong. Adjust the skill and run it again. That iteration is the whole point — you're teaching it your process once so you never explain it again.",
            ].join("\n"),
          },
        ],
      },
    ],
  },
};
