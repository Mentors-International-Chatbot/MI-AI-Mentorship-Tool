import { prisma } from '@/lib/db';

/**
 * Loads the active SystemPrompt for a given category from the DB.
 * Falls back to the provided fallback string if no active prompt exists.
 */
export async function loadActivePrompt(
  category: string,
  fallback: string,
): Promise<string> {
  try {
    const row = await prisma.systemPrompt.findFirst({
      where: { category, active: true },
      orderBy: { createdAt: 'desc' },
    });
    return row?.content ?? fallback;
  } catch {
    return fallback;
  }
}
