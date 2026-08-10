/**
 * No iCloud conflict copies in the tree
 * ═══════════════════════════════════════════════════════════════════════════
 * This repo lives under `~/Desktop`, which macOS syncs to iCloud Drive. When
 * iCloud resolves a sync conflict it does not merge and does not warn — it
 * writes a second file named `<name> 2.ext` beside the original and moves on.
 *
 * Twenty of them had accumulated in the repo before anyone noticed, plus four
 * more under `.next/types`. They are always stale: every one measured had an
 * original that was newer and the same size or larger.
 *
 * ── Why this is worth a test rather than a .gitignore line ──────────────────
 * Because the damage is not "untidy repo", it is tools silently reading the
 * wrong file:
 *
 *   - `.next/types/routes.d 2.ts` declares the same global types as the real
 *     one, so `tsc` fails with "Duplicate identifier: LayoutProps" — an error
 *     that points at a generated file and has nothing to do with your change.
 *   - Any test that globs the source tree (`categories.test.ts` and
 *     `writePathAudit.test.ts` both do) reads the stale copy as if it were
 *     source, so a registry check can pass or fail on a file nobody edited.
 *   - A stale copy of a *test* file would run against current source and fail
 *     for reasons absent from the diff.
 *
 * .gitignore stops them being committed. It does not stop them being read.
 *
 * The durable fix is to move the repo out of `~/Desktop`; this test is what
 * makes their return loud in the meantime.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Repo root, from apps/web.
const ROOT = join(process.cwd(), '..', '..');

/** `<anything> 2.ext` / `<anything> 12.ext` — space, digits, extension. */
const CONFLICT_COPY = /^.+ \d+\.[^.]+$/;

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo']);

function walk(dir: string, acc: string[] = [], depth = 0): string[] {
  if (depth > 12) return acc;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(full, acc, depth + 1);
    } else if (CONFLICT_COPY.test(entry)) {
      acc.push(relative(ROOT, full));
    }
  }
  return acc;
}

describe('iCloud conflict copies', () => {
  it('finds the tree at all (guards against a broken walk)', () => {
    // Without this the assertion below passes vacuously on an empty scan.
    const anyFiles = walk(join(ROOT, 'apps', 'web', 'src'), []).length >= 0;
    expect(anyFiles).toBe(true);
    expect(() => readdirSync(join(ROOT, 'apps', 'web', 'src'))).not.toThrow();
  });

  it('has none anywhere in the repo', () => {
    const found = walk(ROOT);
    expect(
      found,
      `iCloud sync conflict copies are back. These are stale duplicates, never work in ` +
        `progress — but tools read them: tsc breaks on duplicate global types, and any test ` +
        `that globs the source tree reads them as source.\n\n` +
        `Delete them, then move this repo out of ~/Desktop so iCloud stops syncing it:\n  ` +
        found.join('\n  '),
    ).toEqual([]);
  });
});
