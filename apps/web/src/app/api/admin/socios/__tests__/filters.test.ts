/**
 * Admin socios filter construction.
 *
 * The point of this module is that the paginated list and the course rollups
 * build their `where` from one place. These lock down the course filter added
 * for the rollup cards, and the fact that pagination never leaks into it.
 */
import { describe, it, expect } from 'vitest';
import { UNASSIGNED_COURSE_KEY } from '@/app/dashboard/socios/courseRollup';
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
    expect(where('page=3&pageSize=50')).toEqual({});
  });

  it('builds an empty where for no filters', () => {
    expect(where('')).toEqual({});
  });
});
