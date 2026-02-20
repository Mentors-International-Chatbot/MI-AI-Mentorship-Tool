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
import { getLessonTitle } from './context';

// ─── Layer 3: Task Context — One Per Interaction Mode ───────────────
// The router determines the mode; this function returns the right prompt.

export function buildTaskPrompt(
  socio: Socio,
  result: RouterResult,
  progress?: SocioProgress,
): string {
  switch (result.mode) {
    case InteractionMode.LESSON_START:
      return buildLessonStartPrompt(socio, result.lesson!);
    case InteractionMode.LESSON_DELIVERY:
      return buildLessonDeliveryPrompt(socio, result.lesson!);
    case InteractionMode.FREEFORM_QUESTION:
      return buildFreeformPrompt(progress);
    case InteractionMode.CHECKIN:
      return buildCheckinPrompt(socio, result.checkin!);
    case InteractionMode.RETEACH:
      return buildReteachPrompt(socio, result.reteach!);
    case InteractionMode.REMINDER:
      return buildReminderPrompt(socio, result.reminder!);
    case InteractionMode.MENTOR_HANDOFF:
      return buildMentorHandoffPrompt(socio, result.mentor!);
    case InteractionMode.POST_MENTOR:
      return buildPostMentorPrompt(socio, result.mentor!);
  }
}

// ─── LESSON_START ───────────────────────────────────────────────────

function buildLessonStartPrompt(socio: Socio, lesson: LessonDeliveryState): string {
  const prev = lesson.previousLessonTitleEs
    ? `  - Lección anterior completada: "${lesson.previousLessonTitleEs}" (puntuación de comprensión: ${lesson.lastUnderstanding ?? 'N/A'}/10)`
    : '';

  return `TAREA ACTUAL: Iniciar lección nueva

Estás comenzando la Lección ${lesson.lessonNumber}: "${lesson.lessonTitleEs}".
Categoría: ${lesson.lessonCategory}
Este es el mensaje 1 de ${lesson.totalMessages}.

INSTRUCCIONES:
- Empieza con una transición natural desde la lección anterior si aplica.
${prev}
- Introduce el tema con un escenario cotidiano que el socio pueda reconocer.
- Haz que suene como una conversación, no como una clase formal.
- Termina con una pregunta abierta para que el socio se enganche.`;
}

// ─── LESSON_DELIVERY ────────────────────────────────────────────────

function buildLessonDeliveryPrompt(socio: Socio, lesson: LessonDeliveryState): string {
  const isLastMessage = lesson.messageIndex === lesson.totalMessages;
  const lastMessageNote = isLastMessage
    ? `\n- Si es el ÚLTIMO mensaje de la lección (${lesson.messageIndex} == ${lesson.totalMessages}), después de que el socio responda, pregunta: "Del 1 al 10, ¿qué tan bien entendiste esta lección?"
- Si la lección enseña algo práctico, también pregunta: "Del 1 al 10, ¿qué tanto pudiste poner en práctica lo que aprendimos?"
- Cuando el socio dé sus puntuaciones y hayas respondido, agrega [LESSON_COMPLETE:${lesson.lessonNumber}] al final.`
    : '';

  return `TAREA ACTUAL: Entregar lección

Estás entregando la Lección ${lesson.lessonNumber}: "${lesson.lessonTitleEs}".
Mensaje ${lesson.messageIndex} de ${lesson.totalMessages} en esta lección.
Tipo de mensaje: ${lesson.messageType}

INSTRUCCIONES:
- Envía el contenido del mensaje adaptándolo al contexto del socio.
- Mantén los conceptos clave exactos del currículo. Puedes cambiar los ejemplos para que sean más relevantes al negocio del socio (${socio.businessDescription || 'no especificado'}), pero NO cambies los conceptos.
- Después de que el socio responda a este mensaje, avanza al siguiente mensaje de la lección.${lastMessageNote}`;
}

// ─── FREEFORM_QUESTION ──────────────────────────────────────────────

function buildFreeformPrompt(progress?: SocioProgress): string {
  const completed = progress?.completedLessons ?? [];
  const currentNum = progress?.currentLessonNumber ?? 1;
  const currentTitle = getLessonTitle(currentNum);

  const completedList = completed.length > 0
    ? completed.map((n) => `${n}: ${getLessonTitle(n)}`).join('\n')
    : 'Ninguna';

  return `TAREA ACTUAL: Responder pregunta del socio

El socio hizo una pregunta por su cuenta, fuera de una lección o check-in.

INSTRUCCIONES:
- Responde usando SOLO información del currículo de Mentors International.
- Usa la referencia curricular proporcionada abajo para fundamentar tu respuesta.
- Si la pregunta se relaciona con una lección que el socio YA completó, refiérela: "¿Recuerdas cuando hablamos sobre [tema] en la Lección [X]? Esto se conecta con eso..."
- Si la pregunta se relaciona con una lección FUTURA, da una respuesta breve y menciona que profundizarán después: "¡Buena pregunta! Vamos a ver eso más a fondo pronto, pero por ahora te cuento lo básico..."
- Si la pregunta NO está cubierta por ninguna lección del currículo, sé honesto: "Eso es algo que no cubre nuestro programa, pero tu mentor humano podría orientarte."
- NO inventes información. Si no está en el currículo, no lo digas.
- Mantén la respuesta en máximo 2-3 mensajes cortos.

LECCIONES YA COMPLETADAS POR EL SOCIO:
${completedList}

LECCIÓN ACTUAL:
${currentNum}: ${currentTitle}`;
}

// ─── CHECKIN ────────────────────────────────────────────────────────

function buildCheckinPrompt(socio: Socio, checkin: CheckinState): string {
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

  return `TAREA ACTUAL: Check-in semanal
Paso actual: ${checkin.step} de 5

ESTRUCTURA DEL CHECK-IN (sigue este orden estrictamente):
1. SALUDO — "¡Hola ${socio.name || 'Amigo'}, es nuestra reunión semanal! 👋 ¿Cómo va todo?"
2. COMPRENSIÓN — "Del 1 al 10, ¿qué tan bien entendiste la lección de esta semana?"
3. IMPLEMENTACIÓN — "Del 1 al 10, ¿qué tanto pudiste poner en práctica lo que aprendimos?"
4. INGRESOS — "¿Cuánto vendiste esta semana? No importa la cantidad, lo importante es que lo estés midiendo."
5. OBSTÁCULO — "¿Cuál fue tu mayor reto o dificultad esta semana con tu negocio?"

INSTRUCCIONES:
- Estás en el paso ${checkin.step}. Haz SOLO la pregunta de este paso.
- NO adelantes pasos. Espera la respuesta del socio antes de avanzar.
- Después de cada respuesta, responde brevemente (1-2 oraciones de reconocimiento) y luego haz la siguiente pregunta.
- Después del paso 5, da un breve resumen motivador y despídete hasta la próxima semana.
- Si la comprensión es 1-3/10, NO continúes el check-in normal. En vez, responde con empatía y prepárate para re-enseñar.

RESPUESTAS RECIBIDAS HASTA AHORA:
${checkin.responsesSoFar || 'Ninguna'}${stepGuidance}`;
}

// ─── RETEACH ────────────────────────────────────────────────────────

function buildReteachPrompt(socio: Socio, reteach: ReteachState): string {
  return `TAREA ACTUAL: Re-enseñar lección

El socio calificó su comprensión de la Lección ${reteach.lessonNumber} ("${reteach.lessonTitleEs}") como ${reteach.understandingScore}/10.

INSTRUCCIONES:
1. Primero, pregunta con empatía qué parte fue confusa: "Entiendo, ${socio.name || 'amigo'}. ¿Qué parte te costó más entender? Así te la explico de otra forma."
2. Espera su respuesta.
3. Explica SOLO la parte que mencionaron, no repitas toda la lección. Usa:
   - Una analogía de la vida diaria (cocinar, ir al mercado, manejar la casa)
   - Un ejemplo concreto usando su negocio (${socio.businessDescription || 'su emprendimiento'})
   - Lenguaje aún más simple que la primera vez
4. Máximo 3 mensajes para la re-enseñanza.
5. Después pregunta: "¿Ahora quedó más claro? Del 1 al 10, ¿cómo te sientes con esta lección?"
6. Si la nueva puntuación es 4+, celebra y avanza: "¡Ahí vamos! 💪" → Agrega [LESSON_COMPLETE:${reteach.lessonNumber}]
7. Si sigue en 1-3 después de re-enseñar, responde con ánimo: "No te preocupes, vamos a seguir practicando. Tu mentor humano también puede ayudarte con esto." → Agrega [FLAG:RED|Comprensión baja persistente en Lección ${reteach.lessonNumber} después de re-enseñanza]`;
}

// ─── REMINDER ───────────────────────────────────────────────────────

function buildReminderPrompt(socio: Socio, reminder: ReminderState): string {
  return `TAREA ACTUAL: Enviar recordatorio

El socio no completó la Lección ${reminder.lessonNumber} ("${reminder.lessonTitleEs}"). Se quedó en el mensaje ${reminder.messageIndex} de ${reminder.totalMessages}.
Este es el recordatorio #${reminder.reminderNumber} de ${reminder.maxReminders}.

INSTRUCCIONES:
- Envía UN solo mensaje corto y amigable.
- Menciona el tema específico, no digas "tu lección": "Hola ${socio.name || 'amigo'}, estábamos hablando sobre ${reminder.lessonTitleEs}. ¿Quieres que sigamos? 😊"
- No presiones ni hagas sentir culpa.
- Si es el último recordatorio permitido, que suene natural, no como una advertencia.`;
}

// ─── MENTOR_HANDOFF ─────────────────────────────────────────────────

function buildMentorHandoffPrompt(socio: Socio, mentor: MentorSession): string {
  return `TAREA ACTUAL: Transferencia a mentor humano

Un mentor humano (${mentor.mentorName}) se ha unido a la conversación con ${socio.name || 'el socio'}.

INSTRUCCIONES:
- Envía exactamente UN mensaje: "¡Hola ${socio.name || 'amigo'}! ${mentor.mentorName} está aquí para ayudarte personalmente. 👋 Te dejo en buenas manos."
- Después de enviar este mensaje, NO respondas más hasta que el mentor se retire.
- No resumas la conversación al socio — el mentor tiene acceso al resumen en su dashboard.`;
}

// ─── POST_MENTOR ────────────────────────────────────────────────────

function buildPostMentorPrompt(socio: Socio, mentor: MentorSession): string {
  const notesLine = mentor.mentorNotes
    ? `- Si el mentor dejó notas: "${mentor.mentorNotes}" — refiérelas brevemente si son relevantes.`
    : '';

  return `TAREA ACTUAL: Reanudar después de intervención de mentor

El mentor humano ${mentor.mentorName} acaba de terminar su conversación con ${socio.name || 'el socio'}.

INSTRUCCIONES:
- Saluda brevemente: "¡Hola ${socio.name || 'amigo'}! Espero que la charla con ${mentor.mentorName} haya sido útil."
${notesLine}
- Retoma el flujo normal. Si hay una lección pendiente, ofrece continuarla. Si no, espera a que el socio inicie contacto.
- No repitas lo que el mentor ya cubrió.`;
}
