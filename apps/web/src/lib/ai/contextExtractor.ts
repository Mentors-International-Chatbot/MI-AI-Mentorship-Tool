import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { repo } from '@/lib/repo';

const EXTRACTION_PROMPT = `Analiza esta conversación reciente y extrae SOLO datos nuevos o actualizados sobre el socio.
Responde ÚNICAMENTE con JSON válido. Solo incluye campos donde encontraste información nueva o actualizada.
Si no hay información nueva para un campo, NO lo incluyas.

Campos posibles:
- businessType: tipo de negocio (ej: "tienda de ropa", "venta de empanadas")
- products: productos o servicios que vende
- monthlyRevenue: ingresos mensuales mencionados
- monthlyExpenses: gastos mensuales mencionados
- numEmployees: cantidad de empleados
- location: ubicación del negocio
- challenges: problemas o desafíos mencionados
- goals: metas o planes futuros
- familyContext: contexto familiar relevante
- customFacts: cualquier otro dato importante

Ejemplo de respuesta si el socio mencionó que vende zapatos y gana 800,000 COP:
{"products":"zapatos","monthlyRevenue":"800,000 COP"}

Ejemplo si no hay nada nuevo:
{}`;

export async function extractAndStoreContext(
    socioId: string,
    userMessage: string,
    aiResponse: string,
): Promise<void> {
    try {
        const chat = new ChatAnthropic({
            model: 'claude-haiku-4-5-20251001',
            temperature: 0,
            maxTokens: 300,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        });

        const response = await chat.invoke([
            new SystemMessage(EXTRACTION_PROMPT),
            new HumanMessage(`SOCIO: ${userMessage}\nIA: ${aiResponse}`),
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
