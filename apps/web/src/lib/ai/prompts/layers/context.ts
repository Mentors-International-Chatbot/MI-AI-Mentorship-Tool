import { Socio } from '@/lib/repo/types';
import { SocioProgress } from '../types';
import { getLessonTitle } from '@/lib/lessons/data';

// ─── Layer 2: Socio Context (~150 tokens) — Always Sent ────────────
// Built dynamically from the database for every message.

export { getLessonTitle };

function formatCompletedLessons(completed: number[]): string {
  if (completed.length === 0) return 'Ninguna';
  return completed
    .map((n) => `${n} (${getLessonTitle(n)})`)
    .join(', ');
}

export function buildContextPrompt(
  socio: Socio,
  progress?: SocioProgress,
): string {
  if (!progress || progress.completedLessons.length === 0) {
    return buildNewSocioContext(socio);
  }

  const currentTitle = getLessonTitle(progress.currentLessonNumber);

  return `CONTEXTO DEL SOCIO:
- Nombre: ${socio.name || 'Amigo'}
- Negocio: ${socio.businessDescription || 'No especificado aún'}
- Tipo de negocio: ${socio.businessName || 'No especificado'}
- Lección actual: ${progress.currentLessonNumber} de 28 — "${currentTitle}"
- Lecciones completadas: ${formatCompletedLessons(progress.completedLessons)}
- Última comprensión: ${progress.weeklyUnderstanding ?? 'N/A'}/10
- Última implementación: ${progress.weeklyImplementation ?? 'N/A'}/10
- Días desde último contacto: ${progress.daysSinceLastInteraction}
- Banderas activas: Ninguna

Usa el nombre del socio naturalmente en la conversación. Si conoces su tipo de negocio, personaliza tus ejemplos para que sean relevantes (ej: si tiene una panadería, habla de ventas de pan, no de ropa).`;
}

function buildNewSocioContext(socio: Socio): string {
  return `CONTEXTO DEL SOCIO:
- Nombre: ${socio.name || 'Amigo'}
- Negocio: ${socio.businessDescription || 'Aún no conocemos su negocio.'}
- Lección actual: 1 de 28 — "Registros Financieros"
- Es su primera lección. Sé especialmente cálido y motivador.
- Banderas activas: Ninguna

Este socio acaba de empezar el programa. Hazlo sentir bienvenido y emocionado por aprender. Pregúntale sobre su negocio si aún no lo sabemos.`;
}
