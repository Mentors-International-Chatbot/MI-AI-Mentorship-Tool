/**
 * Admin socios filter construction.
 *
 * The point of this module is that the paginated list and the course rollups
 * build their `where` from one place. These lock down the course filter added
 * for the rollup cards, and the fact that pagination never leaks into it.
 */
import { describe, it, expect } from 'vitest';
import { UNASSIGNED_COURSE_KEY } from '@/app/dashboard/learners/courseRollup';
import { buildSocioWhere } from '../filters';

function where(query: string) {
  return buildSocioWhere(new URLSearchParams(query));
}

describe('buildSocioWhere — course filter', () => {
  it('filters by collection key', () => {
    expect(where('collectionKey=pbj-basics').curriculumCollectionKey).toBe('pbj-basics');
  });

  it('treats the unassigned sentinel as a null key, not a literal', () => {
    expect(where(`collectionKey=${UNASSIGNED_COURSE_KEY}`).curriculumCollectionKey).toBeNull();
  });

  it('omits the key entirely when no course is selected', () => {
    expect(where('')).not.toHaveProperty('curriculumCollectionKey');
  });
});

describe('buildSocioWhere — composition', () => {
  it('composes course with the other filters', () => {
    const result = where('collectionKey=pbj-basics&status=ACTIVE&mentorId=m-1');
    expect(result.curriculumCollectionKey).toBe('pbj-basics');
    expect(result.status).toBe('ACTIVE');
    expect(result.mentorId).toBe('m-1');
  });

  it('maps the unassigned-mentor sentinel to null', () => {
    expect(where('mentorId=unassigned').mentorId).toBeNull();
  });

  it('ignores pagination — rollups must not be per-page', () => {
    expect(where('page=3&pageSize=50')).toEqual({ archivedAt: null });
  });

  it('builds a where with only the unconditional archived exclusion for no filters', () => {
    // A.3: archivedAt: null is unconditional (no "show archived" toggle
    // exists yet), so "no filters" is no longer a truly empty where.
    expect(where('')).toEqual({ archivedAt: null });
  });
});

describe('buildSocioWhere — D.2 course-lead scope restriction', () => {
  it('restricts to the given collections when no collectionKey is selected', () => {
    const result = buildSocioWhere(new URLSearchParams(''), ['course-a', 'course-b']);
    expect(result.AND).toEqual([{ curriculumCollectionKey: { in: ['course-a', 'course-b'] } }]);
  });

  it('a course lead with zero writable collections sees zero socios, not everyone', () => {
    const result = buildSocioWhere(new URLSearchParams(''), []);
    expect(result.AND).toEqual([{ curriculumCollectionKey: { in: [] } }]);
  });

  it('ANDs the restriction with an explicit collectionKey selection, never overwrites it', () => {
    const result = buildSocioWhere(new URLSearchParams('collectionKey=course-a'), ['course-a', 'course-b']);
    expect(result.curriculumCollectionKey).toBe('course-a');
    expect(result.AND).toEqual([{ curriculumCollectionKey: { in: ['course-a', 'course-b'] } }]);
  });

  it('naming a course outside the restriction yields a contradiction (empty results), not a leak', () => {
    const result = buildSocioWhere(new URLSearchParams('collectionKey=other-course'), ['course-a']);
    expect(result.curriculumCollectionKey).toBe('other-course');
    expect(result.AND).toEqual([{ curriculumCollectionKey: { in: ['course-a'] } }]);
  });

  it('admin (undefined restriction) is unaffected — no AND clause at all', () => {
    const result = buildSocioWhere(new URLSearchParams('collectionKey=course-a'));
    expect(result).not.toHaveProperty('AND');
  });
});
