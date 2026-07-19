/**
 * PB&J Sandwich — toy journey package
 * ----------------------------------------------------------------------------
 * Deliberately trivial subject matter so we can pressure-test the SCHEMA, not
 * the curriculum. Every block type, every cross-reference kind (dimensionKey,
 * afterLessonKey, milestoneKey), and both alert-rule/graduation hookups are
 * exercised at least once. If this instance validates cleanly, the format is
 * proven for the surfaces the real MI content doesn't touch (quiz, teach_back,
 * media, resource, project/milestones) — the MI migration already proves the
 * `teach` block + config path.
 * ----------------------------------------------------------------------------
 */
import { journeyPackageSchema, type JourneyPackage } from "../journey-package.schema";

const pbjPackage: JourneyPackage = {
  schemaVersion: "1.0",

  metadata: {
    packageId: "pbj-sandwich",
    title: "How to Make a PB&J Sandwich",
    description: "A toy course used to pressure-test the journey package format.",
    languages: ["en"], // UI-chrome language is separate — see note below
    version: "0.1.0",
    author: { name: "Michael", organizationKey: "byu" },
  },

  config: {
    // No terminology override — inherits org defaults (this is the "omit to
    // inherit" path from the schema, exercised deliberately).
    aiBehavior: {
      tone: "encouraging, patient",
      teachingStyle: "step-by-step with concrete demonstration",
      languageInstruction: "Respond in English. Keep sentences short.",
    },
    onboarding: {
      mode: "skip", // toy course — no baseline survey needed
      steps: [],
    },
    trackedDimensions: [
      {
        key: "sequencing",
        label: "Step Sequencing",
        category: "comprehension",
        primary: true,
        scale: { min: 0, max: 10 },
        calibrationMode: "zero_start",
      },
      {
        key: "confidence",
        label: "Task Confidence",
        category: "emotional",
        primary: true,
        scale: { min: 0, max: 10 },
        calibrationMode: "assumed_baseline",
        assumedBaseline: 5,
      },
    ],
    alertRules: [
      {
        id: "low-confidence",
        dimensionKey: "confidence", // must exist in trackedDimensions above
        operator: "lt",
        threshold: 3,
        severity: "low",
        cooldownHours: 12,
      },
    ],
    graduation: {
      requiredLessonKeys: ["assemble-the-sandwich"], // must exist in curriculum.lessons below
      requiredDimensionKeys: ["sequencing"],
    },
  },

  curriculum: {
    collectionKey: "pbj-basics",
    lessons: [
      {
        key: "assemble-the-sandwich",
        title: "Assembling the Sandwich",
        category: "Food Prep",
        keyConcepts: [
          "Steps must happen in a working order: bread out, spread, combine, cut.",
          "Spreading peanut butter and jelly on separate slices keeps the bread from tearing.",
        ],
        selfCheckQuestions: [
          "Could someone who has never seen a sandwich follow my steps?",
        ],
        blocks: [
          {
            id: "b1-scenario",
            order: 1,
            blockType: "teach",
            role: "scenario",
            content:
              "You're hungry and no one else is around to help. All you have is bread, " +
              "peanut butter, and jelly. Let's figure out how to turn that into a sandwich.",
          },
          {
            id: "b2-explanation",
            order: 2,
            blockType: "teach",
            role: "explanation",
            content:
              "Lay two slices of bread flat. Spread peanut butter on one slice and jelly " +
              "on the other — keeping them separate until the end stops the bread from tearing.",
          },
          {
            id: "b3-media",
            order: 3,
            blockType: "media",
            kind: "image",
            config: { assetKey: "pbj-assembly-diagram" },
            caption: "The two slices, spread separately, just before they're combined.",
          },
          {
            id: "b4-example",
            order: 4,
            blockType: "teach",
            role: "example",
            content:
              "Now press the two slices together, peanut-butter side to jelly side, and " +
              "cut it diagonally if you like triangles.",
          },
          {
            id: "b5-teach-back",
            order: 5,
            blockType: "teach_back",
            prompt: "In your own words, walk me through the steps in order.",
            evaluatesConcepts: [
              "Steps must happen in a working order: bread out, spread, combine, cut.",
            ],
            dimensionKey: "sequencing", // must exist in trackedDimensions above
          },
          {
            id: "b6-quiz",
            order: 6,
            blockType: "quiz_checkpoint",
            title: "Quick Check",
            questions: [
              {
                id: "q1-order",
                prompt: "What should you do right after spreading both slices?",
                format: "multiple_choice",
                options: [
                  "Cut the sandwich",
                  "Combine the two slices",
                  "Put the bread away",
                  "Spread more jelly",
                ],
                answerKey: "Combine the two slices",
                dimensionKey: "sequencing", // must exist in trackedDimensions above
              },
            ],
          },
          {
            id: "b7-resource",
            order: 7,
            blockType: "resource",
            resource: {
              type: "weblink",
              url: "https://example.org/knife-safety-basics",
              label: "Knife safety basics",
              description: "Optional: a quick refresher before the cutting step.",
            },
          },
        ],
        exercise: "Make one PB&J sandwich, narrating each step out loud as you go.",
        commitment: "I will make a sandwich for someone else this week.",
      },
    ],
  },

  outcome: {
    project: {
      title: "Sandwich for Someone Else",
      description: "Make and share a PB&J sandwich with a friend or family member.",
      deliverables: [
        { name: "Photo of the finished sandwich" },
        { name: "One-sentence description of who you made it for" },
      ],
    },
    milestones: [
      {
        key: "first-sandwich-made",
        name: "First Sandwich Made",
        afterLessonKey: "assemble-the-sandwich", // must exist in curriculum.lessons above
        checkDescription: "Learner reports completing the exercise.",
      },
    ],
    mentorResources: [
      {
        milestoneKey: "first-sandwich-made", // must exist in milestones above
        trigger: "when_behind",
        body:
          "If the learner hasn't reported finishing after two reminders, suggest " +
          "breaking the task into just 'get the ingredients out' as a smaller first step.",
        mentorPrompt: "Offer one small, concrete next action — not the whole task again.",
      },
    ],
  },
};

// ── Validate on import ────────────────────────────────────────────────────
// Run this file directly (ts-node / tsx) to pressure-test the schema against
// this instance. In the real pipeline, this same call is what the file-upload
// validator and the API ingestion endpoint both run.

const result = journeyPackageSchema.safeParse(pbjPackage);

if (!result.success) {
  console.error("❌ PB&J package failed validation:\n");
  for (const issue of result.error.issues) {
    console.error(`  - [${issue.path.join(".") || "(root)"}] ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("✅ PB&J package is valid against journeyPackageSchema v" + result.data.schemaVersion);
  console.log(`   Lessons: ${result.data.curriculum.lessons.length}`);
  console.log(`   Blocks in lesson 1: ${result.data.curriculum.lessons[0].blocks.length}`);
  console.log(`   Tracked dimensions: ${result.data.config.trackedDimensions.map(d => d.key).join(", ")}`);
}

export { pbjPackage };
