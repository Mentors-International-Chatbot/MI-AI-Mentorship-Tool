/**
 * Database-backed Lesson Service (Collection-Aware)
 * ═══════════════════════════════════════════════════════════════════════════
 * Provides lessons from the database, scoped by ContentCollection slug.
 * Each socio's curriculumCollectionKey determines which collection they see.
 *
 * Key mapping:
 *   - lesson-01 → lessonNumber: 1
 *   - LessonVersion.body.blocks[].role → message.type (scenario → escenario, etc.)
 *
 * Cache structure: Map<collectionKey, Map<lessonNumber, LessonData>>
 * Lessons are loaded lazily per collection on first access.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/db";
import type { PackageLesson, LessonBlock } from "@/lib/journey-package/journey-package.schema";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default collection for backwards compatibility.
 * Used when a socio has no curriculumCollectionKey set.
 */
export const DEFAULT_COLLECTION_KEY = "mi-colombia-curriculum";

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
// Cache (keyed by collectionKey)
// ═══════════════════════════════════════════════════════════════════════════

/** Cache: collectionKey → (lessonNumber → LessonData) */
const collectionsCache = new Map<string, Map<number, LessonData>>();

/** In-flight load promises to prevent duplicate loads */
const loadPromises = new Map<string, Promise<Map<number, LessonData>>>();

/**
 * Extracts lesson number from key format: "lesson-01" → 1
 * Also handles non-numbered keys by returning the order index + 1
 */
function keyToLessonNumber(key: string, fallbackIndex: number): number {
  const match = key.match(/^lesson-(\d+)$/);
  if (match) return parseInt(match[1], 10);
  // For non-numbered keys (like "assemble-the-sandwich"), use fallback
  return fallbackIndex + 1;
}

/**
 * Transforms PackageLesson (DB format) to LessonData (legacy format).
 */
function transformToLessonData(pkg: PackageLesson, orderIndex: number): LessonData {
  const lessonNumber = keyToLessonNumber(pkg.key, orderIndex);

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
 * Loads lessons for a specific collection from the database.
 */
async function loadLessonsFromDb(collectionKey: string): Promise<Map<number, LessonData>> {
  console.log('[LessonService] loadLessonsFromDb called for collection:', collectionKey);
  const lessons = new Map<number, LessonData>();

  // Get active lesson versions for this collection
  const versions = await prisma.lessonVersion.findMany({
    where: {
      active: true,
      lesson: {
        collection: {
          slug: collectionKey,
        },
      },
    },
    include: {
      lesson: {
        include: {
          collection: true,
        },
      },
    },
    orderBy: { lesson: { orderIndex: "asc" } },
  });

  for (let i = 0; i < versions.length; i++) {
    const version = versions[i];
    const body = version.body as PackageLesson;
    if (!body || !body.key) continue;

    const lessonData = transformToLessonData(body, i);
    console.log('[LessonService] Transformed lesson:', {
      collectionKey,
      lessonNumber: lessonData.lessonNumber,
      title: lessonData.titleEs,
      messageCount: lessonData.messages.length,
      firstMessagePreview: lessonData.messages[0]?.contentEs?.substring(0, 80),
    });
    if (lessonData.lessonNumber > 0) {
      lessons.set(lessonData.lessonNumber, lessonData);
    }
  }

  return lessons;
}

/**
 * Ensures lessons for a collection are loaded (idempotent, concurrent-safe).
 */
async function ensureCollectionLoaded(collectionKey: string): Promise<Map<number, LessonData>> {
  // Return cached if available
  const cached = collectionsCache.get(collectionKey);
  if (cached) return cached;

  // Check for in-flight load
  let loadPromise = loadPromises.get(collectionKey);
  if (!loadPromise) {
    // Start loading
    loadPromise = loadLessonsFromDb(collectionKey).then((lessons) => {
      collectionsCache.set(collectionKey, lessons);
      loadPromises.delete(collectionKey);
      return lessons;
    });
    loadPromises.set(collectionKey, loadPromise);
  }

  return loadPromise;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API (collection-aware)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gets lesson data by collection and lesson number. Async version.
 */
export async function getLessonDataAsync(
  collectionKey: string,
  lessonNumber: number
): Promise<LessonData> {
  const lessons = await ensureCollectionLoaded(collectionKey);
  const lesson = lessons.get(lessonNumber);
  if (!lesson) {
    throw new Error(`Lesson ${lessonNumber} not found in collection "${collectionKey}".`);
  }
  return lesson;
}

/**
 * Gets lesson data by collection and lesson number. Sync version.
 * Throws if the collection hasn't been preloaded.
 */
export function getLessonData(collectionKey: string, lessonNumber: number): LessonData {
  const lessons = collectionsCache.get(collectionKey);
  if (!lessons) {
    throw new Error(
      `Collection "${collectionKey}" not loaded. Call preloadCollection() first or use getLessonDataAsync().`
    );
  }
  const lesson = lessons.get(lessonNumber);
  if (!lesson) {
    throw new Error(
      `Lesson ${lessonNumber} not found in collection "${collectionKey}". ` +
      `Available: 1-${lessons.size}`
    );
  }
  return lesson;
}

/**
 * Gets just the lesson title. Sync version.
 */
export function getLessonTitle(collectionKey: string, lessonNumber: number): string {
  const lessons = collectionsCache.get(collectionKey);
  if (!lessons) return `Lección ${lessonNumber}`;
  const lesson = lessons.get(lessonNumber);
  if (!lesson) return `Lección ${lessonNumber}`;
  return lesson.titleEs;
}

/**
 * Checks if lesson exists in collection. Sync version.
 */
export function hasLessonData(collectionKey: string, lessonNumber: number): boolean {
  const lessons = collectionsCache.get(collectionKey);
  if (!lessons) {
    console.log('[LessonService] hasLessonData: collection NOT in cache:', collectionKey);
    return false;
  }
  return lessons.has(lessonNumber);
}

/**
 * Preloads a specific collection into cache.
 */
export async function preloadCollection(collectionKey: string): Promise<void> {
  await ensureCollectionLoaded(collectionKey);
  const lessons = collectionsCache.get(collectionKey);
  console.log(`[LessonService] Loaded ${lessons?.size ?? 0} lessons for collection "${collectionKey}"`);
}

/**
 * Preloads the default collection. Called at app startup.
 */
export async function preloadLessons(): Promise<void> {
  await preloadCollection(DEFAULT_COLLECTION_KEY);
}

/**
 * Clears all cached collections.
 */
export function clearLessonsCache(): void {
  collectionsCache.clear();
  loadPromises.clear();
}

/**
 * Returns lesson count for a collection. Sync version.
 */
export function getLessonCount(collectionKey: string): number {
  return collectionsCache.get(collectionKey)?.size ?? 0;
}

/**
 * Checks if a collection is loaded.
 */
export function isCollectionLoaded(collectionKey: string): boolean {
  return collectionsCache.has(collectionKey);
}
