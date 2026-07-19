/**
 * Next.js Instrumentation
 * ═══════════════════════════════════════════════════════════════════════════
 * Runs once when the server starts. Used for:
 *   - Preloading lessons from database into memory cache
 *   - Any other one-time initialization
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { preloadLessons } = await import("@/lib/lessons/db-lesson-service");
    await preloadLessons();
  }
}
