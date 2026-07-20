import { InteractionMode, LessonDeliveryState, ReteachState, RouterResult } from '../types';
import { getLessonData, hasLessonData, DEFAULT_COLLECTION_KEY } from '@/lib/lessons/db-lesson-service';

// ─── Layer 4: Lesson Content — Only During Teaching Modes ───────────
// Provides the actual curriculum material the AI needs to teach from.
// Only included for LESSON_START, LESSON_DELIVERY, FREEFORM_QUESTION, and RETEACH.

export function buildContentPrompt(
  result: RouterResult,
  collectionKey: string = DEFAULT_COLLECTION_KEY,
): string | null {
  switch (result.mode) {
    case InteractionMode.LESSON_START:
    case InteractionMode.LESSON_DELIVERY:
      return buildLessonContentBlock(result.lesson!);
    case InteractionMode.FREEFORM_QUESTION:
      return buildFreeformReferenceBlock();
    case InteractionMode.RETEACH:
      return buildReteachContentBlock(result.reteach!, collectionKey);
    default:
      return null;
  }
}

// ─── Lesson Content Block ───────────────────────────────────────────
// Injected when delivering or starting a lesson.

function buildLessonContentBlock(lesson: LessonDeliveryState): string {
  return `CONTENIDO DE LA LECCIÓN ${lesson.lessonNumber}: "${lesson.lessonTitleEs}"
Categoría: ${lesson.lessonCategory}

CONCEPTOS CLAVE DE ESTA LECCIÓN:
${lesson.keyConcepts}

MENSAJE A ENTREGAR (Mensaje ${lesson.messageIndex} de ${lesson.totalMessages}):
Tipo: ${lesson.messageType}
Contenido base:
"${lesson.messageContentEs}"

EJERCICIO DE LA LECCIÓN:
${lesson.exercise}

COMPROMISO ESPERADO:
${lesson.commitment}

NOTA: Puedes adaptar los ejemplos al negocio del socio, pero los conceptos clave y la fórmula/estructura deben permanecer exactos.`;
}

// ─── Freeform Reference Block ───────────────────────────────────────
// Provides condensed lesson summaries so the AI can answer questions
// grounded in the curriculum. Only the most relevant lessons should be
// included (via keyword search at call-time). For now, we include the
// full lesson index so the AI has something to work with.

export const LESSON_SUMMARY_INDEX = `ÍNDICE DE LECCIONES:
1. Registros Financieros — Anotar ingresos y gastos diarios para saber si el negocio gana o pierde.
2. Entidades Separadas — Separar la plata del negocio de la plata personal; definir un salario.
3. Presupuesto del Negocio — Planificar cuánto se espera ganar y gastar cada mes.
4. Ahorro — Apartar mínimo 10% de ingresos; crear un fondo de emergencia.
5. Punto de Equilibrio — Calcular cuántas unidades vender para cubrir todos los costos.
6. ¿A Quién Vendo? — Identificar el cliente ideal y el nicho de mercado.
7. ¿Qué Vendo? — Mejorar el producto según lo que el cliente necesita.
8. Precio Justo — Calcular costos reales y definir un precio que cubra gastos y deje ganancia.
9. Dónde y Cómo Vender Más — Punto de venta, promoción, y embudo de ventas.
10. Servicio al Cliente — Atención profesional para fidelizar clientes.
11. Técnicas de Venta — Estrategias prácticas para cerrar más ventas.
12. Ventas por WhatsApp — Usar WhatsApp Business como canal de ventas.
13. Deudas Bajo Control — Identificar y organizar todas las deudas.
14. Plan de Pago de Deudas — Crear un plan para pagar deudas de forma ordenada.
15. Cuándo Pedir un Préstamo — Evaluar si un préstamo es necesario y manejable.
16. Proyectar el Negocio — Planificar el crecimiento a futuro.
17. Inventario — Controlar qué tienes, cuánto tienes, y cuándo reponer.
18. Metas Personales y Objetivos SMART — Definir metas claras y alcanzables.
19. Ley de la Expectativa — Lo que esperas influye en lo que logras.
20. Ley del Orden — El orden en tu vida y negocio trae paz y productividad.
21. Ley del Reloj y la Oportunidad — Aprovechar el tiempo y las oportunidades.
22. Ley de la Cosecha — Lo que siembras es lo que recoges.
23. Ley del Balance — Equilibrio entre negocio, familia, y bienestar.
24. Ley del 1% — Mejorar un poquito cada día genera grandes resultados.
25. Valores Personales y de Negocio — Definir los valores que guían tus decisiones.
26. Ley del Crecimiento — Crecer requiere incomodidad y aprendizaje constante.
27. Ley de la Gratitud — Agradecer lo que tienes mientras trabajas por más.
28. Mi Propósito — Conectar tu negocio con tu propósito de vida.`;

function buildFreeformReferenceBlock(): string {
  // Future: use keyword search (findRelevantLessons) to return only
  // the 1-3 most relevant lessons instead of the full index.
  // For now, the full index is ~300 tokens — acceptable for the pilot.
  return `REFERENCIA CURRICULAR (usa solo esta información para responder):

${LESSON_SUMMARY_INDEX}

Si la pregunta del socio no se puede responder con esta referencia, di honestamente que no tienes esa información.`;
}

// ─── Reteach Content Block ──────────────────────────────────────────
// During reteaching, include more detail than normal delivery.
// Future: pull full lesson detail from a lessons DB table.

function buildReteachContentBlock(
  reteach: ReteachState,
  collectionKey: string = DEFAULT_COLLECTION_KEY,
): string {
  if (hasLessonData(collectionKey, reteach.lessonNumber)) {
    const lesson = getLessonData(collectionKey, reteach.lessonNumber);
    const keyConcepts = lesson.keyConcepts.map(c => `- ${c}`).join('\n');
    const selfCheck = lesson.selfCheckQuestions.map(q => `- ${q}`).join('\n');

    return `MATERIAL COMPLETO DE LA LECCIÓN ${reteach.lessonNumber}: "${reteach.lessonTitleEs}"

AUTODIAGNÓSTICO:
${selfCheck}

CONCEPTOS CLAVE:
${keyConcepts}

EJERCICIO:
${lesson.exercise}

COMPROMISO:
${lesson.commitment}

Usa este material para explicar de una forma diferente a como se presentó la primera vez. Busca analogías nuevas y ejemplos del negocio del socio.`;
  }

  return `MATERIAL DE REFERENCIA PARA RE-ENSEÑANZA — Lección ${reteach.lessonNumber}: "${reteach.lessonTitleEs}"

Usa este material para explicar de una forma diferente a como se presentó la primera vez. Busca analogías nuevas y ejemplos del negocio del socio.

${LESSON_SUMMARY_INDEX}`;
}
