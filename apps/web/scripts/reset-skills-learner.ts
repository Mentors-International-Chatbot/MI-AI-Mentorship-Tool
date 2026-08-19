#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * Reset one SKILLS learner's progress and thread, keeping the account.
 * ----------------------------------------------------------------------------
 *   node --env-file=.env ./node_modules/.bin/tsx scripts/reset-skills-learner.ts <phone>
 *
 * A script rather than an endpoint on purpose: this deletes learner data, and a
 * file under scripts/ is not a route, is not in the deployed bundle, and cannot
 * be reached over HTTP. There is no surface to guard, so there is no env flag to
 * mis-set. (`test-login` needs `ENABLE_TEST_LOGIN` precisely because it *is* a
 * route.)
 *
 * Keeps: Socio, ParticipantProfile, Enrollment, SocioProgress.
 * `SocioProgress` in particular must survive — its absence is what made every
 * first tutor turn 500 until `touchInteraction` learned to upsert.
 *
 * Deletes, in foreign-key order:
 *   1. MessageSentiment  — relation to Message has NO onDelete: Cascade, so
 *                          these must go first or the message delete throws
 *   2. Message           — the lesson thread, scoped by metadata.collectionKey
 *   3. BlockProgress     — course-scoped, drives which block is "current"
 *   4. LessonProgress    — NOT course-scoped (socioId + lessonNumber only)
 *   5. SocioFlag         — course-scoped
 *   6. SocioDimensionState — NOT course-scoped (socioId + dimensionKey only);
 *                          left behind, the tutor pitches the next run at
 *                          someone who already understood it
 *
 * Because 4 and 6 are not course-scoped, the script refuses unless the learner's
 * `curriculumCollectionKey` is this course — otherwise passing the wrong phone
 * number would clear another course's state.
 */

import { prisma } from "../src/lib/db";

const COLLECTION_KEY = "skills-tool-calls";

async function main() {
  // Required, no default. A reset that guesses which learner it means is one
  // tab-complete away from clearing the wrong one.
  const phone = process.argv[2];
  if (!phone) {
    console.error("Usage: reset-skills-learner.ts <phone>");
    console.error("  The phone number is required. There is no default learner.");
    process.exit(1);
  }

  const socio = await prisma.socio.findFirst({
    where: { whatsappPhoneNumber: phone },
    select: { id: true, name: true, curriculumCollectionKey: true },
  });
  if (!socio) {
    console.error(`No learner found with phone "${phone}".`);
    process.exit(1);
  }
  if (socio.curriculumCollectionKey !== COLLECTION_KEY) {
    console.error(
      `Refusing: ${socio.name} is on "${socio.curriculumCollectionKey ?? "(none)"}", not "${COLLECTION_KEY}".\n` +
      `Lesson progress and dimension state are not course-scoped, so resetting a learner\n` +
      `from another course would clear that course's data.`,
    );
    process.exit(1);
  }

  console.log(`Resetting ${socio.name} (${socio.id})\n`);

  const messages = await prisma.message.findMany({
    where: { socioId: socio.id, metadata: { path: ["collectionKey"], equals: COLLECTION_KEY } },
    select: { id: true },
  });
  const messageIds = messages.map((message) => message.id);

  const sentiments = await prisma.messageSentiment.deleteMany({ where: { messageId: { in: messageIds } } });
  const deletedMessages = await prisma.message.deleteMany({ where: { id: { in: messageIds } } });
  const blocks = await prisma.blockProgress.deleteMany({ where: { socioId: socio.id, collectionKey: COLLECTION_KEY } });
  const lessons = await prisma.lessonProgress.deleteMany({ where: { socioId: socio.id } });
  const flags = await prisma.socioFlag.deleteMany({ where: { socioId: socio.id } });
  const dimensions = await prisma.socioDimensionState.deleteMany({ where: { socioId: socio.id } });

  console.table([
    { table: "message_sentiments", deleted: sentiments.count },
    { table: "messages", deleted: deletedMessages.count },
    { table: "block_progress", deleted: blocks.count },
    { table: "lesson_progress", deleted: lessons.count },
    { table: "socio_flags", deleted: flags.count },
    { table: "socio_dimension_states", deleted: dimensions.count },
  ]);

  // A run that deleted nothing is a real outcome worth naming, not a silent
  // success — it usually means the learner had already been reset.
  const total = sentiments.count + deletedMessages.count + blocks.count
    + lessons.count + flags.count + dimensions.count;
  if (total === 0) console.log("\nNothing to delete — this learner was already clean.");

  const remaining = await prisma.message.count({ where: { socioId: socio.id } });
  if (remaining > 0) {
    console.log(`\nNote: ${remaining} message(s) left on this learner with no ${COLLECTION_KEY} metadata.`);
    console.log("Those are not part of the lesson thread (a mentor DM writes no metadata).");
  }

  const kept = await prisma.socio.findUnique({
    where: { id: socio.id },
    select: {
      curriculumCollectionKey: true,
      progress: { select: { socioId: true } },
      participantProfile: { select: { enrollments: { select: { status: true } } } },
    },
  });
  console.log(
    `\nKept: curriculum=${kept?.curriculumCollectionKey}` +
    ` socioProgress=${kept?.progress ? "yes" : "MISSING"}` +
    ` enrollments=${kept?.participantProfile?.enrollments.length ?? 0}`,
  );
  console.log("Log out, log back in, and the lesson restarts at block 1.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
