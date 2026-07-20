import { Socio } from '@/lib/repo/types';
import {
  InteractionMode,
  LessonDeliveryState,
  CheckinState,
  ReteachState,
  ReminderState,
  MentorSession,
  SocioProgress,
  RouterResult,
} from '../types';
import { getLessonTitle } from '@/lib/lessons/db-lesson-service';
import { DEFAULT_COLLECTION_KEY } from '@/lib/lessons/db-lesson-service';
import { FLAG_RED_THRESHOLD, RETEACH_LEVEL_THRESHOLD, CONFUSION_ESCALATE_THRESHOLD } from '../constants';
import { loadActivePrompt } from '../loadPrompt';
import type { DimensionStateMap } from '@/lib/ai/sensing/types';

// ─── Layer 3: Task Context — One Per Interaction Mode ───────────────
// The router determines the mode; this function returns the right prompt.
// DB-backed prompts override instructional tone; dynamic facts are appended below.
// dimensionState provides continuous comprehension/confusion levels for adaptive responses.

/**
 * Build a dimension state context block for the prompt.
 * Tells the model the student's current understanding level.
 */
function buildDimensionContext(dimensionState?: DimensionStateMap): string {
  if (!dimensionState || Object.keys(dimensionState).length === 0) {
    return '';
  }

  const comprehension = dimensionState['comprehension'];
  const confusion = dimensionState['confusion'];

  const lines: string[] = ['ESTADO DEL ESTUDIANTE (medido automáticamente):'];

  if (comprehension) {
    const level = comprehension.level.toFixed(1);
    const trend = comprehension.trend === 'improving' ? '↑ mejorando'
      : comprehension.trend === 'declining' ? '↓ bajando'
      : '→ estable';
    lines.push(`- Comprensión: ${level}/10 (${trend})`);

    // Add guidance based on level
    if (comprehension.level < RETEACH_LEVEL_THRESHOLD) {
      lines.push('  ⚠️ Comprensión baja — mezcla una breve re-explicación con tu respuesta');
    }
  }

  if (confusion) {
    const level = confusion.level.toFixed(1);
    const trend = confusion.trend === 'improving' ? '↓ disminuyendo'
      : confusion.trend === 'declining' ? '↑ aumentando'
      : '→ estable';
    lines.push(`- Confusión: ${level}/10 (${trend})`);

    // Add guidance based on level
    if (confusion.level >= CONFUSION_ESCALATE_THRESHOLD) {
      lines.push('  ⚠️ Confusión alta — usa lenguaje más simple, ofrece clarificación');
    }
  }

  // Add blending guidance when both dimensions suggest intervention
  if (comprehension && confusion &&
      comprehension.level < RETEACH_LEVEL_THRESHOLD &&
      confusion.level >= 5) {
    lines.push('');
    lines.push('GUÍA DE MEZCLA: El estudiante muestra baja comprensión y algo de confusión.');
    lines.push('En lugar de solo re-enseñar O solo avanzar, mezcla ambos:');
    lines.push('- Aclara brevemente lo confuso (1-2 oraciones)');
    lines.push('- Luego continúa con el contenido normal');
  }

  return lines.join('\n');
}

export async function buildTaskPrompt(
  socio: Socio,
  result: RouterResult,
  progress?: SocioProgress,
  collectionKey: string = DEFAULT_COLLECTION_KEY,
  dimensionState?: DimensionStateMap,
): Promise<string> {
  const dimensionContext = buildDimensionContext(dimensionState);

  let basePrompt: string;

  switch (result.mode) {
    case InteractionMode.LESSON_START:
      basePrompt = await buildLessonStartPrompt(socio, result.lesson!);
      break;
    case InteractionMode.LESSON_DELIVERY:
      basePrompt = await buildLessonDeliveryPrompt(socio, result.lesson!);
      break;
    case InteractionMode.FREEFORM_QUESTION:
      basePrompt = await buildFreeformPrompt(progress, collectionKey);
      break;
    case InteractionMode.CHECKIN:
      basePrompt = await buildCheckinPrompt(socio, result.checkin!);
      break;
    case InteractionMode.RETEACH:
      basePrompt = await buildReteachPrompt(socio, result.reteach!);
      break;
    case InteractionMode.REMINDER:
      basePrompt = await buildReminderPrompt(socio, result.reminder!);
      break;
    case InteractionMode.MENTOR_HANDOFF:
      basePrompt = await buildMentorHandoffPrompt(socio, result.mentor!);
      break;
    case InteractionMode.POST_MENTOR:
      basePrompt = await buildPostMentorPrompt(socio, result.mentor!);
      break;
  }

  // Append dimension context if available
  if (dimensionContext) {
    return `${basePrompt}\n\n${dimensionContext}`;
  }

  return basePrompt;
}

// ─── LESSON_START ───────────────────────────────────────────────────

async function buildLessonStartPrompt(
  socio: Socio,
  lesson: LessonDeliveryState,
): Promise<string> {
  const prev = lesson.previousLessonTitleEs
    ? `  - Lección anterior completada: "${lesson.previousLessonTitleEs}" (puntuación de comprensión: ${lesson.lastUnderstanding ?? 'N/A'}/10)`
    : '';

  const businessNote =
    socio.businessDescription?.trim()
      ? ''
      : '\n- Si no conoces aún el negocio del socio (o no está descrito en el contexto), pregúntale al inicio, de forma breve y amable, en qué consiste, antes de profundizar en el contenido de la lección.';

  const dynamicContext = `CONTEXTO DE ESTA SESIÓN:
- Estás comenzando la Lección ${lesson.lessonNumber}: "${lesson.lessonTitleEs}".
- Categoría: ${lesson.lessonCategory}
- Este es el mensaje 1 de ${lesson.totalMessages}.
${prev ? `- Transición desde la lección anterior:${prev}` : ''}${businessNote}`;

  const defaultInstructions = `TAREA ACTUAL: Iniciar lección nueva

INSTRUCCIONES:
- IMPORTANTE: Comienza tu respuesta anunciando claramente el número y título de la lección. Ejemplo: "📚 Lección 3: Cómo manejar tus gastos". Luego da una breve introducción antes de entrar en el contenido.
- Empieza con una transición natural desde la lección anterior si aplica.
- Introduce el tema con un escenario cotidiano que el socio pueda reconocer.
- Haz que suene como una conversación, no como una clase formal.
- Termina con una pregunta abierta para que el socio se enganche.`;

  const instructions = await loadActivePrompt('lesson_start', defaultInstructions);
  return `${instructions}\n\n${dynamicContext.trim()}`;
}

// ─── LESSON_DELIVERY ────────────────────────────────────────────────

async function buildLessonDeliveryPrompt(
  socio: Socio,
  lesson: LessonDeliveryState,
): Promise<string> {
  const isLastMessage = lesson.messageIndex === lesson.totalMessages;
  const lastMessageNote = isLastMessage
    ? `

INSTRUCCIONES ADICIONALES (ÚLTIMO MENSAJE DE LA LECCIÓN):
- Esta es la última parte de la lección. Al terminar, pide al socio que califique su comprensión del 1 al 10 y emite el marcador [LESSON_COMPLETE:${lesson.lessonNumber}].
- Si es el ÚLTIMO mensaje de la lección (${lesson.messageIndex} == ${lesson.totalMessages}), después de que el socio responda, pregunta: "Del 1 al 10, ¿qué tan bien entendiste esta lección?"
- Si la lección enseña algo práctico, también pregunta: "Del 1 al 10, ¿qué tanto pudiste poner en práctica lo que aprendimos?"
- Cuando el socio dé sus puntuaciones y hayas respondido, agrega [LESSON_COMPLETE:${lesson.lessonNumber}] al final.`
    : '';

  const dynamicContext = `CONTEXTO DE LA LECCIÓN:
- Lección ${lesson.lessonNumber}: "${lesson.lessonTitleEs}"
- Mensaje ${lesson.messageIndex} de ${lesson.totalMessages} en esta lección
- Tipo de mensaje: ${lesson.messageType}
- Negocio del socio (para ejemplos): ${socio.businessDescription || 'no especificado'}`;

  const defaultInstructions = `TAREA ACTUAL: Entregar lección

INSTRUCCIONES:
- Envía el contenido del mensaje adaptándolo al contexto del socio.
- Mantén los conceptos clave exactos del currículo. Puedes cambiar los ejemplos para que sean más relevantes al negocio del socio (ver datos abajo), pero NO cambies los conceptos.
- Después de que el socio responda a este mensaje, avanza al siguiente mensaje de la lección.`;

  const instructions = await loadActivePrompt('lesson_delivery', defaultInstructions);
  return `${instructions}${lastMessageNote}\n\n${dynamicContext.trim()}`;
}

// ─── FREEFORM_QUESTION ──────────────────────────────────────────────

async function buildFreeformPrompt(
  progress?: SocioProgress,
  collectionKey: string = DEFAULT_COLLECTION_KEY,
): Promise<string> {
  const completed = progress?.completedLessons ?? [];
  const currentNum = progress?.currentLessonNumber ?? 1;
  const currentTitle = getLessonTitle(collectionKey, currentNum);

  const completedList = completed.length > 0
    ? completed.map((n) => `${n}: ${getLessonTitle(collectionKey, n)}`).join('\n')
    : 'Ninguna';

  const dynamicContext = `LECCIONES YA COMPLETADAS POR EL SOCIO:
${completedList}

LECCIÓN ACTUAL:
${currentNum}: ${currentTitle}`;

  const defaultInstructions = `TAREA ACTUAL: Responder pregunta del socio

El socio hizo una pregunta por su cuenta, fuera de una lección o check-in.

INSTRUCCIONES:
- Responde usando SOLO información del currículo de Mentors International.
- Usa la referencia curricular proporcionada abajo para fundamentar tu respuesta.
- Si la pregunta se relaciona con una lección que el socio YA completó, refiérela: "¿Recuerdas cuando hablamos sobre [tema] en la Lección [X]? Esto se conecta con eso..."
- Si la pregunta se relaciona con una lección FUTURA, da una respuesta breve y menciona que profundizarán después: "¡Buena pregunta! Vamos a ver eso más a fondo pronto, pero por ahora te cuento lo básico..."
- Si la pregunta NO está cubierta por ninguna lección del currículo, sé honesto: "Eso es algo que no cubre nuestro programa, pero tu mentor humano podría orientarte."
- NO inventes información. Si no está en el currículo, no lo digas.
- Mantén la respuesta en máximo 2-3 mensajes cortos.`;

  const instructions = await loadActivePrompt('freeform', defaultInstructions);
  return `${instructions}\n\n${dynamicContext.trim()}`;
}

// ─── CHECKIN ────────────────────────────────────────────────────────

async function buildCheckinPrompt(socio: Socio, checkin: CheckinState): Promise<string> {
  let stepGuidance = '';

  if (checkin.understandingScore !== undefined) {
    const score = checkin.understandingScore;
    if (score >= 8) {
      stepGuidance = `\nGUÍA: Puntuación ${score}/10 — "¡Excelente! Se nota que le pusiste atención. 🚀" → Avanza al paso 3.`;
    } else if (score >= 6) {
      stepGuidance = `\nGUÍA: Puntuación ${score}/10 — "¡Bien! Vas por buen camino." → Avanza al paso 3.`;
    } else if (score >= 4) {
      stepGuidance = `\nGUÍA: Puntuación ${score}/10 — "No te preocupes, cada quien tiene su ritmo. ¿Qué parte te quedó menos clara?" → Espera respuesta, ofrece aclaración breve, luego avanza al paso 3.`;
    } else {
      stepGuidance = `\nGUÍA: Puntuación ${score}/10 — "Gracias por ser honesto/a. Eso me ayuda a explicarte mejor. ¿Qué parte fue la más confusa?" → NO continúes el check-in. Cambia a modo RETEACH.`;
    }
  }

  if (checkin.revenueReported !== undefined) {
    stepGuidance += `\n
GUÍA PARA RESPONDER AL REPORTE DE INGRESOS:
- Si reporta un número: Reconócelo positivamente sin juzgar. "Gracias por compartir eso. Llevar ese registro es clave."
- Si dice que no sabe o no midió: Anímalo sin regañar. "No pasa nada. Precisamente eso es lo que vamos aprendiendo juntos."
- Si reporta cero o pérdidas: Sé empático. "Entiendo. Las semanas difíciles son parte del camino. Lo importante es que sigues aquí aprendiendo."`;
  }

  const dynamicContext = `DATOS DEL CHECK-IN:
- Nombre del socio (para saludos): ${socio.name || 'Amigo'}
- Paso actual: ${checkin.step} de 5

RESPUESTAS RECIBIDAS HASTA AHORA:
${checkin.responsesSoFar || 'Ninguna'}${stepGuidance}`;

  const defaultInstructions = `TAREA ACTUAL: Check-in semanal

ESTRUCTURA DEL CHECK-IN (sigue este orden estrictamente):
1. SALUDO — "¡Hola [nombre], es nuestra reunión semanal! 👋 ¿Cómo va todo?" (usa el nombre del socio indicado abajo)
2. COMPRENSIÓN — "Del 1 al 10, ¿qué tan bien entendiste la lección de esta semana?"
3. IMPLEMENTACIÓN — "Del 1 al 10, ¿qué tanto pudiste poner en práctica lo que aprendimos?"
4. INGRESOS — "¿Cuánto vendiste esta semana? No importa la cantidad, lo importante es que lo estés midiendo."
5. OBSTÁCULO — "¿Cuál fue tu mayor reto o dificultad esta semana con tu negocio?"

INSTRUCCIONES:
- Estás en el paso indicado abajo. Haz SOLO la pregunta de este paso.
- NO adelantes pasos. Espera la respuesta del socio antes de avanzar.
- Después de cada respuesta, responde brevemente (1-2 oraciones de reconocimiento) y luego haz la siguiente pregunta.
- Después del paso 5, da un breve resumen motivador y despídete hasta la próxima semana.
- Si la comprensión es 1-${FLAG_RED_THRESHOLD}/10, NO continúes el check-in normal. En vez, responde con empatía y prepárate para re-enseñar.`;

  const instructions = await loadActivePrompt('checkin', defaultInstructions);
  return `${instructions}\n\n${dynamicContext.trim()}`;
}

// ─── RETEACH ────────────────────────────────────────────────────────

async function buildReteachPrompt(socio: Socio, reteach: ReteachState): Promise<string> {
  const dynamicContext = `CONTEXTO:
- Lección ${reteach.lessonNumber} ("${reteach.lessonTitleEs}")
- Puntuación de comprensión reportada: ${reteach.understandingScore}/10
- Nombre del socio: ${socio.name || 'amigo'}
- Negocio de referencia: ${socio.businessDescription || 'su emprendimiento'}

MARCADORES (usa este número de lección):
- Completar bien: [LESSON_COMPLETE:${reteach.lessonNumber}]
- Baja persistente: [FLAG:RED|Comprensión baja persistente en Lección ${reteach.lessonNumber} después de re-enseñanza]`;

  const defaultInstructions = `TAREA ACTUAL: Re-enseñar lección

INSTRUCCIONES:
1. Primero, pregunta con empatía qué parte fue confusa: "Entiendo, [nombre]. ¿Qué parte te costó más entender? Así te la explico de otra forma."
2. Espera su respuesta.
3. Explica SOLO la parte que mencionaron, no repitas toda la lección. Usa:
   - Una analogía de la vida diaria (cocinar, ir al mercado, manejar la casa)
   - Un ejemplo concreto usando su negocio (ver datos abajo)
   - Lenguaje aún más simple que la primera vez
4. Máximo 3 mensajes para la re-enseñanza.
5. Después pregunta: "¿Ahora quedó más claro? Del 1 al 10, ¿cómo te sientes con esta lección?"
6. Si la nueva puntuación es 4+, celebra y avanza: "¡Ahí vamos! 💪" → Agrega [LESSON_COMPLETE] con el número de lección indicado abajo.
7. Si sigue en 1-${FLAG_RED_THRESHOLD} después de re-enseñar, responde con ánimo: "No te preocupes, vamos a seguir practicando. Tu mentor humano también puede ayudarte con esto." → Agrega [FLAG:RED] según indicación abajo.`;

  const instructions = await loadActivePrompt('reteach', defaultInstructions);
  return `${instructions}\n\n${dynamicContext.trim()}`;
}

// ─── REMINDER ───────────────────────────────────────────────────────

async function buildReminderPrompt(socio: Socio, reminder: ReminderState): Promise<string> {
  const dynamicContext = `CONTEXTO:
- Lección ${reminder.lessonNumber} ("${reminder.lessonTitleEs}")
- Se quedó en el mensaje ${reminder.messageIndex} de ${reminder.totalMessages}
- Recordatorio ${reminder.reminderNumber} de ${reminder.maxReminders}
- Nombre del socio: ${socio.name || 'amigo'}
- Ejemplo de tono: "Hola ${socio.name || 'amigo'}, estábamos hablando sobre ${reminder.lessonTitleEs}. ¿Quieres que sigamos? 😊"`;

  const defaultInstructions = `TAREA ACTUAL: Enviar recordatorio

INSTRUCCIONES:
- Envía UN solo mensaje corto y amigable.
- Menciona el tema específico según el contexto, no digas "tu lección": usa el título de la lección indicado abajo.
- No presiones ni hagas sentir culpa.
- Si es el último recordatorio permitido, que suene natural, no como una advertencia.`;

  const instructions = await loadActivePrompt('reminder', defaultInstructions);
  return `${instructions}\n\n${dynamicContext.trim()}`;
}

// ─── MENTOR_HANDOFF ─────────────────────────────────────────────────

async function buildMentorHandoffPrompt(socio: Socio, mentor: MentorSession): Promise<string> {
  const dynamicContext = `CONTEXTO:
- Socio: ${socio.name || 'el socio'}
- Mentor humano: ${mentor.mentorName}`;

  const defaultInstructions = `TAREA ACTUAL: Transferencia a mentor humano

INSTRUCCIONES:
- Envía exactamente UN mensaje: "¡Hola [nombre socio]! [nombre mentor] está aquí para ayudarte personalmente. 👋 Te dejo en buenas manos." (usa los nombres indicados arriba)
- Después de enviar este mensaje, NO respondas más hasta que el mentor se retire.
- No resumas la conversación al socio — el mentor tiene acceso al resumen en su dashboard.`;

  const instructions = await loadActivePrompt('mentor_handoff', defaultInstructions);
  return `${instructions}\n\n${dynamicContext.trim()}`;
}

// ─── POST_MENTOR ────────────────────────────────────────────────────

async function buildPostMentorPrompt(socio: Socio, mentor: MentorSession): Promise<string> {
  const notesLine = mentor.mentorNotes
    ? `- Notas del mentor (refiérete brevemente si son relevantes): ${mentor.mentorNotes}`
    : '';

  const dynamicContext = `CONTEXTO:
- Socio: ${socio.name || 'el socio'}
- Mentor humano: ${mentor.mentorName}
${notesLine}`;

  const defaultInstructions = `TAREA ACTUAL: Reanudar después de intervención de mentor

INSTRUCCIONES:
- Saluda brevemente: "¡Hola [nombre socio]! Espero que la charla con [nombre mentor] haya sido útil." (usa los nombres indicados arriba)
- Si hay notas del mentor en el contexto, refiérelas brevemente si son relevantes.
- Retoma el flujo normal. Si hay una lección pendiente, ofrece continuarla. Si no, espera a que el socio inicie contacto.
- No repitas lo que el mentor ya cubrió.`;

  const instructions = await loadActivePrompt('post_mentor', defaultInstructions);
  return `${instructions}\n\n${dynamicContext.trim()}`;
}
