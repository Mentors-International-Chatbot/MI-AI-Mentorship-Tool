/**
 * Filter construction for the admin socios list.
 *
 * Shared by the paginated list and the course rollups so the cards always
 * describe exactly the set the table is drawn from. If these were built
 * separately they would drift the first time a filter was added to one.
 */
import { Prisma } from '@prisma/client';
import { UNASSIGNED_COURSE_KEY } from '@/app/dashboard/learners/courseRollup';
import { activeFlagWhere } from '@/lib/flags/active';

/**
 * Translates the list's query parameters into a Prisma `where`.
 *
 * Pagination is deliberately not represented here — rollups are computed over
 * the whole filtered set, never over one page.
 */
export function buildSocioWhere(params: URLSearchParams): Prisma.SocioWhereInput {
  const status = params.get('status');
  const search = params.get('search');
  const mentorId = params.get('mentorId');
  const activeWithin = params.get('activeWithin'); // e.g. "7d"
  const flagLevel = params.get('flagLevel'); // "RED" or "YELLOW"
  const completedLesson = params.get('completedLesson'); // lesson number
  const lessonNumber = params.get('lessonNumber'); // lesson number
  const collectionKey = params.get('collectionKey');

  const where: Prisma.SocioWhereInput = {};

  if (status) {
    where.status = status as Prisma.SocioWhereInput['status'];
  }
  if (mentorId) {
    where.mentorId = mentorId === 'unassigned' ? null : mentorId;
  }
  if (collectionKey) {
    // "No course" is a real selection, not the absence of one.
    where.curriculumCollectionKey =
      collectionKey === UNASSIGNED_COURSE_KEY ? null : collectionKey;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { businessName: { contains: search, mode: 'insensitive' } },
      { businessDescription: { contains: search, mode: 'insensitive' } },
      { externalId: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (activeWithin) {
    const days = parseInt(activeWithin.replace('d', ''), 10);
    if (!isNaN(days)) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      where.progress = { lastInteractionAt: { gte: since } };
    }
  }
  if (flagLevel) {
    where.flags = { some: { level: flagLevel, ...activeFlagWhere() } };
  }
  if (completedLesson) {
    const num = parseInt(completedLesson, 10);
    if (!isNaN(num)) {
      where.lessonProgress = {
        some: { lessonNumber: num, completedAt: { not: null } },
      };
    }
  }
  if (lessonNumber) {
    const num = parseInt(lessonNumber, 10);
    if (!isNaN(num)) {
      where.lessonProgress = {
        some: { lessonNumber: num },
      };
    }
  }

  return where;
}
