/**
 * AI Essentials — Aug 2026 refresh
 * ----------------------------------------------------------------------------
 * Authored from `AI_Mentor_Teaching_Essentials_Aug2026_Block_Structure_v1.md`
 * (Michael/Sam's block-structure doc, v1 draft). This is Track E's Stage E.5:
 * both real course content and the acceptance test for the E.1-E.4 palette.
 *
 * Deviations from the doc, all covered in detail in
 * `reports/e5-authoring-findings.md` — summarized here so the deviation is
 * visible right next to the content it affects:
 *
 *   - Block 0.2 (7-question onboarding survey), E.6.1: authored as
 *     `blockType: "onboarding_survey"` (E.3.5), the first block of Lesson 1
 *     (structural placement, not doc-numbering — see block b0-2's own
 *     comment for why). Closing message reflects Q5 back via `{step:q5}`.
 *   - Block 1.4 ("Experience-Gate"), E.5.2: re-authored from `project` to
 *     `teach_back` + `assessment.mode: "reteach_gate"`, threshold 0,
 *     confidenceFloor 0, matching the doc's genuine multi-turn conversation
 *     (3-5 follow-up questions, explicit troubleshooting) — a single-submission
 *     `project` block could not deliver that. See
 *     `reports/e5.2-ungraded-gate-findings.md`.
 *   - Blocks 1.11 and 6.3, E.6.1: reference Q5/Q6 via `{step:q5}`/`{step:q6}`
 *     tokens, resolved cross-lesson at `getLessonDto`-render time
 *     (`resolveCrossLessonAnswers` in `player/service.ts`) — no longer
 *     placeholder-only content. 1.11's diagnostic-performance reference from
 *     the original doc was dropped: 1.11 is a `project` block with no live
 *     conversation, and (confirmed in `reports/e6-learner-context-investigation.md`)
 *     its actual authored text never referenced the diagnostic in the first
 *     place — only Q5. Context injection into a live AI turn (relevant only
 *     to 6.3's `teach_back` conversation) remains deferred, bundled with
 *     E.5.2's closing-message-framing gap into one future `buildAssessmentPrompt.ts`
 *     design pass — see `reports/e6-learner-context-investigation.md`.
 *   - Blocks 1.4 and 6.3 (E.5.2): both ungraded multi-turn reteach_gate
 *     blocks inherit the standard "assessment"-flavored closing-message
 *     framing (`buildAssessmentPrompt.ts`) regardless of `showScoreToLearner`
 *     — a config-flag gap the palette doesn't have yet, reported not fixed.
 *     See `reports/e5.2-ungraded-gate-findings.md`.
 *   - Block 0.3's diagnostic score suppression (E.5.1, resolved after this
 *     stage originally shipped): `baselineDiagnosticSchema` now has
 *     `showScoreToLearner`, defaulting `true` to preserve every existing
 *     course's current behavior; this course sets it `false` explicitly,
 *     per the doc's "score not shown to the learner" — see
 *     `reports/e5-authoring-findings.md` for the gap as originally found.
 * ----------------------------------------------------------------------------
 */
import { journeyPackageSchema, type JourneyPackageInput } from "../journey-package.schema";

export const aiEssentialsAug2026Package: JourneyPackageInput = {
  schemaVersion: "1.2",

  metadata: {
    packageId: "ai-essentials-aug2026",
    title: "AI Essentials",
    description: "A five-lesson course on working with AI well: what it can do, how it works, how to use it right, how to choose a model, and how to build a real tool with it.",
    languages: ["en"],
    // Bumped from "2026.8": importJourneyPackage refuses to re-import over a
    // published/non-draft ProgramVersion (immutability guarantee in
    // import-journey-package.ts) — the l1q4/l1q5 fill_in_blank fix needed a
    // new version string to actually reach the DB.
    // Bumped again from "2026.8.1" for the same reason: b2-6's real video URL.
    // Bumped again from "2026.8.2": capstone project.description framing
    // ("you'll unlock this as you learn it").
    // Bumped again from "2026.8.3": progressPanel.enabled — opts this course
    // into the decoupled lesson-sidebar progress panel.
    // Bumped again from "2026.8.4": that version published before
    // import-journey-package.ts's explicit config field list actually
    // included progressPanel, so it validated but never reached the DB.
    // Bumped again from "2026.8.5": l1q4/l1q5 moved back to fill_in_blank
    // with a word bank, now that the bank exists to fix the underlying
    // grading-strictness problem the multiple_choice workaround sidestepped.
    // Bumped again from "2026.8.6": web_quiz now caps at the default
    // webQuizMaxAttempts (2) instead of retrying indefinitely — affects all
    // five web_quiz blocks (b1-10, b2-8, b3-10, b4-13, b5-8), none of which
    // override it.
    // Bumped again from "2026.8.7": helpRequest.enabled — turns on "Request
    // help from a human", matching the original ai-essentials course.
    version: "2026.8.8",
    author: { name: "Sam", organizationKey: "mentors-international" },
    delivery: { surface: "player", supportedChannels: ["web"] },
    // Block 0.1: authored verbatim, delivered as the thread's first item,
    // never a model turn. Content per the doc's "Content to convey" bullets,
    // written out as continuous prose rather than left as bullet fragments.
    introMessage: {
      en: "Welcome to AI Essentials.\n\nThe future you face is simple: those who don't learn to use AI will be replaced by those who do. This course is here to help you become someone who uses AI well.\n\nThere are five topics: how AI will change your career, what AI actually does under the hood, why most people use it wrong, how to choose between models, and how to build a real tool.\n\nThe final project: you will build a working AI tool that automates part of a real business process. You'll submit it by explaining what you built, how you built it, what it does, and how it uses what you learned here.\n\nYou build the project as you go. Each lesson ends with one piece of it. By the last lesson you'll have a finished tool, not a blank page.\n\nHow this works: mostly conversation. Ask questions any time. Some lessons have quizzes; some ask you to explain concepts back. Both are checks that the teaching landed, not tests to be afraid of.",
    },
  },

  config: {
    aiBehavior: {
      tone: "direct, plainspoken, encouraging without being soft",
      teachingStyle: "conversational teaching in short turns; state hard truths plainly, then give the honest counterweight",
      languageInstruction: "Respond in English. Keep turns to three sentences or fewer unless walking through a worked example.",
    },
    /**
     * Same values as `skills-tool-calls-package.ts`'s `responseStyle`, which
     * that file's own comment says was copied from this course's original
     * (pre-aug2026) package — confirmed still live in the DB for the old
     * `ai-essentials` collection (`ProgramVersion` 1.1.1/1.1.2), whose source
     * file no longer exists in the repo. The aug2026 rewrite dropped it:
     * without `responseStyle`, `buildResponseStyleInstruction` and
     * `responseStyleViolations` both return early (see `responseStyle.ts`),
     * so `languageInstruction`'s "three sentences or fewer" above is prompt
     * wording only — no validation, no repair loop, and `temperature: 0.7`
     * instead of 0.3 (see `ai/service.ts`'s use of `responseStyle` for that).
     * This restores the enforcement without touching `languageInstruction`.
     */
    responseStyle: {
      maxSentences: 3,
      maxOutputTokens: 240,
      markdown: "none",
      maxQuestions: 1,
      expanded: { maxSentences: 6, maxOutputTokens: 480 },
    },
    // "Request help from a human" on the delivery surface. Opt-in per
    // course, matching the original (pre-aug2026) ai-essentials course
    // (see content/ai-essentials-v2-manifest.json's helpRequest key).
    helpRequest: { enabled: true },
    // Lesson-sidebar progress panel (lesson completion, whole-course lesson
    // list, milestones + capstone link — the last two follow from `outcome`
    // below, not from this flag). Opt-in per course; PB&J and
    // skills-tool-calls don't set this yet.
    progressPanel: { enabled: true },
    // Block 0.3. Diagnostic-only for now — the 7-question survey (0.2) is
    // deferred to E.3.5; `mode` stays "baseline_quiz" so the existing,
    // working diagnostic gate runs. Once E.3.5 ships a sequencing mechanism,
    // this becomes a two-part flow per the findings report's recommendation.
    onboarding: {
      mode: "baseline_quiz",
      steps: [],
      diagnostic: {
        id: "aiess-diagnostic",
        title: "Before we start: a quick baseline",
        description: "Six quick questions on where you're starting from. This isn't graded and your score isn't shown — it just helps the tutor pitch things at the right level.",
        threshold: 0.5,
        // E.5.1: baseline, not a judgment, per the doc's block 0.3 — the
        // schema's own default is `true` (preserves existing courses'
        // unconditional score visibility), so this course opts out explicitly.
        showScoreToLearner: false,
        questions: [
          {
            id: "diag-q1", format: "multiple_choice", graded: true,
            prompt: "What is an LLM (large language model)?",
            options: [
              "A program with hand-written rules for every possible question",
              "A model trained on huge amounts of text to predict likely next words",
              "A database that stores and looks up exact facts",
              "A search engine that indexes the live internet",
            ],
            answerKey: "A model trained on huge amounts of text to predict likely next words",
            explanation: "An LLM learns statistical patterns from a training corpus — it predicts what's likely to come next, not from stored facts or hand-written rules.",
            dimensionKey: "prior_knowledge",
          },
          {
            id: "diag-q2", format: "multiple_choice", graded: true,
            prompt: "What is \"training data\"?",
            options: [
              "The questions a user types in during a conversation",
              "The corpus of text (books, websites, docs, and more) a model learns patterns from before it's deployed",
              "A list of correct answers the model checks against in real time",
              "The settings an engineer adjusts to make the model faster",
            ],
            answerKey: "The corpus of text (books, websites, docs, and more) a model learns patterns from before it's deployed",
            explanation: "Training data is the large, mixed corpus a model learns from during training — it's fixed before you ever talk to the model.",
            dimensionKey: "prior_knowledge",
          },
          {
            id: "diag-q3", format: "multiple_choice", graded: true,
            prompt: "Can an AI model \"look things up\" on its own, the way you'd search the web?",
            options: [
              "Yes, always — every model checks the live internet automatically",
              "No — a model can only reach live information if it's given a tool (like search) to call",
              "No, and there is no way to give it access to current information",
              "Only if the question is about a well-known topic",
            ],
            answerKey: "No — a model can only reach live information if it's given a tool (like search) to call",
            explanation: "A model's own knowledge is frozen at training time. It can only find current information by calling an external tool it's been given access to.",
            dimensionKey: "prior_knowledge",
          },
          {
            id: "diag-q4", format: "multiple_choice", graded: true,
            prompt: "What is a \"hallucination\" in the context of AI?",
            options: [
              "A visual glitch in an AI-generated image",
              "When a model states something false or made-up, confidently and fluently",
              "When a model refuses to answer a question",
              "A known bug that only affects older models",
            ],
            answerKey: "When a model states something false or made-up, confidently and fluently",
            explanation: "A hallucination is a confident, fluent, wrong answer. It doesn't look like an error, which is exactly why it's dangerous.",
            dimensionKey: "prior_knowledge",
          },
          {
            id: "diag-q5", format: "multiple_choice", graded: true,
            prompt: "What is a \"prompt\"?",
            options: [
              "The model's internal weights",
              "The instructions and information you give the model to specify a task",
              "A type of AI model built only for chat",
              "An error message the model returns",
            ],
            answerKey: "The instructions and information you give the model to specify a task",
            explanation: "A prompt is your specification for the task — what you want, for whom, in what form, with what constraints.",
            dimensionKey: "prior_knowledge",
          },
          {
            id: "diag-q6", format: "multiple_choice", graded: true,
            prompt: "Are all AI models basically the same?",
            options: [
              "Yes — every model is trained the same way and performs the same",
              "No — models vary widely in size, cost, capability, modality, and whether they're open or proprietary",
              "No — there is only one real AI model and the rest are copies",
              "Yes, aside from the company name on them",
            ],
            answerKey: "No — models vary widely in size, cost, capability, modality, and whether they're open or proprietary",
            explanation: "There are millions of models on the market, differing in size, cost, modality, and openness. \"AI\" is not one product.",
            dimensionKey: "prior_knowledge",
          },
        ],
      },
    },
    trackedDimensions: [
      {
        key: "comprehension",
        label: "Lesson Comprehension",
        category: "comprehension",
        primary: true,
        scale: { min: 0, max: 10 },
        // Real production course, not a toy — mirrors MI's own convention
        // (see pbj-journey-package.ts's comment on this choice) rather than
        // seeding an assumed baseline.
        calibrationMode: "zero_start",
      },
      {
        key: "prior_knowledge",
        label: "Prior AI Knowledge (diagnostic)",
        category: "comprehension",
        primary: false,
        scale: { min: 0, max: 10 },
        calibrationMode: "zero_start",
      },
    ],
    alertRules: [],
    assessment: {
      passing: { dimensionKey: "comprehension", threshold: 7 },
      onMaxTurnsWithoutPass: "complete_with_scores",
      allowRetake: true,
      blocking: true,
      webQuizPassingScore: 0.7,
      // Authoring decision, not dictated by the doc (which only asks to hide
      // the *diagnostic's* score, 0.3) — shown to the learner by default here
      // so quiz/reteach-gate feedback is visible on retries, matching the
      // doc's "grade generously" framing. Flagged in the findings report as
      // a choice, not a requirement, so Michael can override if scores
      // should stay hidden course-wide.
      showScoreToLearner: true,
    },
    dashboard: { panels: [] },
  },

  curriculum: {
    collectionKey: "ai-essentials-aug2026",
    lessons: [
      // ── Lesson 1 ──────────────────────────────────────────────────────────
      {
        key: "lesson-1",
        title: "How will AI impact my job and life?",
        keyConcepts: ["industrial revolutions", "superhuman productivity", "Jevons Paradox", "mental atrophy"],
        selfCheckQuestions: [],
        blocks: [
          {
            // E.6.1: Block 0.2 (onboarding survey). Structurally must live
            // inside some lesson's blocks[] — `onboarding_survey` is a real
            // lessonBlockSchema member, unlike 0.1 (metadata.introMessage)
            // and 0.3 (config.onboarding.diagnostic), which aren't blocks at
            // all. Placed first in Lesson 1 rather than a standalone
            // "lesson-0": a lesson with only this one block would fail
            // lessonSchema's "every lesson needs at least one teach block"
            // refine, and doc numbering (0.1/0.2/0.3) already lives
            // independently of structural lesson placement elsewhere in this
            // file (e.g. b1-4's doc comment), so this follows that precedent
            // rather than inventing a dummy pre-lesson.
            id: "b0-2", order: 1, blockType: "onboarding_survey",
            steps: [
              { id: "q1", field: "preferredName", prompt: "What's your name — what would you like to be called?" },
              { id: "q2", field: "majorAndYear", prompt: "What's your major, and what year are you in school?" },
              { id: "q3", field: "targetRole", prompt: "What job or internship are you aiming for right now or after graduation?" },
              { id: "q4", field: "currentAiUsage", prompt: "How do you use AI right now? (Not at all / occasionally for schoolwork / regularly / I build things with it)" },
              { id: "q5", field: "tediousTask", prompt: "What's one task in a job you've had, or expect to have, that feels repetitive or tedious?" },
              { id: "q6", field: "careerBelief", prompt: "What do you already believe about AI's effect on your future career?" },
              { id: "q7", field: "modelConfidence", prompt: "On a scale of 1-5, how confident are you explaining to someone else how an AI model actually works?" },
            ],
            closingMessage: {
              en: "Got it — so the process your final project will automate is: {step:q5}. Keep that in mind as you go.",
            },
          },
          {
            id: "b1-1", order: 2, blockType: "project",
            requiresSubmission: true, blocking: true,
            content: "**A day in the life of a ____**\n\nDescribe an ordinary workday in the job you're aiming for. What do you actually do all day — list 5-8 concrete tasks, not responsibilities.\n\nThen, mark each task as:\n(A) AI could do this today\n(B) AI could help but not replace\n(C) AI can't touch this.",
            handoff: "No grading here — this is a thinking exercise the whole lesson plays off. I'll relay your list back to you grouped by letter.",
          },
          {
            id: "b1-2", order: 3, blockType: "teach", role: "example",
            content: "Let's start with two concrete demonstrations rather than claims. Suno generates a completely original song from a text prompt. NotebookLM turns a stack of documents into a conversational podcast. The point isn't that these are impressive toys — it's that both do things that required trained professionals two years ago. The capability jump already happened. This isn't a forecast.",
          },
          {
            id: "b1-3", order: 4, blockType: "resource",
            resource: { type: "weblink", url: "https://suno.com", label: "Suno", description: "Prompt it to create a song for you." },
            handoff: "Go try one — Suno or NotebookLM. Spend five minutes. Come back.",
          },
          {
            id: "b1-3b", order: 5, blockType: "resource",
            resource: { type: "weblink", url: "https://notebooklm.google.com", label: "NotebookLM", description: "Link an article on something in your space and have it create a podcast on the material." },
          },
          {
            // E.5.2: re-authored from `project` to `teach_back` + reteach_gate
            // — the doc's "3-5 follow-up questions" and explicit troubleshooting
            // ("if not, ask what problems they ran into and try problem solving")
            // is a genuine multi-turn conversation, which a single-submission
            // `project` block can't deliver. Ungraded: threshold/confidenceFloor
            // both 0 (see passingSchema's confidenceFloor doc for why both are
            // required, not just threshold), showScoreToLearner: false. The
            // closing-message framing still reads as "assessment" language
            // regardless (a separate, reported-not-fixed gap — see
            // reports/e5.2-ungraded-gate-findings.md).
            id: "b1-4", order: 6, blockType: "teach_back",
            prompt: "Ask whether they were able to complete the Suno/NotebookLM experiment without any problems. If they ran into issues, ask what went wrong and help them problem-solve until it works. Then ask what surprised them about AI's ability.",
            dimensionKey: "comprehension",
            evaluatesConcepts: ["hands-on AI experience"],
            assessment: { mode: "reteach_gate", showScoreToLearner: false },
            passingOverride: { dimensionKey: "comprehension", threshold: 0, confidenceFloor: 0, minTurns: 3, maxTurns: 5 },
          },
          {
            id: "b1-5", order: 7, blockType: "teach", role: "explanation",
            content: "Industrial revolutions have happened before — four of them, recognized. Steam power automated textile production. Electricity displaced craftsmen to factories. Computing and the internet took away factory jobs. Robotics and AI take away professionals. Each one replaced entire categories of work and created others. Each one provoked panic similar to what we're experiencing now. Each of the first three took decades to be widely implemented. There's a pattern of each new revolution being adopted quicker than the last — but it's not unlikely that AI will also take years, even decades, to fully reach the industries it will eventually replace.",
          },
          {
            id: "b1-6", order: 8, blockType: "teach", role: "deepening",
            content: "This revolution is different in scope. Previous revolutions automated physical labor and manual occupations. This one targets cognitive workers — analysts, writers, coders, marketers, consultants. The people who were previously safe because they were educated are the ones at risk of displacement this time.",
          },
          {
            id: "b1-7", order: 9, blockType: "teach", role: "explanation",
            content: "With the use of AI, one person is capable — now or soon — of doing the work of three. A company then needs fewer people for the same output. That's superhuman productivity.",
          },
          {
            id: "b1-8", order: 10, blockType: "teach", role: "explanation",
            content: "Jevons Paradox offers a historical silver lining: when efficiency rises, consumption often rises faster. Cheaper steam engines meant more coal used, not less. As lighting efficiency rose from candles to LEDs, the price fell 3,000 times while total consumption rose 40,000 times higher. Computing gets more efficient every year, and 95% of US households now have a computer. If AI analysis becomes cheap, organizations may demand far more analysis. The work doesn't vanish — it changes shape and expands.",
          },
          {
            id: "b1-9", order: 11, blockType: "teach", role: "question",
            content: "Physical labor-saving led to physical atrophy — which is why gyms became popular. Few people lifted weights for fun in 1850; they had jobs that did it for them. Now extend the pattern: if AI saves mental labor, what atrophies? Mental labor-saving leads to mental atrophy — leads to what? I don't have a tidy answer for you here. Sit with it.",
          },
          {
            id: "b1-10", order: 12, blockType: "quiz_checkpoint",
            title: "Lesson 1 check",
            assessment: { mode: "web_quiz" },
            questions: [
              { id: "l1q1", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "What makes this industrial revolution different in scope from the previous three?", options: ["It happened faster than the others", "It targets cognitive work, not just physical/manual work", "It only affects one country", "It doesn't create any new jobs"], answerKey: "It targets cognitive work, not just physical/manual work", explanation: "Previous revolutions automated physical/manual labor; this one targets cognitive workers — the people previously considered safe because they were educated." },
              { id: "l1q2", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "What does Jevons Paradox predict?", options: ["Efficiency gains always reduce total consumption", "Rising efficiency often makes total consumption rise even faster", "AI will have no economic effect", "Only physical goods are subject to it"], answerKey: "Rising efficiency often makes total consumption rise even faster", explanation: "As something gets cheaper/more efficient to produce, demand for it often rises faster than the efficiency gain — total consumption goes up, not down." },
              { id: "l1q3", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "Which category of work is most exposed by this revolution, per the lesson?", options: ["Manual labor", "Cognitive knowledge work", "Agricultural work", "Skilled trades requiring physical dexterity"], answerKey: "Cognitive knowledge work", explanation: "This revolution targets cognitive workers — analysts, writers, coders, marketers, consultants." },
              // Moved back to fill_in_blank now that a word bank exists
              // (QuizQuestionField.tsx / journey-package.schema.ts's
              // `wordBank`). These were originally fill_in_blank; a
              // correct-in-spirit paraphrase ("gyms became popular") was
              // graded wrong because gradeQuizQuestion's fill_in_blank branch
              // only normalizes and compares against the literal answerKey
              // strings — no room for a learner restating the idea in their
              // own words. That was worked around by converting to
              // multiple_choice, which sidesteps free-text grading entirely
              // rather than fixing the underlying match. A word bank fixes it
              // at the root instead: the learner picks rather than types, so
              // the submitted answer is always one of these exact strings —
              // paraphrase mismatch cannot occur — while the question still
              // reads and behaves as a completion, not a multiple-choice pick
              // among four unrelated distractors.
              { id: "l1q4", format: "fill_in_blank", graded: true, dimensionKey: "comprehension", prompt: "Complete the atrophy analogy: physical labor-saving → physical atrophy → ____.", answerKey: "Gyms", wordBank: ["Gyms", "Home cooking", "Public transit", "Reading"], explanation: "Physical labor-saving led to physical atrophy, which is why gyms became popular." },
              // Shortened from the original multiple_choice option's full
              // sentence to a blank-shaped phrase — a word bank chip reading
              // a whole sentence doesn't read as completing "____."
              { id: "l1q5", format: "fill_in_blank", graded: true, dimensionKey: "comprehension", prompt: "Complete the parallel: mental labor-saving → mental atrophy → ____.", answerKey: "no settled answer yet", wordBank: ["no settled answer yet", "complete loss of critical thinking", "widespread laziness", "a return to physical labor"], explanation: "This is deliberately left open in the lesson — there's no settled answer yet for what mental atrophy leads to." },
              {
                id: "l1q6", format: "matching", graded: true, dimensionKey: "comprehension",
                prompt: "Match each revolution to the work it primarily displaced.",
                options: ["Automated textile production", "Displaced craftsmen to factories", "Took away factory jobs", "Takes away professional work"],
                matchingPrompts: [
                  { id: "steam", text: "Steam Power" },
                  { id: "electricity", text: "Electricity" },
                  { id: "computing", text: "Computing and the internet" },
                  { id: "robotics_ai", text: "Robotics and AI" },
                ],
                answerKey: { steam: "Automated textile production", electricity: "Displaced craftsmen to factories", computing: "Took away factory jobs", robotics_ai: "Takes away professional work" },
                explanation: "Each revolution displaced a different category of work, in sequence: textile production, craftsmen, factory jobs, and now professional/cognitive work.",
              },
            ],
          },
          {
            // E.6.1: {step:q5} resolved cross-lesson from block b0-2's
            // accumulated answers, via resolveCrossLessonAnswers
            // (player/service.ts). Sentence is written to stay grammatical
            // if the fallback phrase substitutes instead of a real answer.
            id: "b1-11", order: 13, blockType: "project",
            requiresSubmission: true, blocking: true,
            content: "**Your gameplan, and your project process** — Milestone 1\n\nTwo parts:\n\n1. Gameplan: given everything in this lesson, what are three specific things you'll do in the next two years to be someone AI makes more valuable rather than less? Concrete — \"learn to prompt well\" is not concrete.\n2. Your project process: name the specific business process your AI tool will automate. Start from what you told us about {step:q5} and the task list in 1.1. One paragraph: what the process is, who does it now, and why it's tedious enough to be worth automating.\n\nPart 2 is the milestone. Everything downstream builds on this one paragraph.",
          },
          {
            id: "b1-12", order: 14, blockType: "teach_back",
            prompt: "Explain it back, in your own words: (1) why this industrial revolution differs from the previous ones, (2) what Jevons Paradox implies for your career, (3) what \"mental atrophy\" might mean in practice.",
            dimensionKey: "comprehension",
            evaluatesConcepts: ["industrial revolutions", "Jevons Paradox", "mental atrophy"],
            assessment: { mode: "reteach_gate" },
            passingOverride: { dimensionKey: "comprehension", threshold: 7, maxTurns: 5 },
          },
        ],
      },

      // ── Lesson 2 ──────────────────────────────────────────────────────────
      {
        key: "lesson-2",
        title: "What does AI do, and what does it not do?",
        keyConcepts: ["expert systems", "machine learning", "backpropagation", "hallucination"],
        selfCheckQuestions: [],
        blocks: [
          {
            id: "b2-1", order: 1, blockType: "project",
            requiresSubmission: true, blocking: true,
            content: "**Explain it to your CEO**\n\nBefore your company puts AI into a critical process, your CEO wants a high-level explanation of how these models actually work. Write your best explanation right now, before this lesson teaches you anything. 4-6 sentences.",
            handoff: "You'll compare this against what you actually learn, later in this lesson.",
          },
          {
            id: "b2-2", order: 2, blockType: "teach", role: "explanation",
            content: "Two fundamentally different approaches. Expert systems: humans write down rules, the machine follows them. Machine learning: the machine derives patterns from data. Where does each get its \"knowledge\"? Expert systems get it from experts. ML gets it from a corpus.",
          },
          {
            id: "b2-3", order: 3, blockType: "teach", role: "deepening",
            content: "The training corpus is a hodgepodge — books, websites, forums, documentation, arguments, marketing copy, and a great deal of nonsense. Do we trust that hodgepodge? The answer isn't \"no,\" it's \"it depends on what you're asking it for, and you need to know why.\"",
          },
          {
            id: "b2-4", order: 4, blockType: "teach", role: "explanation",
            content: "ML's objective is finding patterns in the corpus. Not understanding, not truth-seeking — pattern detection. Everything else follows from this.",
          },
          {
            id: "b2-5", order: 5, blockType: "teach", role: "explanation",
            content: "The method is backpropagation: prediction, error measurement, weight adjustment, repeat — millions of times. Conceptually, that's the whole loop. You don't need the math to understand it; you need to be able to explain the loop.",
          },
          {
            id: "b2-6", order: 6, blockType: "resource",
            resource: {
              type: "weblink",
              url: "https://youtu.be/LPZh9BOjkQs",
              label: "3Blue1Brown: Large Language Models explained briefly",
              description: "A visual walkthrough of how LLMs actually work — ties directly into the training-loop and pattern-detection ideas from this lesson.",
            },
          },
          {
            id: "b2-7", order: 7, blockType: "teach", role: "explanation",
            content: "What ML does well: mimicking grammatical patterns and logical structures in its corpus. Output sounds excellent — fluent, confident, well-organized. What it does badly: distinguishing truth from hallucination. Fluency and accuracy are separate properties, and the model has no internal signal for which is which. This is why AI errors are dangerous — they don't look like errors.",
          },
          {
            id: "b2-8", order: 8, blockType: "quiz_checkpoint",
            title: "Lesson 2 check",
            assessment: { mode: "web_quiz" },
            questions: [
              { id: "l2q1", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "Where does an expert system's \"knowledge\" come from, versus an ML model's?", options: ["Both come from the same place: a training corpus", "Expert systems: human-written rules from experts. ML: patterns derived from a data corpus", "Expert systems: a data corpus. ML: hand-written rules", "Neither has a real source of knowledge"], answerKey: "Expert systems: human-written rules from experts. ML: patterns derived from a data corpus", explanation: "Expert systems encode explicit rules from human experts; ML models derive statistical patterns from a training corpus." },
              { id: "l2q2", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "What is ML's actual objective?", options: ["Truth-seeking", "Pattern detection", "Fact verification", "Rule enforcement"], answerKey: "Pattern detection", explanation: "ML's objective is finding patterns in the corpus — not understanding, not truth-seeking." },
              { id: "l2q3", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "Why are hallucinations difficult to detect?", options: ["The model flags them automatically but users ignore the flag", "Fluency and accuracy are separate properties — a wrong answer can sound just as confident as a right one", "Hallucinations only happen in older models", "They only occur on math questions"], answerKey: "Fluency and accuracy are separate properties — a wrong answer can sound just as confident as a right one", explanation: "The model has no internal signal distinguishing a fluent-but-wrong answer from a fluent-and-right one — that's exactly why hallucinations are dangerous." },
              { id: "l2q4", format: "fill_in_blank", graded: true, dimensionKey: "comprehension", prompt: "Complete the training loop: predict → measure ____ → adjust ____.", answerKey: ["error, weights", "error weights"], explanation: "The loop is: predict, measure the error, adjust the weights, repeat." },
              {
                id: "l2q5", format: "drag_to_order", graded: true, dimensionKey: "comprehension",
                prompt: "Put the steps of one training iteration in order.",
                options: ["Model makes a prediction", "Error is measured against the correct answer", "Weights are adjusted to reduce the error", "The loop repeats on the next example"],
                answerKey: ["Model makes a prediction", "Error is measured against the correct answer", "Weights are adjusted to reduce the error", "The loop repeats on the next example"],
                explanation: "This is backpropagation's loop: predict, measure the error, adjust the weights, repeat — millions of times.",
              },
              {
                id: "l2q6", format: "drag_to_order", graded: true, dimensionKey: "comprehension",
                prompt: "Put the steps of inference (using a trained model) in order.",
                options: ["A prompt is given to the model", "The model applies its learned patterns to the input", "The model produces an output", "The output is returned to the user"],
                answerKey: ["A prompt is given to the model", "The model applies its learned patterns to the input", "The model produces an output", "The output is returned to the user"],
                explanation: "Inference is the trained model applying what it learned during training to a new input, in one forward pass — no weight adjustment happens here.",
              },
              {
                id: "l2q7", format: "matching", graded: true, dimensionKey: "comprehension",
                prompt: "Match each failure mode to the stage where it originates.",
                options: ["Corpus contains bad/contradictory information", "Model has no way to distinguish fluent-wrong from fluent-right", "A live fact changed since training"],
                matchingPrompts: [
                  { id: "training_data_quality", text: "Training data quality" },
                  { id: "hallucination", text: "Hallucination" },
                  { id: "staleness", text: "Outdated knowledge" },
                ],
                answerKey: { training_data_quality: "Corpus contains bad/contradictory information", hallucination: "Model has no way to distinguish fluent-wrong from fluent-right", staleness: "A live fact changed since training" },
                explanation: "Each failure mode traces back to a different stage: what went into the corpus, how the model generates output, and the fact that training data has a cutoff.",
              },
            ],
          },
          {
            id: "b2-9", order: 9, blockType: "project",
            requiresSubmission: true, blocking: true,
            content: "**Diagram it, then find where yours breaks** — Milestone 2\n\nTwo parts:\n\n1. Diagram the steps of ML training and inference, and mark at each step where it could fail. A text description is fine — describe the steps in order with a failure noted at each.\n2. For your project: name two specific ways your AI tool could produce a confidently wrong output, and what a user would see when it happens.\n\nThen re-read your CEO explanation from 2.1. In one sentence: what would you change?",
          },
          {
            id: "b2-10", order: 10, blockType: "teach_back",
            prompt: "Explain expert systems vs. ML, what backpropagation does, and why a hallucination is hard to catch — as if teaching a classmate who missed the lesson.",
            dimensionKey: "comprehension",
            evaluatesConcepts: ["expert systems", "machine learning", "backpropagation", "hallucination"],
            assessment: { mode: "reteach_gate" },
            passingOverride: { dimensionKey: "comprehension", threshold: 7, maxTurns: 5 },
          },
        ],
      },

      // ── Lesson 3 ──────────────────────────────────────────────────────────
      {
        key: "lesson-3",
        title: "People use AI incorrectly (a model is not a system)",
        keyConcepts: ["prompting", "context", "tool calls", "skills", "harness"],
        selfCheckQuestions: [],
        blocks: [
          {
            id: "b3-1", order: 1, blockType: "project",
            requiresSubmission: true, blocking: true,
            content: "**What went wrong here?**\n\nHere's a real, bad AI exchange: someone types \"write our Q3 marketing plan\" into a chatbot and gets back a generic, confident, useless page of platitudes.\n\nWhat's wrong with this exchange? What would you change before showing the output to your manager? List everything you'd fix.",
          },
          {
            id: "b3-2", order: 2, blockType: "teach", role: "explanation",
            content: "A prompt is a specification. Vague specification, vague output. The shift you need to make: stop asking a question, start describing a task — what you want, for whom, in what form, with what constraints.",
          },
          {
            id: "b3-3", order: 3, blockType: "teach", role: "explanation",
            content: "The first output is a draft, not an answer. Professionals iterate — critique the output, feed the critique back, refine. One-shot prompting is the single most common mistake.",
          },
          {
            id: "b3-4", order: 4, blockType: "teach", role: "explanation",
            content: "Some models answer immediately; some work through a problem in steps before answering. Reasoning costs more — time and money — but does better on hard problems. Know when each is appropriate.",
          },
          {
            id: "b3-5", order: 5, blockType: "teach", role: "explanation",
            content: "The model knows nothing about your company, your data, or your situation unless you put it in the context window. Context is what turns a generic assistant into a useful one — this is exactly what the Q3 marketing plan prompt was missing.",
          },
          {
            id: "b3-6", order: 6, blockType: "teach", role: "explanation",
            content: "Models are bad at arithmetic and can't access live data — but they can call tools that are good at both. A model that calls a calculator gets the math right. A model that calls a search API gets current data. \"AI can't do math\" is outdated.",
          },
          {
            id: "b3-7", order: 7, blockType: "teach", role: "explanation",
            content: "Skills are reusable packaged instructions the model can load when relevant — a repeatable procedure rather than re-explaining every time. (This is what the SKILLS course teaches in depth — brief here on purpose.)",
          },
          {
            id: "b3-8", order: 8, blockType: "teach", role: "deepening",
            content: "The harness is everything wrapped around the model: what it's allowed to do, what it's given, how its output is checked, what happens when it fails. The harness is where most of the engineering actually lives. The model is one component inside a system, and the system is what people build.",
          },
          {
            id: "b3-9", order: 9, blockType: "resource",
            resource: { type: "weblink", url: "https://www.databricks.com/blog/ai-harness", label: "Databricks — \"AI harness\"" },
          },
          {
            id: "b3-9b", order: 10, blockType: "resource",
            resource: { type: "weblink", url: "https://docs.langchain.com/oss/python/langchain/agents", label: "LangChain agents" },
          },
          {
            id: "b3-10", order: 11, blockType: "quiz_checkpoint",
            title: "Lesson 3 check",
            assessment: { mode: "web_quiz" },
            questions: [
              { id: "l3q1", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "What does context do for a prompt?", options: ["Nothing — the model already knows about your company", "Turns a generic assistant into a useful one, by giving it the specifics it can't otherwise know", "Only matters for very long prompts", "Replaces the need for a clear prompt"], answerKey: "Turns a generic assistant into a useful one, by giving it the specifics it can't otherwise know", explanation: "The model knows nothing about your company or situation unless it's in the context window — that's what context supplies." },
              { id: "l3q2", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "When does a reasoning model beat an instant-answer model?", options: ["Always — reasoning models are strictly better", "Never — reasoning is a marketing term with no real effect", "On hard problems, where the extra time/cost buys a better answer", "Only for creative writing tasks"], answerKey: "On hard problems, where the extra time/cost buys a better answer", explanation: "Reasoning costs more time and money, and that cost buys better results specifically on hard problems." },
              { id: "l3q3", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "Why do tool calls fix \"AI can't do math\"?", options: ["They don't — models still can't do math", "A model can call a calculator (or other tool) that's actually good at the task instead of doing it itself", "Tool calls only work for search, not math", "Newer models memorize more arithmetic"], answerKey: "A model can call a calculator (or other tool) that's actually good at the task instead of doing it itself", explanation: "A model that calls a calculator gets the math right — it's delegating to a tool built for the job, not doing arithmetic itself." },
              { id: "l3q4", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "What is the harness responsible for?", options: ["Nothing — it's just a UI wrapper", "What the model is allowed to do, what it's given, how its output is checked, and what happens on failure", "Only formatting the model's output", "Training the model"], answerKey: "What the model is allowed to do, what it's given, how its output is checked, and what happens on failure", explanation: "The harness is everything wrapped around the model — permissions, inputs, output checking, failure handling. Most of the engineering lives here." },
              { id: "l3q5", format: "fill_in_blank", graded: true, dimensionKey: "comprehension", prompt: "Turn this weak prompt into a specified one by filling in the blank: \"Write a marketing plan\" becomes \"Write a Q3 marketing plan for ____ [audience], in [form], with [constraints].\"", answerKey: ["a specific audience", "the target audience", "our target customer"], explanation: "A specified prompt names who it's for, what form it should take, and what constraints apply — the exact things the weak version left out." },
              { id: "l3q6", format: "fill_in_blank", graded: true, dimensionKey: "comprehension", prompt: "The single most common prompting mistake is treating the first output as an answer instead of a ____.", answerKey: ["draft"], explanation: "The first output is a draft, not an answer — professionals iterate on it." },
              {
                id: "l3q7", format: "drag_to_order", graded: true, dimensionKey: "comprehension",
                prompt: "Order the parts of a well-formed prompt, from most foundational to most specific.",
                options: ["What you want done", "Who it's for", "What form the output should take", "What constraints apply"],
                answerKey: ["What you want done", "Who it's for", "What form the output should take", "What constraints apply"],
                explanation: "A specified prompt builds from the core task outward: what you want, who it's for, what shape the output takes, and what bounds it.",
              },
              {
                id: "l3q8", format: "drag_to_order", graded: true, dimensionKey: "comprehension",
                prompt: "Order a request's path through a harness.",
                options: ["Request arrives with permitted context", "Model produces output (possibly calling a tool)", "Output is checked against rules", "Approved output is returned; failures are escalated or blocked"],
                answerKey: ["Request arrives with permitted context", "Model produces output (possibly calling a tool)", "Output is checked against rules", "Approved output is returned; failures are escalated or blocked"],
                explanation: "The harness wraps the model on both sides: it controls what comes in, what the model can call, what leaves, and what happens on failure.",
              },
              {
                id: "l3q9", format: "matching", graded: true, dimensionKey: "comprehension",
                prompt: "Match each failure to the component that fixes it.",
                options: ["Tool calls (e.g. a calculator)", "Tool calls (e.g. a search API)", "Context", "The harness"],
                matchingPrompts: [
                  { id: "wrong_math", text: "Wrong math" },
                  { id: "outdated_fact", text: "Outdated fact" },
                  { id: "generic_output", text: "Generic output" },
                  { id: "unsafe_action", text: "Unsafe action" },
                ],
                answerKey: { wrong_math: "Tool calls (e.g. a calculator)", outdated_fact: "Tool calls (e.g. a search API)", generic_output: "Context", unsafe_action: "The harness" },
                explanation: "Each failure mode has a matching fix: calculators fix math, search fixes staleness, context fixes genericness, and the harness is what blocks or escalates unsafe actions.",
              },
            ],
          },
          {
            id: "b3-11", order: 12, blockType: "project",
            requiresSubmission: true, blocking: true,
            content: "**Design your tool's system** — Milestone 3\n\nFor the tool you're building, specify:\n\n1. The main prompt it will use — write it out, specified not vague\n2. What context it needs to do its job well, and where that context comes from\n3. Any tools it needs to call (calculator, search, database, email, calendar...)\n4. One guardrail: something it should refuse or escalate rather than attempt\n\nThis is the design document for your build. It should be concrete enough to work from.",
          },
          {
            id: "b3-12", order: 13, blockType: "teach_back",
            prompt: "Why isn't a model by itself a useful product? What does context add? Why do tool calls matter? Then: describe the system you designed and why each piece is there.",
            dimensionKey: "comprehension",
            evaluatesConcepts: ["prompting", "context", "tool calls", "harness"],
            assessment: { mode: "reteach_gate" },
            passingOverride: { dimensionKey: "comprehension", threshold: 7, maxTurns: 6 },
          },
        ],
      },

      // ── Lesson 4 ──────────────────────────────────────────────────────────
      // Authored as one lesson per the doc's own draft (not preemptively
      // split into two, per instruction). See findings report for whether it
      // should be split once played.
      {
        key: "lesson-4",
        title: "All AI models are not created equal",
        keyConcepts: ["model landscape", "modality", "open vs. proprietary", "cost drivers", "context windows", "fine-tuning"],
        selfCheckQuestions: [],
        blocks: [
          {
            id: "b4-1", order: 1, blockType: "project",
            requiresSubmission: true, blocking: true,
            content: "**The internship assignment**\n\nYou're an intern tasked with building an AI tool that responds to customer inquiries. Your manager needs a budget forecast and a justification for which AI model you'll use. Write your first instinct right now — which model would you pick and why? 3-4 sentences.",
            handoff: "You'll revisit this at the end of the lesson.",
          },
          {
            id: "b4-2", order: 2, blockType: "teach", role: "explanation",
            content: "How many models are there? Roughly three million on Hugging Face. The mental model of \"AI = ChatGPT\" is the first thing to break. There is a vast and varied market.",
          },
          {
            id: "b4-3", order: 3, blockType: "resource",
            resource: { type: "weblink", url: "https://huggingface.co/models", label: "Hugging Face model hub", description: "Go look at the actual scale of it." },
          },
          {
            id: "b4-4", order: 4, blockType: "teach", role: "explanation",
            content: "LLM vs. multimodal: text-only models versus models that handle images, audio, and video. Which your use case actually needs — and the cost of paying for capability you don't use.",
          },
          {
            id: "b4-5", order: 5, blockType: "teach", role: "explanation",
            content: "Proprietary vs. open source: closed models via API versus open-weight models you can run yourself. Trade-offs: cost structure, data privacy, control, capability ceiling. \"Free\" open models aren't free — you pay in infrastructure and effort.",
          },
          {
            id: "b4-6", order: 6, blockType: "teach", role: "explanation",
            content: "Small, big, and humongous: model size versus capability versus cost. The instinct to always reach for the biggest model is usually wrong — most production tasks run fine on small models at a fraction of the price.",
          },
          {
            id: "b4-7", order: 7, blockType: "teach", role: "explanation",
            content: "What you actually pay for: three cost drivers — input tokens, reasoning tokens, output tokens. Reasoning models cost substantially more because they generate large amounts of intermediate thinking you never see. This is the single most practical thing in the course for anyone building something real.",
          },
          {
            id: "b4-8", order: 8, blockType: "teach", role: "explanation",
            content: "Context windows: how much is enough? What a context window is, what happens when you exceed it, and why bigger isn't automatically better — cost scales, and models can lose the middle of very long contexts.",
          },
          {
            id: "b4-9", order: 9, blockType: "teach", role: "explanation",
            content: "Distilled and quantized models: two ways to make a model smaller and cheaper. Distillation trains a small model to imitate a big one; quantization reduces numerical precision. What you gain, what you give up.",
          },
          {
            id: "b4-10", order: 10, blockType: "teach", role: "explanation",
            content: "Foundation vs. specialized, and fine-tuning vs. system prompts: general-purpose foundation models versus models specialized for a domain. When you need specialized behavior, do you fine-tune (expensive, powerful, slow) or write a good system prompt (cheap, fast, usually sufficient)? Default to the system prompt. Most people reach for fine-tuning far too early.",
          },
          {
            id: "b4-11", order: 11, blockType: "teach", role: "explanation",
            content: "Model aggregators — OpenRouter and similar: one API, many models, easy switching. Why this matters: your model choice isn't permanent, and you can test alternatives cheaply.",
          },
          {
            id: "b4-12", order: 12, blockType: "resource",
            resource: { type: "weblink", url: "https://openrouter.ai", label: "OpenRouter", description: "Look at the model list and compare per-token prices across three models you recognize." },
          },
          {
            id: "b4-13", order: 13, blockType: "quiz_checkpoint",
            title: "Lesson 4 check",
            assessment: { mode: "web_quiz" },
            questions: [
              { id: "l4q1", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "Which cost driver dominates for a reasoning model?", options: ["Input tokens only", "Reasoning tokens — the intermediate thinking you never see", "Output tokens only", "There is no meaningful difference in cost drivers"], answerKey: "Reasoning tokens — the intermediate thinking you never see", explanation: "Reasoning models generate a large amount of intermediate thinking that you're billed for but never see — that's what makes them cost substantially more." },
              { id: "l4q2", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "When does open source tend to beat proprietary?", options: ["Never — proprietary is always better", "When control, data privacy, or long-run cost structure matter more than paying in infrastructure/effort", "Only for text-only use cases", "Open source is always cheaper with no tradeoffs"], answerKey: "When control, data privacy, or long-run cost structure matter more than paying in infrastructure/effort", explanation: "Open-weight models trade API cost for infrastructure/effort cost — worth it when control, privacy, or cost structure matter enough." },
              { id: "l4q3", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "What does quantization trade away?", options: ["Nothing — it's a pure win", "Some numerical precision, in exchange for a smaller, cheaper model", "The model's entire training corpus", "Its ability to call tools"], answerKey: "Some numerical precision, in exchange for a smaller, cheaper model", explanation: "Quantization reduces numerical precision to make a model smaller and cheaper — a real tradeoff, not a free win." },
              { id: "l4q4", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "A team needs a chatbot to handle a narrow, well-defined support task. Fine-tune or write a system prompt?", options: ["Always fine-tune first", "Default to a system prompt — cheap and fast, usually sufficient; reach for fine-tuning only if that's not enough", "Neither will work", "Only fine-tuning is technically possible for this"], answerKey: "Default to a system prompt — cheap and fast, usually sufficient; reach for fine-tuning only if that's not enough", explanation: "Default to the system prompt. Most people reach for fine-tuning far too early — it's expensive, powerful, and slow." },
              { id: "l4q5", format: "fill_in_blank", graded: true, dimensionKey: "comprehension", prompt: "Name the three cost drivers: input tokens, ____ tokens, output tokens.", answerKey: ["reasoning"], explanation: "The three cost drivers are input tokens, reasoning tokens, and output tokens." },
              { id: "l4q6", format: "fill_in_blank", graded: true, dimensionKey: "comprehension", prompt: "\"Free\" open models aren't free — you pay in ____ and effort.", answerKey: ["infrastructure"], explanation: "Open-weight models shift the cost from an API bill to infrastructure and effort." },
              {
                id: "l4q7", format: "drag_to_order", graded: true, dimensionKey: "comprehension",
                prompt: "Order these models roughly by cost for a simple classification workload, cheapest first.",
                options: ["A small, quantized model", "A mid-size general model", "A large reasoning model"],
                answerKey: ["A small, quantized model", "A mid-size general model", "A large reasoning model"],
                explanation: "Cost scales with size and reasoning: a small quantized model is cheapest, a large reasoning model is most expensive, for the same simple task.",
              },
              {
                id: "l4q8", format: "drag_to_order", graded: true, dimensionKey: "comprehension",
                prompt: "Order the steps of choosing a model for a real task.",
                options: ["Define the task and required modality", "Estimate expected volume and cost drivers", "Shortlist candidates on capability vs. cost", "Test the top candidate(s) on real examples"],
                answerKey: ["Define the task and required modality", "Estimate expected volume and cost drivers", "Shortlist candidates on capability vs. cost", "Test the top candidate(s) on real examples"],
                explanation: "Model selection starts from the task's requirements, then cost, then a capability/cost shortlist, then real testing before committing.",
              },
              {
                id: "l4q9", format: "matching", graded: true, dimensionKey: "comprehension",
                prompt: "Match each use case to the appropriate model type.",
                options: ["A capable, cost-moderate general model", "A multimodal model", "A small, private/local model", "A small, cheap, high-throughput model"],
                matchingPrompts: [
                  { id: "customer_service", text: "Customer service bot" },
                  { id: "image_analysis", text: "Image analysis" },
                  { id: "on_device", text: "On-device assistant" },
                  { id: "cheap_classification", text: "Cheap, high-volume classification" },
                ],
                answerKey: { customer_service: "A capable, cost-moderate general model", image_analysis: "A multimodal model", on_device: "A small, private/local model", cheap_classification: "A small, cheap, high-throughput model" },
                explanation: "Match the model's strengths to the job: multimodal for images, small/local for on-device, small/cheap for high-volume simple tasks, and a capable general model for open-ended conversation.",
              },
            ],
          },
          {
            id: "b4-14", order: 14, blockType: "project",
            requiresSubmission: true, blocking: true,
            content: "**Model Selection Memo** — Milestone 4\n\nOne page for your project's tool:\n\n1. Which model you'll use — be specific, name it\n2. Why that one — capability, cost, context window, privacy, whatever actually drove it\n3. One alternative you seriously considered and why you rejected it\n4. A rough cost estimate: expected volume × the cost drivers from earlier in this lesson\n\nThen re-read your first-instinct answer from the start of this lesson. What changed?",
          },
          {
            id: "b4-15", order: 15, blockType: "teach_back",
            prompt: "I'm playing the skeptical manager: why not a cheaper model? Why not the biggest one? What happens to cost if usage grows 10x? Defend your memo.",
            dimensionKey: "comprehension",
            evaluatesConcepts: ["model selection", "cost drivers"],
            assessment: { mode: "reteach_gate" },
            passingOverride: { dimensionKey: "comprehension", threshold: 7, maxTurns: 5 },
          },
        ],
      },

      // ── Lesson 5 ──────────────────────────────────────────────────────────
      {
        key: "lesson-5",
        title: "Chatbots aren't the only AI tool, and often not the best",
        keyConcepts: ["platform types", "guardrails", "deployment and scale"],
        selfCheckQuestions: [],
        blocks: [
          {
            id: "b5-1", order: 1, blockType: "project",
            requiresSubmission: true, blocking: true,
            content: "**Build or buy?**\n\nSame internship, next question: what type of AI tool will you propose for customer service — and will you use something pre-built or build from scratch? First instinct, 3-4 sentences.",
          },
          {
            id: "b5-2", order: 2, blockType: "teach", role: "explanation",
            content: "Three kinds of AI tool platform. Chatbots: conversational, general, low effort. Block-based frameworks: visual, no-code, structured workflows. Code-based frameworks: maximum control, requires programming — \"vibe programming,\" where AI writes much of the code for you. What each is good and bad at.",
          },
          {
            id: "b5-3", order: 3, blockType: "teach", role: "deepening",
            content: "Why a chatbot often isn't the answer. Chat is a great interface for exploration and a poor one for repeatable processes. If a task happens the same way every time, a workflow beats a conversation. Directly relevant to your project — most of you will have picked a repetitive process.",
          },
          {
            id: "b5-4", order: 4, blockType: "resource",
            resource: {
              type: "weblink",
              // TBD per the doc — "Specific links TBD — a no-code agent
              // builder and LangChain's quickstart are the natural pair."
              // Not invented per instruction #10. See findings report.
              url: "https://TODO-see-e5-findings-report.example/5.4-platform-examples",
              label: "TBD — one block-based platform and one code-based framework",
              description: "Placeholder. Doc's candidates: a no-code agent builder, and LangChain's quickstart. Needs real links before this course ships.",
            },
          },
          {
            id: "b5-5", order: 5, blockType: "teach", role: "explanation",
            content: "Where will you run it? Local vs. cloud vs. embedded in an existing product. Practical considerations: cost, data privacy, who maintains it, what happens when it breaks.",
          },
          {
            id: "b5-6", order: 6, blockType: "teach", role: "explanation",
            content: "Building in safety — guardrails. What a guardrail is: input validation, output checking, refusal conditions, human escalation. This connects back to Lesson 2's hallucination content — guardrails are how you build something usable on top of a component that is confidently wrong sometimes.",
          },
          {
            id: "b5-7", order: 7, blockType: "teach", role: "explanation",
            content: "Deployment and scaling. What changes when 10 users become 10,000: cost, rate limits, latency, monitoring. Awareness, not depth.",
          },
          {
            id: "b5-8", order: 8, blockType: "quiz_checkpoint",
            title: "Lesson 5 check",
            assessment: { mode: "web_quiz" },
            questions: [
              { id: "l5q1", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "When does a workflow beat a chatbot?", options: ["Never — chatbots are always better", "When the task happens the same way every time — repeatable processes favor a workflow", "Only for very simple tasks", "Chatbots and workflows are interchangeable"], answerKey: "When the task happens the same way every time — repeatable processes favor a workflow", explanation: "Chat is great for exploration, poor for repeatable processes. If a task is the same every time, a workflow beats a conversation." },
              { id: "l5q2", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "What does a guardrail do?", options: ["Makes the model faster", "Validates input, checks output, defines refusal conditions, and enables human escalation", "Replaces the need for context", "Only applies to open-source models"], answerKey: "Validates input, checks output, defines refusal conditions, and enables human escalation", explanation: "A guardrail is how you build something usable on top of a component (the model) that is confidently wrong sometimes." },
              { id: "l5q3", format: "multiple_choice", graded: true, dimensionKey: "comprehension", prompt: "What changes when 10 users become 10,000?", options: ["Nothing meaningful", "Cost, rate limits, latency, and monitoring all become real concerns", "Only the UI needs to change", "The model automatically gets faster"], answerKey: "Cost, rate limits, latency, and monitoring all become real concerns", explanation: "Scale changes cost, rate limits, latency, and monitoring — all things that don't matter at low volume but do at scale." },
              { id: "l5q4", format: "fill_in_blank", graded: true, dimensionKey: "comprehension", prompt: "Name the three platform types: chatbots, block-based frameworks, and ____ frameworks.", answerKey: ["code-based", "code based"], explanation: "The three types are chatbots, block-based (no-code) frameworks, and code-based frameworks." },
              { id: "l5q5", format: "fill_in_blank", graded: true, dimensionKey: "comprehension", prompt: "\"Vibe programming\" refers to AI writing much of the ____ for you.", answerKey: ["code"], explanation: "Vibe programming is a code-based framework approach where AI writes much of the code for you." },
              {
                id: "l5q6", format: "matching", graded: true, dimensionKey: "comprehension",
                prompt: "Match each scenario to the right platform type.",
                options: ["Chatbot", "Block-based framework", "Code-based framework"],
                matchingPrompts: [
                  { id: "exploratory_qa", text: "Open-ended exploratory Q&A for customers" },
                  { id: "structured_workflow", text: "A structured, repeatable multi-step workflow, built by non-engineers" },
                  { id: "max_control", text: "A task needing maximum control and custom logic" },
                ],
                answerKey: { exploratory_qa: "Chatbot", structured_workflow: "Block-based framework", max_control: "Code-based framework" },
                explanation: "Chatbots suit open-ended exploration, block-based frameworks suit structured no-code workflows, and code-based frameworks suit maximum-control custom builds.",
              },
              {
                id: "l5q7", format: "matching", graded: true, dimensionKey: "comprehension",
                prompt: "Match each risk to its guardrail.",
                options: ["Input validation", "Output checking", "Human escalation"],
                matchingPrompts: [
                  { id: "malformed_input", text: "A malformed or malicious input" },
                  { id: "wrong_output", text: "A confidently wrong output" },
                  { id: "high_stakes", text: "A high-stakes decision the system shouldn't make alone" },
                ],
                answerKey: { malformed_input: "Input validation", wrong_output: "Output checking", high_stakes: "Human escalation" },
                explanation: "Each risk has a matching guardrail: validate inputs, check outputs, and escalate high-stakes decisions to a human.",
              },
              {
                id: "l5q8", format: "drag_to_order", graded: true, dimensionKey: "comprehension",
                prompt: "Order the deployment steps.",
                options: ["Choose where it runs (local/cloud/embedded)", "Add guardrails", "Test at low volume", "Monitor and scale as usage grows"],
                answerKey: ["Choose where it runs (local/cloud/embedded)", "Add guardrails", "Test at low volume", "Monitor and scale as usage grows"],
                explanation: "Deployment goes from where-it-runs, to safety, to a small real test, to monitoring as it scales.",
              },
            ],
          },
          {
            id: "b5-9", order: 9, blockType: "project",
            requiresSubmission: true, blocking: true,
            content: "**Deployment One-Pager** — Milestone 5\n\nFor your tool:\n\n1. Which platform type, and which specific platform\n2. Where it runs\n3. One guardrail you're implementing, and what it prevents\n4. One thing that breaks if usage grows 10x",
          },
          {
            id: "b5-10", order: 10, blockType: "teach_back",
            prompt: "Walk me through your entire tool: what it does, which model, what context, what tools, what guardrails, where it runs. This is effectively a rehearsal of your final submission.",
            dimensionKey: "comprehension",
            evaluatesConcepts: ["platform types", "guardrails", "deployment"],
            assessment: { mode: "reteach_gate" },
            passingOverride: { dimensionKey: "comprehension", threshold: 7, maxTurns: 6 },
          },
        ],
      },

      // ── Final Project ────────────────────────────────────────────────────
      {
        key: "final-project",
        title: "Final Project",
        keyConcepts: [],
        selfCheckQuestions: [],
        blocks: [
          {
            id: "b6-1", order: 1, blockType: "teach", role: "explanation",
            content: "**Build your tool.** You've designed every piece across five lessons — process (Milestone 1), failure modes (Milestone 2), system design (Milestone 3), model choice (Milestone 4), platform and guardrails (Milestone 5). Now build it.\n\nWhat to build: a working AI tool that automates part of the business process you chose in Lesson 1. It does not need to be polished or production-ready. It needs to work.\n\nWhat you'll need: the platform you chose in Milestone 5; access to the model you chose in Milestone 4 (via the platform or an aggregator like OpenRouter); the prompt and context design from Milestone 3.\n\nHow to submit — a written explanation covering: (1) what you built and who would use it, (2) how you built it (platform, model, prompt, context, tools, guardrails), (3) what it does — walk through one real example input and output, (4) how it applies the course — reference at least three specific concepts and where each shows up in your tool, (5) what you'd do next.",
            handoff: "When you're ready, submit below.",
          },
          {
            id: "b6-2", order: 2, blockType: "project",
            requiresSubmission: true, blocking: true,
            content: "**Final submission.** Text covering: what you built, how you built it, what it does (one real example), how it applies the course (at least three concepts, with where each shows up), and what you'd do next. You may attach links (to the tool, a demo, a repo) but the write-up is the deliverable.\n\nIn-platform text submission for now — this does not yet post to Canvas.",
          },
          {
            // E.6.1: {step:q6} resolved cross-lesson from block b0-2's
            // accumulated answers, via resolveCrossLessonAnswers
            // (player/service.ts). Sentence stays grammatical if the
            // fallback phrase substitutes instead of a real answer.
            id: "b6-3", order: 3, blockType: "teach_back",
            prompt: "Let's reflect. At the start of this course you told us this about {step:q6}. What do you believe now? What changed?",
            dimensionKey: "comprehension",
            evaluatesConcepts: [],
            // E.5.2: showScoreToLearner must be set explicitly — without it
            // this inherits the package-level default (true), which would
            // show a raw comprehension score for an ungraded reflection.
            assessment: { mode: "reteach_gate", showScoreToLearner: false },
            // Not graded — a closing conversation, not a gate. threshold 0
            // per the doc's own instruction ("if the block type requires a
            // threshold, set it to 0"). confidenceFloor: 0 is required too —
            // threshold 0 alone does not produce always-pass (see
            // passingSchema's confidenceFloor doc). Without it this block
            // would almost always fall through to the maxTurns backstop
            // instead of a genuine pass — bounded, not stranding, but not
            // "clean" either.
            passingOverride: { dimensionKey: "comprehension", threshold: 0, confidenceFloor: 0, minTurns: 1, maxTurns: 4 },
            handoff: "This one's just a conversation — there's no score.",
          },
        ],
      },
    ],
  },

  outcome: {
    project: {
      title: "A working AI tool for a real business process",
      description: "A working AI tool, built across the course's five milestones, that automates part of a real business process the learner chose in Lesson 1. Each milestone unlocks on its own as you finish the lesson that teaches it — a locked milestone just means that part of the course is still ahead of you, not that anything is being held back.",
      deliverables: [
        { name: "Final write-up", description: "What was built, how, what it does, how it applies the course, and what's next." },
      ],
    },
    milestones: [
      { key: "milestone-1", name: "Project process chosen", availability: { type: "after_lesson", lessonKey: "lesson-1" } },
      { key: "milestone-2", name: "Failure modes identified", availability: { type: "after_lesson", lessonKey: "lesson-2" } },
      { key: "milestone-3", name: "System designed", availability: { type: "after_lesson", lessonKey: "lesson-3" } },
      { key: "milestone-4", name: "Model selected", availability: { type: "after_lesson", lessonKey: "lesson-4" } },
      { key: "milestone-5", name: "Platform and guardrails chosen", availability: { type: "after_lesson", lessonKey: "lesson-5" } },
    ],
    mentorResources: [],
  },
};

// Mirrors pbj-journey-package.ts's own validate-on-import convention.
const result = journeyPackageSchema.safeParse(aiEssentialsAug2026Package);
if (!result.success) {
  console.error("❌ AI Essentials Aug 2026 package failed validation:\n");
  for (const issue of result.error.issues) {
    console.error(`  - [${issue.path.join(".") || "(root)"}] ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("✅ AI Essentials Aug 2026 package is valid against journeyPackageSchema v" + result.data.schemaVersion);
  console.log(`   Lessons: ${result.data.curriculum.lessons.length}`);
  console.log(`   Total blocks: ${result.data.curriculum.lessons.reduce((sum, l) => sum + l.blocks.length, 0)}`);
}
