/**
 * Database-backed Lesson Service
 * ═══════════════════════════════════════════════════════════════════════════
 * Provides the same interface as the legacy hardcoded data.ts but reads from
 * the database (LessonVersion.body). Used after JourneyPackage migration.
 *
 * Key mapping:
 *   - lesson-01 → lessonNumber: 1
 *   - LessonVersion.body.blocks[].role → message.type (scenario → escenario, etc.)
 *
 * This service caches lessons in memory after first load since curriculum
 * changes infrequently and we need sync access for existing callers.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/db";
import type { PackageLesson, LessonBlock } from "@/lib/journey-package/journey-package.schema";

// ═══════════════════════════════════════════════════════════════════════════
// Types (matching legacy data.ts interface)
// ═══════════════════════════════════════════════════════════════════════════

export interface LessonMessage {
  order: number;
  type: 'escenario' | 'explicación' | 'ejemplo' | 'pregunta' | 'profundización';
  contentEs: string;
}

export interface LessonData {
  lessonNumber: number;
  titleEs: string;
  category: string;
  keyConcepts: string[];
  selfCheckQuestions: string[];
  exercise: string;
  commitment: string;
  messages: LessonMessage[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Role Mapping (reverse of migration script)
// ═══════════════════════════════════════════════════════════════════════════

type TeachRole = "scenario" | "explanation" | "example" | "question" | "deepening";

const ROLE_TO_TYPE: Record<TeachRole, LessonMessage["type"]> = {
  scenario: "escenario",
  explanation: "explicación",
  example: "ejemplo",
  question: "pregunta",
  deepening: "profundización",
};

// ═══════════════════════════════════════════════════════════════════════════
// Cache
// ═══════════════════════════════════════════════════════════════════════════

let lessonsCache: Map<number, LessonData> | null = null;
let cachePromise: Promise<void> | null = null;

/**
 * Extracts lesson number from key format: "lesson-01" → 1
 */
function keyToLessonNumber(key: string): number {
  const match = key.match(/^lesson-(\d+)$/);
  if (!match) return 0;
  return parseInt(match[1], 10);
}

/**
 * Transforms PackageLesson (DB format) to LessonData (legacy format).
 */
function transformToLessonData(pkg: PackageLesson): LessonData {
  const lessonNumber = keyToLessonNumber(pkg.key);

  // Extract teach blocks and transform to messages
  const messages: LessonMessage[] = pkg.blocks
    .filter((b): b is LessonBlock & { blockType: "teach"; role: TeachRole } =>
      b.blockType === "teach" && "role" in b
    )
    .map((b) => ({
      order: b.order,
      type: ROLE_TO_TYPE[b.role] || "explicación",
      contentEs: b.content,
    }))
    .sort((a, b) => a.order - b.order);

  return {
    lessonNumber,
    titleEs: pkg.title,
    category: pkg.category || "",
    keyConcepts: pkg.keyConcepts || [],
    selfCheckQuestions: pkg.selfCheckQuestions || [],
    exercise: pkg.exercise || "",
    commitment: pkg.commitment || "",
    messages,
  };
}

/**
 * Loads all active lessons from the database into memory.
 * Called once on first access, then cached.
 */
async function loadLessonsFromDb(): Promise<Map<number, LessonData>> {
  const lessons = new Map<number, LessonData>();

  // Get all active lesson versions
  const versions = await prisma.lessonVersion.findMany({
    where: { active: true },
    include: {
      lesson: true,
    },
    orderBy: { lesson: { orderIndex: "asc" } },
  });

  for (const version of versions) {
    const body = version.body as PackageLesson;
    if (!body || !body.key) continue;

    const lessonData = transformToLessonData(body);
    if (lessonData.lessonNumber > 0) {
      lessons.set(lessonData.lessonNumber, lessonData);
    }
  }

  return lessons;
}

/**
 * Ensures lessons are loaded (idempotent, concurrent-safe).
 */
async function ensureLessonsLoaded(): Promise<Map<number, LessonData>> {
  if (lessonsCache) return lessonsCache;

  if (!cachePromise) {
    cachePromise = loadLessonsFromDb().then((lessons) => {
      lessonsCache = lessons;
    });
  }

  await cachePromise;
  return lessonsCache!;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API (matching legacy data.ts)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gets lesson data by number. Async version - use when await is possible.
 */
export async function getLessonDataAsync(lessonNumber: number): Promise<LessonData> {
  const lessons = await ensureLessonsLoaded();
  const lesson = lessons.get(lessonNumber);
  if (!lesson) {
    throw new Error(`Lesson ${lessonNumber} not found in database.`);
  }
  return lesson;
}

/**
 * Gets lesson data by number. Sync version - throws if cache not loaded.
 * Call preloadLessons() at app startup if using this.
 */
export function getLessonData(lessonNumber: number): LessonData {
  if (!lessonsCache) {
    throw new Error(
      "Lessons not loaded. Call preloadLessons() at app startup or use getLessonDataAsync()."
    );
  }
  const lesson = lessonsCache.get(lessonNumber);
  if (!lesson) {
    throw new Error(`Lesson ${lessonNumber} not found. Only lessons 1-${lessonsCache.size} are available.`);
  }
  return lesson;
}

/**
 * Gets just the lesson title. Sync version.
 */
export function getLessonTitle(lessonNumber: number): string {
  if (!lessonsCache) return `Lección ${lessonNumber}`;
  const lesson = lessonsCache.get(lessonNumber);
  if (!lesson) return `Lección ${lessonNumber}`;
  return lesson.titleEs;
}

/**
 * Checks if lesson exists. Sync version.
 */
export function hasLessonData(lessonNumber: number): boolean {
  if (!lessonsCache) return false;
  return lessonsCache.has(lessonNumber);
}

/**
 * Preloads all lessons into cache. Call at app startup.
 */
export async function preloadLessons(): Promise<void> {
  await ensureLessonsLoaded();
  console.log(`[LessonService] Loaded ${lessonsCache?.size ?? 0} lessons from database`);
}

/**
 * Clears the cache. Useful for testing or after publishing new versions.
 */
export function clearLessonsCache(): void {
  lessonsCache = null;
  cachePromise = null;
}

/**
 * Returns total lesson count. Sync version.
 */
export function getLessonCount(): number {
  return lessonsCache?.size ?? 0;
}
