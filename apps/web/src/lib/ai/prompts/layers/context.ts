import { Socio } from '@/lib/repo/types';
import { SocioProgress } from '../types';

// ─── Layer 2: Socio Context (~150 tokens) — Always Sent ────────────
// Built dynamically from the database for every message.

const LESSON_TITLES: Record<number, string> = {
  1: 'Registros Financieros',
  2: 'Entidades Separadas',
  3: 'Presupuesto del Negocio',
  4: 'Ahorro',
  5: 'Punto de Equilibrio',
  6: '¿A Quién Vendo?',
  7: '¿Qué Vendo?',
  8: 'Precio Justo',
  9: 'Dónde y Cómo Vender Más',
  10: 'Servicio al Cliente',
  11: 'Técnicas de Venta',
  12: 'Ventas por WhatsApp',
  13: 'Deudas Bajo Control',
  14: 'Plan de Pago de Deudas',
  15: 'Cuándo Pedir un Préstamo',
  16: 'Proyectar el Negocio',
  17: 'Inventario',
  18: 'Metas Personales y Objetivos SMART',
  19: 'Ley de la Expectativa',
  20: 'Ley del Orden',
  21: 'Ley del Reloj y la Oportunidad',
  22: 'Ley de la Cosecha',
  23: 'Ley del Balance',
  24: 'Ley del 1%',
  25: 'Valores Personales y de Negocio',
  26: 'Ley del Crecimiento',
  27: 'Ley de la Gratitud',
  28: 'Mi Propósito',
};

export function getLessonTitle(lessonNumber: number): string {
  return LESSON_TITLES[lessonNumber] ?? `Lección ${lessonNumber}`;
}

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
