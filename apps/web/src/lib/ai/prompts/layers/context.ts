import { Socio } from '@/lib/repo/types';
import { SocioProgress } from '../types';
import { getLessonTitle, getLessonCount, DEFAULT_COLLECTION_KEY } from '@/lib/lessons/db-lesson-service';
import { repo } from '@/lib/repo';

// ─── Layer 2: Socio Context (~150 tokens) — Always Sent ────────────
// Built dynamically from the database for every message.

export { getLessonTitle };

function formatCompletedLessons(completed: number[], collectionKey: string): string {
  if (completed.length === 0) return 'Ninguna';
  return completed
    .map((n) => `${n} (${getLessonTitle(collectionKey, n)})`)
    .join(', ');
}

export async function buildContextPrompt(
  socio: Socio,
  progress?: SocioProgress,
  collectionKey: string = DEFAULT_COLLECTION_KEY,
): Promise<string> {
  const context = await repo.getSocioContext(socio.id);

  if (!progress || progress.completedLessons.length === 0) {
    return buildNewSocioContext(socio, context, collectionKey);
  }

  const currentTitle = getLessonTitle(collectionKey, progress.currentLessonNumber);

  let block = `CONTEXTO DEL SOCIO:
- Nombre: ${socio.name || 'Amigo'}
- Negocio: ${socio.businessDescription || 'No especificado aún'}
- Tipo de negocio: ${socio.businessName || 'No especificado'}
- Lección actual: ${progress.currentLessonNumber} — "${currentTitle}"
- Lecciones completadas: ${formatCompletedLessons(progress.completedLessons, collectionKey)}
- Última comprensión: ${progress.weeklyUnderstanding ?? 'N/A'}/10
- Última implementación: ${progress.weeklyImplementation ?? 'N/A'}/10
- Días desde último contacto: ${progress.daysSinceLastInteraction}
- Banderas activas: Ninguna`;

  const contextSection = buildPersistentContextSection(context);
  if (contextSection) {
    block += contextSection;
  }

  block += `\n\nUsa el nombre del socio naturalmente en la conversación. Si conoces su tipo de negocio, personaliza tus ejemplos para que sean relevantes (ej: si tiene una panadería, habla de ventas de pan, no de ropa).`;

  return block;
}

function buildNewSocioContext(
  socio: Socio,
  context: Awaited<ReturnType<typeof repo.getSocioContext>>,
  collectionKey: string,
): string {
  const lessonTitle = getLessonTitle(collectionKey, 1);
  const totalLessons = getLessonCount(collectionKey);

  let block = `CONTEXTO DEL SOCIO:
- Nombre: ${socio.name || 'Amigo'}
- Negocio: ${socio.businessDescription || 'Aún no conocemos su negocio.'}
- Lección actual: 1${totalLessons > 0 ? ` de ${totalLessons}` : ''} — "${lessonTitle}"
- Es su primera lección. Sé especialmente cálido y motivador.
- Banderas activas: Ninguna`;

  const contextSection = buildPersistentContextSection(context);
  if (contextSection) {
    block += contextSection;
  } else {
    block += `\n\nEste socio acaba de empezar el programa. Hazlo sentir bienvenido y emocionado por aprender. Pregúntale sobre su negocio si aún no lo sabemos.`;
  }

  return block;
}

function buildPersistentContextSection(
  context: Awaited<ReturnType<typeof repo.getSocioContext>>,
): string | null {
  if (!context) return null;

  const facts: string[] = [];
  if (context.businessType) facts.push(`Tipo de negocio: ${context.businessType}`);
  if (context.products) facts.push(`Productos/servicios: ${context.products}`);
  if (context.monthlyRevenue) facts.push(`Ingresos mensuales: ${context.monthlyRevenue}`);
  if (context.monthlyExpenses) facts.push(`Gastos mensuales: ${context.monthlyExpenses}`);
  if (context.numEmployees) facts.push(`Empleados: ${context.numEmployees}`);
  if (context.location) facts.push(`Ubicación: ${context.location}`);
  if (context.challenges) facts.push(`Desafíos: ${context.challenges}`);
  if (context.goals) facts.push(`Metas: ${context.goals}`);
  if (context.familyContext) facts.push(`Contexto familiar: ${context.familyContext}`);
  if (context.customFacts) facts.push(`Otros datos: ${context.customFacts}`);

  if (facts.length === 0) return null;

  return `\n\nDATOS DEL SOCIO (recopilados de conversaciones anteriores):\n${facts.join('\n')}\n\nIMPORTANTE: Ya conoces estos datos. NO vuelvas a preguntar información que ya tienes. Úsala naturalmente en tus respuestas.`;
}
