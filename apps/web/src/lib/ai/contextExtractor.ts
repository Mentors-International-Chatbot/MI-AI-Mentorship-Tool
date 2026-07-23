import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { repo } from '@/lib/repo';
import { createOpenRouterChat } from '@/lib/ai/openrouter';
import { getCourseMeta } from '@/lib/courses/course-meta';

/**
 * Builds extraction prompt based on learnerContext.fields from course config.
 * If no learnerContext, returns null (no extraction needed).
 */
async function buildExtractionPrompt(socioId: string): Promise<string | null> {
    // Get socio to find their curriculum
    const socio = await repo.getSocioById(socioId);
    if (!socio?.curriculumCollectionKey) {
        return null; // No course = no context extraction
    }

    const meta = await getCourseMeta(socio.curriculumCollectionKey);
    if (!meta.learnerContext) {
        return null; // No learnerContext defined = no extraction
    }

    // Build field list from config
    const configFields = meta.learnerContext.fields;
    if (configFields.length === 0) {
        return null; // No fields to extract
    }

    // Build the fields section dynamically
    const fieldsDescription = configFields
        .map(f => `- ${f.key}: ${f.extractionHint || f.key}`)
        .join('\n');

    // Always include these generic fields that any course might use
    const genericFields = `- challenges: problems or difficulties mentioned
- goals: future plans or objectives
- familyContext: relevant family context
- customFacts: any other important information`;

    return `Analyze this recent conversation and extract ONLY new or updated information about the participant.
Respond ONLY with valid JSON. Only include fields where you found new or updated information.
If there is no new information for a field, do NOT include it.

Fields to extract:
${fieldsDescription}
${genericFields}

Example response if the participant mentioned they sell shoes:
{"businessType":"shoe sales"}

Example if nothing new:
{}`;
}

export async function extractAndStoreContext(
    socioId: string,
    userMessage: string,
    aiResponse: string,
): Promise<void> {
    try {
        // Build prompt based on course config
        const extractionPrompt = await buildExtractionPrompt(socioId);

        // No extraction needed for courses without learnerContext
        if (!extractionPrompt) {
            return;
        }

        const chat = createOpenRouterChat({
            temperature: 0,
            maxTokens: 300,
        });

        const response = await chat.invoke([
            new SystemMessage(extractionPrompt),
            new HumanMessage(`PARTICIPANT: ${userMessage}\nMENTOR: ${aiResponse}`),
        ]);

        const raw = typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);

        const cleaned = raw.replace(/```json\s*|```/g, '').trim();
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
            console.log('[ContextExtractor] No JSON object found in response, skipping');
            return;
        }
        const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));

        const hasData = Object.values(parsed).some(v => v !== null && v !== undefined && v !== '');
        if (hasData) {
            await repo.upsertSocioContext(socioId, parsed);
        }
    } catch (error) {
        console.error('[ContextExtractor] Failed:', error);
    }
}
