import { repo } from '@/lib/repo';

/**
 * Loads the active SystemPrompt for a given category from the DB.
 * Falls back to the provided fallback string if no active prompt exists.
 */
export async function loadActivePrompt(
  category: string,
  fallback: string,
): Promise<string> {
  try {
    const prompt = await repo.getActivePrompt(category);
    return prompt?.content ?? fallback;
  } catch {
    return fallback;
  }
}
