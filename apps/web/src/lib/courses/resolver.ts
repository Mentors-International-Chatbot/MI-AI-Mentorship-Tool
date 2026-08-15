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
 * Course metadata for display purposes.
 */
export interface CourseInfo {
  code: string;
  collectionKey: string;
  name: string;
  description: string;
}

/**
 * Maps upper-cased course codes to their corresponding collectionKey.
 * The collectionKey matches ContentCollection.slug in the database.
 */
export const COURSE_CODES: Record<string, string> = {
  MI2024: "mi-colombia-curriculum",
  PBJ: "pbj-basics",
  AIESS: "ai-essentials",
};

/**
 * Course metadata for UI display.
 */
export const COURSE_INFO: Record<string, Omit<CourseInfo, 'code'>> = {
  MI2024: {
    collectionKey: "mi-colombia-curriculum",
    name: "Mentors International Finance",
    description: "28-lesson business finance curriculum for micro-entrepreneurs",
  },
  PBJ: {
    collectionKey: "pbj-basics",
    name: "PB&J Sandwich (Test Course)",
    description: "A simple test course for development purposes",
  },
  AIESS: {
    collectionKey: "ai-essentials",
    name: "AI Essentials",
    description: "17-lesson practical AI literacy course",
  },
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

/** Returns the route-facing course code without course-specific branching. */
export function courseCodeForCollectionKey(collectionKey: string): string {
  return Object.entries(COURSE_CODES).find(([, key]) => key === collectionKey)?.[0] ?? collectionKey;
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

/**
 * Returns all courses with full metadata for display.
 */
export function getAvailableCourses(): CourseInfo[] {
  return Object.entries(COURSE_INFO).map(([code, info]) => ({
    code,
    ...info,
  }));
}
