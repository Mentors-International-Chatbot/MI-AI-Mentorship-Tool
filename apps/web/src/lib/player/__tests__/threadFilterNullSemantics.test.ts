import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A SQL NOT on an optional JSON key hides rows silently
 * ═══════════════════════════════════════════════════════════════════════════
 * `getLessonThread` used to exclude historical `lesson_entry` rows with
 * `NOT: { metadata: { path: ["intent"], equals: "lesson_entry" } } }`. Every
 * mentor DM lacks an `intent` key entirely — mentor DMs have no player intent
 * to stamp — and Postgres JSON-path equality on a missing key is SQL NULL,
 * not FALSE. `NOT (NULL = 'lesson_entry')` is UNKNOWN, and a WHERE clause
 * only keeps rows where the predicate is TRUE, so every mentor message was
 * silently dropped from the player thread the day `resolveMentorMessageMetadata`
 * started writing it. Nothing errored; nothing logged; the row was just gone.
 *
 * The fix moved the exclusion into application code (`getLessonThread`
 * filters after the query, see `lessonThread.test.ts`), where "no intent key"
 * defaults to "not lesson_entry" instead of "excluded". This file pins the
 * general rule so the next optional-key exclusion doesn't reintroduce the
 * same class of bug: no Prisma `where` clause anywhere in this codebase may
 * negate a JSON metadata path equality directly in SQL. Any future writer
 * that stamps a leaner metadata shape (a new mentor-style row, a system
 * message, anything that doesn't carry every optional key) will otherwise
 * vanish from whatever thread reads it back, exactly as this one did — with
 * no error and no test failure until someone notices the message never
 * arrived.
 */
const SRC_ROOT = resolve(process.cwd(), "src");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

// A JSON-path equality negated directly in a Prisma `where`: `NOT: { ... }`
// (or `NOT: [...]`) wrapping a `metadata: { path: [...` filter, on one line
// or several. This is the shape that reads as "exclude X" but actually means
// "exclude X, and also silently drop every row that never set the key at all."
const NEGATED_METADATA_PATH = /NOT:\s*(\{|\[)[\s\S]*?metadata:\s*\{\s*path:/;

describe("no Prisma query negates a JSON metadata path equality in SQL", () => {
  const files = listTsFiles(SRC_ROOT);

  it("scanned at least the known metadata-filtering files", () => {
    // A canary: if this drops to 0 the walker broke, not the codebase.
    const metadataFilterFiles = files.filter((f) => readFileSync(f, "utf8").includes("metadata: { path:"));
    expect(metadataFilterFiles.length).toBeGreaterThan(0);
  });

  it.each(files)("%s has no NOT-wrapped metadata path filter", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(NEGATED_METADATA_PATH);
  });
});
