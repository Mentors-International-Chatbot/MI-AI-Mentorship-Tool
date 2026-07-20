/**
 * Course Code Resolver
 * ═══════════════════════════════════════════════════════════════════════════
 * Maps user-facing course codes to ContentCollection slugs (collectionKey).
 *
 * This is a thin seam that will be replaced by EnrollmentInvitation.displayCode
 * once the full enrollment system is built. For now, codes are hardcoded here.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Maps upper-cased course codes to their corresponding collectionKey.
 * The collectionKey matches ContentCollection.slug in the database.
 */
export const COURSE_CODES: Record<string, string> = {
  MI2024: "mi-colombia-curriculum",
  PBJ: "pbj-basics",
};

/**
 * Resolves a user-entered course code to a collectionKey.
 * Case-insensitive, trims whitespace.
 *
 * @param code - The course code entered by the user
 * @returns The collectionKey if found, null if not recognized
 */
export function resolveCourseCode(code: string): string | null {
  const normalized = code.trim().toUpperCase();
  return COURSE_CODES[normalized] ?? null;
}

/**
 * Checks if a course code is valid.
 */
export function isValidCourseCode(code: string): boolean {
  return resolveCourseCode(code) !== null;
}

/**
 * Returns all available course codes (for display/validation).
 */
export function getAvailableCourseCodes(): string[] {
  return Object.keys(COURSE_CODES);
}
