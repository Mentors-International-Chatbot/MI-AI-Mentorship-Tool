import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROMPT_CATEGORIES,
  PROMPT_CATEGORY_KEYS,
  courseEditableCategories,
  validateCategoryScope,
} from '@/lib/ai/prompts/categories';

/**
 * The registry and the code must agree in BOTH directions.
 *
 * This is the test that would have caught the original bug: `/admin/prompts`
 * offered `core`, `onboarding` and `name_extraction` while the runtime read a
 * different set entirely, so two active database rows did nothing and five
 * working categories were uneditable. Neither half was obviously wrong on its
 * own — only the comparison exposes it.
 */

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      sourceFiles(full, acc);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      acc.push(full);
    }
  }
  return acc;
}

/** Categories the runtime actually asks for. Multiline- and quote-agnostic. */
function categoriesReadByCode(): Set<string> {
  const found = new Set<string>();
  // Matches loadActivePrompt('x' / getActivePrompt("x") / getActivePromptCached('x')
  // across line breaks. Every function that resolves a category against the DB
  // must appear here, or a live call site reads as an orphan.
  const call = /(?:loadActivePrompt|getActivePromptCached|getActivePrompt)\(\s*['"]([a-z_]+)['"]/g;

  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(call)) found.add(m[1]);
  }
  return found;
}

describe('prompt category registry', () => {
  const readByCode = categoriesReadByCode();

  it('finds the call sites at all (guards against a broken scan)', () => {
    // If the regex silently stops matching, every assertion below passes
    // vacuously. Pin a category that is unambiguously read at runtime.
    expect(readByCode.size).toBeGreaterThan(5);
    expect(readByCode).toContain('lesson_delivery');
  });

  it('registers every category the code reads', () => {
    const missing = [...readByCode].filter((c) => !PROMPT_CATEGORY_KEYS.has(c));
    expect(
      missing,
      `These categories are read at runtime but absent from PROMPT_CATEGORIES, so ` +
        `nobody can edit them in /admin/prompts: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('does not register a category nothing reads', () => {
    const orphans = PROMPT_CATEGORIES.map((c) => c.category).filter((c) => !readByCode.has(c));
    expect(
      orphans,
      `These categories are offered in /admin/prompts but no code reads them, so ` +
        `editing one would silently do nothing: ${orphans.join(', ')}`,
    ).toEqual([]);
  });

  it('has no duplicate entries', () => {
    const keys = PROMPT_CATEGORIES.map((c) => c.category);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every category a non-empty label and description', () => {
    for (const c of PROMPT_CATEGORIES) {
      expect(c.label.length, `${c.category} label`).toBeGreaterThan(0);
      expect(c.description.length, `${c.category} description`).toBeGreaterThan(0);
    }
  });

  it('refuses a course-specific prompt saved with no course', () => {
    // The exact shape that caused the leak. An unscoped `core` row was one tier
    // walk away from telling every learner they were talking to Mentors
    // International, and nothing rejected it at write time.
    for (const c of courseEditableCategories()) {
      expect(validateCategoryScope(c.category, null), c.category).toBeTruthy();
      expect(validateCategoryScope(c.category, ''), c.category).toBeTruthy();
      expect(validateCategoryScope(c.category, 'some-course'), c.category).toBeNull();
    }
  });

  it('refuses a platform-wide prompt scoped to one course', () => {
    // Their output is parsed as a fixed contract; per-course variants would mean
    // flagging works for one course and silently not for another.
    const platform = PROMPT_CATEGORIES.filter((c) => c.scope === 'platform');
    expect(platform.length).toBeGreaterThan(0);
    for (const c of platform) {
      expect(validateCategoryScope(c.category, 'some-course'), c.category).toBeTruthy();
      expect(validateCategoryScope(c.category, null), c.category).toBeNull();
    }
  });

  it('refuses an unknown category at any scope', () => {
    expect(validateCategoryScope('not_a_category', 'course-a')).toBeTruthy();
    expect(validateCategoryScope('not_a_category', null)).toBeTruthy();
  });

  it('explains why, not just that it refused', () => {
    // An author who hits this needs to understand the consequence, or they will
    // reach for whatever makes the error go away.
    const msg = validateCategoryScope('lesson_delivery', null) ?? '';
    expect(msg).toMatch(/every course/i);
  });

  it('keeps the structured-output prompts platform-scoped', () => {
    // These two are parsed as data, not shown to a learner: a malformed override
    // silently disables auto-flagging or name capture rather than reading oddly.
    const courseEditable = courseEditableCategories().map((c) => c.category);
    expect(courseEditable).not.toContain('sentiment');
    expect(courseEditable).not.toContain('name_extraction');
  });
});
