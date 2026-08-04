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
import { FLAG_RED_THRESHOLD, RETEACH_LEVEL_THRESHOLD, CONFUSION_ESCALATE_THRESHOLD } from '../constants';
import { loadActivePrompt, type PromptVersionSink } from '../loadPrompt';
import type { ConfigScope } from '../scope';
import type { DimensionStateMap } from '@/lib/ai/sensing/types';
import { getCourseMeta, resolveLocalized } from '@/lib/courses/course-meta';
import { DEFAULT_PERSONALIZATION_INSTRUCTION } from '@/lib/courses/defaults';
import type { SupportedLanguage } from '@/lib/i18n/languages';

/** Bump whenever the Layer 3 prompt text changes. Recorded on every AiInvocation. */
export const TASK_PROMPT_VERSION = 'v1';

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
  progress: SocioProgress | undefined,
  collectionKey: string,
  dimensionState?: DimensionStateMap,
  language: SupportedLanguage = 'es',
  /** Trace-only: receives `task` when a DB-backed prompt overrode the default. */
  sink?: PromptVersionSink,
  scope?: ConfigScope,
): Promise<string> {
  const dimensionContext = buildDimensionContext(dimensionState);
  const meta = await getCourseMeta(collectionKey);
  const participantNoun = resolveLocalized(meta.terminology.participant, language);

  let basePrompt: string;

  switch (result.mode) {
    case InteractionMode.LESSON_START:
      basePrompt = await buildLessonStartPrompt(socio, result.lesson!, meta, participantNoun, language, sink, scope);
      break;
    case InteractionMode.LESSON_DELIVERY:
      basePrompt = await buildLessonDeliveryPrompt(socio, result.lesson!, meta, participantNoun, language, sink, scope);
      break;
    case InteractionMode.FREEFORM_QUESTION:
      basePrompt = await buildFreeformPrompt(progress, collectionKey, meta, participantNoun, language, sink, scope);
      break;
    case InteractionMode.CHECKIN:
      basePrompt = await buildCheckinPrompt(socio, result.checkin!, meta, participantNoun, language, sink, scope);
      break;
    case InteractionMode.RETEACH:
      basePrompt = await buildReteachPrompt(socio, result.reteach!, meta, participantNoun, language, sink, scope);
      break;
    case InteractionMode.REMINDER:
      basePrompt = await buildReminderPrompt(socio, result.reminder!, participantNoun, language, sink, scope);
      break;
    case InteractionMode.MENTOR_HANDOFF:
      basePrompt = await buildMentorHandoffPrompt(socio, result.mentor!, participantNoun, language, sink, scope);
      break;
    case InteractionMode.POST_MENTOR:
      basePrompt = await buildPostMentorPrompt(socio, result.mentor!, participantNoun, language, sink, scope);
      break;
    case InteractionMode.GATED_ASSESSMENT:
      // GATED_ASSESSMENT is handled by assessment pipeline before buildPrompt is called
      // (see service.ts:144 early return). This case is unreachable at runtime.
      throw new Error(`Unexpected mode in task layer: ${result.mode}`);
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
  meta: Awaited<ReturnType<typeof getCourseMeta>>,
  participantNoun: string,
  language: SupportedLanguage,
  sink?: PromptVersionSink,
  scope?: ConfigScope,
): Promise<string> {
  const prev = lesson.previousLessonTitleEs
    ? `  - Lección anterior completada: "${lesson.previousLessonTitleEs}" (puntuación de comprensión: ${lesson.lastUnderstanding ?? 'N/A'}/10)`
    : '';

  // Only emit intake prompt when learnerContext is defined
  let intakeNote = '';
  if (meta.learnerContext && !socio.businessDescription?.trim()) {
    const intakeQuestion = resolveLocalized(meta.learnerContext.intakeQuestion, language);
    intakeNote = `\n- Si no conoces aún el contexto del ${participantNoun}, ${intakeQuestion}`;
  }

  const dynamicContext = `CONTEXTO DE ESTA SESIÓN:
- Estás comenzando la Lección ${lesson.lessonNumber}: "${lesson.lessonTitleEs}".
- Categoría: ${lesson.lessonCategory}
- Este es el mensaje 1 de ${lesson.totalMessages}.
${prev ? `- Transición desde la lección anterior:${prev}` : ''}${intakeNote}`;

  const defaultInstructions = `TAREA ACTUAL: Iniciar lección nueva

INSTRUCCIONES:
- IMPORTANTE: Comienza tu respuesta anunciando claramente el número y título de la lección. Ejemplo: "📚 Lección 3: Cómo manejar tus gastos". Luego da una breve introducción antes de entrar en el contenido.
- Empieza con una transición natural desde la lección anterior si aplica.
- Introduce el tema con un escenario cotidiano que el ${participantNoun} pueda reconocer.
- Haz que suene como una conversación, no como una clase formal.
- Termina con una pregunta abierta para que el ${participantNoun} se enganche.`;

  const instructions = await loadActivePrompt('lesson_start', defaultInstructions, scope, sink, 'task');
  return `${instructions}\n\n${dynamicContext.trim()}`;
}

// ─── LESSON_DELIVERY ────────────────────────────────────────────────

async function buildLessonDeliveryPrompt(
  socio: Socio,
  lesson: LessonDeliveryState,
  meta: Awaited<ReturnType<typeof getCourseMeta>>,
  participantNoun: string,
  language: SupportedLanguage,
  sink?: PromptVersionSink,
  scope?: ConfigScope,
): Promise<string> {
  // Localized scaffolding for lesson delivery
  const scf: Record<SupportedLanguage, {
    lastMessageHeader: string;
    lastMessageInstructions: (pn: string, ln: number, mi: number, tm: number) => string;
    contextOf: (cl: string, pn: string) => string;
    forExamples: string;
    notSpecified: string;
    lessonContextHeader: string;
    lessonLabel: string;
    messageLabel: string;
    ofLabel: string;
    inThisLesson: string;
    messageTypeLabel: string;
    taskHeader: string;
    instructions: (pn: string, pi: string) => string;
  }> = {
    es: {
      lastMessageHeader: 'INSTRUCCIONES ADICIONALES (ÚLTIMO MENSAJE DE LA LECCIÓN)',
      lastMessageInstructions: (pn, ln, mi, tm) => `- Esta es la última parte de la lección. Al terminar, pide al ${pn} que califique su comprensión del 1 al 10 y emite el marcador [LESSON_COMPLETE:${ln}].
- Si es el ÚLTIMO mensaje de la lección (${mi} == ${tm}), después de que el ${pn} responda, pregunta: "Del 1 al 10, ¿qué tan bien entendiste esta lección?"
- Si la lección enseña algo práctico, también pregunta: "Del 1 al 10, ¿qué tanto pudiste poner en práctica lo que aprendimos?"
- Cuando el ${pn} dé sus puntuaciones y hayas respondido, agrega [LESSON_COMPLETE:${ln}] al final.`,
      contextOf: (cl, pn) => `${cl} del ${pn}`,
      forExamples: '(para ejemplos)',
      notSpecified: 'no especificado',
      lessonContextHeader: 'CONTEXTO DE LA LECCIÓN',
      lessonLabel: 'Lección',
      messageLabel: 'Mensaje',
      ofLabel: 'de',
      inThisLesson: 'en esta lección',
      messageTypeLabel: 'Tipo de mensaje',
      taskHeader: 'TAREA ACTUAL: Entregar lección',
      instructions: (pn, pi) => `INSTRUCCIONES:
- Envía el contenido del mensaje adaptándolo al contexto del ${pn}.
- Mantén los conceptos clave exactos del currículo. ${pi}
- Después de que el ${pn} responda a este mensaje, avanza al siguiente mensaje de la lección.`,
    },
    en: {
      lastMessageHeader: 'ADDITIONAL INSTRUCTIONS (LAST LESSON MESSAGE)',
      lastMessageInstructions: (pn, ln, mi, tm) => `- This is the last part of the lesson. When finishing, ask the ${pn} to rate their comprehension from 1 to 10 and emit the marker [LESSON_COMPLETE:${ln}].
- If this is the LAST message of the lesson (${mi} == ${tm}), after the ${pn} responds, ask: "From 1 to 10, how well did you understand this lesson?"
- If the lesson teaches something practical, also ask: "From 1 to 10, how much were you able to put into practice what we learned?"
- When the ${pn} gives their scores and you've responded, add [LESSON_COMPLETE:${ln}] at the end.`,
      contextOf: (cl, pn) => `${pn}'s ${cl}`,
      forExamples: '(for examples)',
      notSpecified: 'not specified',
      lessonContextHeader: 'LESSON CONTEXT',
      lessonLabel: 'Lesson',
      messageLabel: 'Message',
      ofLabel: 'of',
      inThisLesson: 'in this lesson',
      messageTypeLabel: 'Message type',
      taskHeader: 'CURRENT TASK: Deliver lesson',
      instructions: (pn, pi) => `INSTRUCTIONS:
- Send the message content adapting it to the ${pn}'s context.
- Keep the exact key concepts from the curriculum. ${pi}
- After the ${pn} responds to this message, move on to the next lesson message.`,
    },
    pt: {
      lastMessageHeader: 'INSTRUÇÕES ADICIONAIS (ÚLTIMA MENSAGEM DA LIÇÃO)',
      lastMessageInstructions: (pn, ln, mi, tm) => `- Esta é a última parte da lição. Ao terminar, peça ao ${pn} que classifique sua compreensão de 1 a 10 e emita o marcador [LESSON_COMPLETE:${ln}].
- Se esta é a ÚLTIMA mensagem da lição (${mi} == ${tm}), depois que o ${pn} responder, pergunte: "De 1 a 10, o quanto você entendeu esta lição?"
- Se a lição ensina algo prático, também pergunte: "De 1 a 10, o quanto você conseguiu colocar em prática o que aprendemos?"
- Quando o ${pn} der suas pontuações e você tiver respondido, adicione [LESSON_COMPLETE:${ln}] no final.`,
      contextOf: (cl, pn) => `${cl} do ${pn}`,
      forExamples: '(para exemplos)',
      notSpecified: 'não especificado',
      lessonContextHeader: 'CONTEXTO DA LIÇÃO',
      lessonLabel: 'Lição',
      messageLabel: 'Mensagem',
      ofLabel: 'de',
      inThisLesson: 'nesta lição',
      messageTypeLabel: 'Tipo de mensagem',
      taskHeader: 'TAREFA ATUAL: Entregar lição',
      instructions: (pn, pi) => `INSTRUÇÕES:
- Envie o conteúdo da mensagem adaptando-o ao contexto do ${pn}.
- Mantenha os conceitos-chave exatos do currículo. ${pi}
- Após o ${pn} responder a esta mensagem, avance para a próxima mensagem da lição.`,
    },
  };
  const s = scf[language] ?? scf['en'];

  const isLastMessage = lesson.messageIndex === lesson.totalMessages;
  const lastMessageNote = isLastMessage
    ? `

${s.lastMessageHeader}:
${s.lastMessageInstructions(participantNoun, lesson.lessonNumber, lesson.messageIndex, lesson.totalMessages)}`
    : '';

  // Build context line - include context info only when learnerContext exists
  let contextLine = '';
  if (meta.learnerContext) {
    const contextLabel = resolveLocalized(meta.learnerContext.label, language);
    contextLine = `\n- ${s.contextOf(contextLabel, participantNoun)} ${s.forExamples}: ${socio.businessDescription || s.notSpecified}`;
  }

  const dynamicContext = `${s.lessonContextHeader}:
- ${s.lessonLabel} ${lesson.lessonNumber}: "${lesson.lessonTitleEs}"
- ${s.messageLabel} ${lesson.messageIndex} ${s.ofLabel} ${lesson.totalMessages} ${s.inThisLesson}
- ${s.messageTypeLabel}: ${lesson.messageType}${contextLine}`;

  // Get personalization instruction - use config or generic default
  const personalizationInstruction = meta.learnerContext
    ? resolveLocalized(meta.learnerContext.personalizationInstruction, language)
    : resolveLocalized(DEFAULT_PERSONALIZATION_INSTRUCTION, language);

  const defaultInstructions = `${s.taskHeader}

${s.instructions(participantNoun, personalizationInstruction)}`;

  const instructions = await loadActivePrompt('lesson_delivery', defaultInstructions, scope, sink, 'task');
  return `${instructions}${lastMessageNote}\n\n${dynamicContext.trim()}`;
}

// ─── FREEFORM_QUESTION ──────────────────────────────────────────────

async function buildFreeformPrompt(
  progress: SocioProgress | undefined,
  collectionKey: string,
  meta: Awaited<ReturnType<typeof getCourseMeta>>,
  participantNoun: string,
  _language: SupportedLanguage,
  sink?: PromptVersionSink,
  scope?: ConfigScope,
): Promise<string> {
  const completed = progress?.completedLessons ?? [];
  const currentNum = progress?.currentLessonNumber ?? 1;
  const currentTitle = getLessonTitle(collectionKey, currentNum);

  const completedList = completed.length > 0
    ? completed.map((n) => `${n}: ${getLessonTitle(collectionKey, n)}`).join('\n')
    : 'Ninguna';

  const dynamicContext = `LECCIONES YA COMPLETADAS POR EL ESTUDIANTE:
${completedList}

LECCIÓN ACTUAL:
${currentNum}: ${currentTitle}`;

  const defaultInstructions = `TAREA ACTUAL: Responder pregunta del estudiante

El estudiante hizo una pregunta por su cuenta, fuera de una lección o check-in.

INSTRUCCIONES:
- Responde usando SOLO información del currículo de ${meta.courseName}.
- Usa la referencia curricular proporcionada abajo para fundamentar tu respuesta.
- Si la pregunta se relaciona con una lección que el estudiante YA completó, refiérela: "¿Recuerdas cuando hablamos sobre [tema] en la Lección [X]? Esto se conecta con eso..."
- Si la pregunta se relaciona con una lección FUTURA, da una respuesta breve y menciona que profundizarán después: "¡Buena pregunta! Vamos a ver eso más a fondo pronto, pero por ahora te cuento lo básico..."
- Si la pregunta NO está cubierta por ninguna lección del currículo, sé honesto: "Eso es algo que no cubre nuestro programa."
- NO inventes información. Si no está en el currículo, no lo digas.
- Mantén la respuesta en máximo 2-3 mensajes cortos.`;

  const instructions = await loadActivePrompt('freeform', defaultInstructions, scope, sink, 'task');
  return `${instructions}\n\n${dynamicContext.trim()}`;
}

// ─── CHECKIN ────────────────────────────────────────────────────────

async function buildCheckinPrompt(
  socio: Socio,
  checkin: CheckinState,
  meta: Awaited<ReturnType<typeof getCourseMeta>>,
  participantNoun: string,
  language: SupportedLanguage,
  sink?: PromptVersionSink,
  scope?: ConfigScope,
): Promise<string> {
  const hasLearnerContext = meta.learnerContext !== undefined;
  const contextLabel = hasLearnerContext
    ? resolveLocalized(meta.learnerContext!.label, language).toLowerCase()
    : undefined;

  // Localized scaffolding strings
  const scaffolding: Record<SupportedLanguage, {
    nameLabel: string;
    stepLabel: string;
    responsesLabel: string;
    noneLabel: string;
    friendLabel: string;
  }> = {
    es: {
      nameLabel: `Nombre del ${participantNoun} (para saludos)`,
      stepLabel: 'Paso actual',
      responsesLabel: 'RESPUESTAS RECIBIDAS HASTA AHORA',
      noneLabel: 'Ninguna',
      friendLabel: 'Amigo',
    },
    en: {
      nameLabel: `${participantNoun.charAt(0).toUpperCase() + participantNoun.slice(1)} name (for greetings)`,
      stepLabel: 'Current step',
      responsesLabel: 'RESPONSES RECEIVED SO FAR',
      noneLabel: 'None',
      friendLabel: 'Friend',
    },
    pt: {
      nameLabel: `Nome do ${participantNoun} (para saudações)`,
      stepLabel: 'Passo atual',
      responsesLabel: 'RESPOSTAS RECEBIDAS ATÉ AGORA',
      noneLabel: 'Nenhuma',
      friendLabel: 'Amigo',
    },
  };
  const scf = scaffolding[language] ?? scaffolding['en'];

  let stepGuidance = '';

  if (checkin.understandingScore !== undefined) {
    const score = checkin.understandingScore;
    // Step guidance localized
    const guidance: Record<SupportedLanguage, { high: string; mid: string; low: string; veryLow: string }> = {
      es: {
        high: `\nGUÍA: Puntuación ${score}/10 — "¡Excelente! Se nota que le pusiste atención. 🚀" → Avanza al paso 3.`,
        mid: `\nGUÍA: Puntuación ${score}/10 — "¡Bien! Vas por buen camino." → Avanza al paso 3.`,
        low: `\nGUÍA: Puntuación ${score}/10 — "No te preocupes, cada quien tiene su ritmo. ¿Qué parte te quedó menos clara?" → Espera respuesta, ofrece aclaración breve, luego avanza al paso 3.`,
        veryLow: `\nGUÍA: Puntuación ${score}/10 — "Gracias por ser honesto/a. Eso me ayuda a explicarte mejor. ¿Qué parte fue la más confusa?" → NO continúes el check-in normal. Cambia a modo RETEACH.`,
      },
      en: {
        high: `\nGUIDE: Score ${score}/10 — "Excellent! You clearly paid attention. 🚀" → Move to step 3.`,
        mid: `\nGUIDE: Score ${score}/10 — "Good! You're on the right track." → Move to step 3.`,
        low: `\nGUIDE: Score ${score}/10 — "Don't worry, everyone has their own pace. Which part was less clear?" → Wait for response, offer brief clarification, then move to step 3.`,
        veryLow: `\nGUIDE: Score ${score}/10 — "Thanks for being honest. That helps me explain better. Which part was most confusing?" → DON'T continue the normal check-in. Switch to RETEACH mode.`,
      },
      pt: {
        high: `\nGUIA: Pontuação ${score}/10 — "Excelente! Nota-se que você prestou atenção. 🚀" → Avance para o passo 3.`,
        mid: `\nGUIA: Pontuação ${score}/10 — "Bem! Você está no caminho certo." → Avance para o passo 3.`,
        low: `\nGUIA: Pontuação ${score}/10 — "Não se preocupe, cada um tem seu ritmo. Qual parte ficou menos clara?" → Espere a resposta, ofereça breve esclarecimento, depois avance para o passo 3.`,
        veryLow: `\nGUIA: Pontuação ${score}/10 — "Obrigado por ser honesto/a. Isso me ajuda a explicar melhor. Qual parte foi mais confusa?" → NÃO continue o check-in normal. Mude para modo RETEACH.`,
      },
    };
    const g = guidance[language] ?? guidance['en'];
    if (score >= 8) {
      stepGuidance = g.high;
    } else if (score >= 6) {
      stepGuidance = g.mid;
    } else if (score >= 4) {
      stepGuidance = g.low;
    } else {
      stepGuidance = g.veryLow;
    }
  }

  // Revenue guidance only for courses with learnerContext (e.g., MI business course)
  if (checkin.revenueReported !== undefined && hasLearnerContext) {
    const revenueGuidance: Record<SupportedLanguage, string> = {
      es: `\n
GUÍA PARA RESPONDER AL REPORTE DE INGRESOS:
- Si reporta un número: Reconócelo positivamente sin juzgar. "Gracias por compartir eso. Llevar ese registro es clave."
- Si dice que no sabe o no midió: Anímalo sin regañar. "No pasa nada. Precisamente eso es lo que vamos aprendiendo juntos."
- Si reporta cero o pérdidas: Sé empático. "Entiendo. Las semanas difíciles son parte del camino. Lo importante es que sigues aquí aprendiendo."`,
      en: `\n
GUIDE FOR RESPONDING TO REVENUE REPORT:
- If they report a number: Acknowledge it positively without judging. "Thanks for sharing that. Keeping that record is key."
- If they say they don't know or didn't measure: Encourage without scolding. "No worries. That's exactly what we're learning together."
- If they report zero or losses: Be empathetic. "I understand. Tough weeks are part of the journey. What matters is you're still here learning."`,
      pt: `\n
GUIA PARA RESPONDER AO RELATÓRIO DE RECEITAS:
- Se reporta um número: Reconheça positivamente sem julgar. "Obrigado por compartilhar isso. Manter esse registro é fundamental."
- Se diz que não sabe ou não mediu: Encoraje sem repreender. "Sem problema. É exatamente isso que estamos aprendendo juntos."
- Se reporta zero ou perdas: Seja empático. "Entendo. Semanas difíceis fazem parte do caminho. O importante é que você continua aqui aprendendo."`,
    };
    stepGuidance += revenueGuidance[language] ?? revenueGuidance['en'];
  }

  const dynamicContextLabel: Record<SupportedLanguage, string> = {
    es: 'DATOS DEL CHECK-IN',
    en: 'CHECK-IN DATA',
    pt: 'DADOS DO CHECK-IN',
  };

  const dynamicContext = `${dynamicContextLabel[language] ?? dynamicContextLabel['en']}:
- ${scf.nameLabel}: ${socio.name || scf.friendLabel}
- ${scf.stepLabel}: ${checkin.step} de 5

${scf.responsesLabel}:
${checkin.responsesSoFar || scf.noneLabel}${stepGuidance}`;

  // Obstacle question: use contextLabel when present, otherwise generic "this week"
  const obstacleQuestion = contextLabel
    ? (language === 'es'
      ? `"¿Cuál fue tu mayor reto o dificultad esta semana con tu ${contextLabel}?"`
      : language === 'pt'
      ? `"Qual foi seu maior desafio ou dificuldade esta semana com seu ${contextLabel}?"`
      : `"What was your biggest challenge or difficulty this week with your ${contextLabel}?"`)
    : (language === 'es'
      ? `"¿Cuál fue tu mayor reto o dificultad esta semana?"`
      : language === 'pt'
      ? `"Qual foi seu maior desafio ou dificuldade esta semana?"`
      : `"What was your biggest challenge or difficulty this week?"`);

  // Build instructions based on whether this is a business/context course or generic
  const instructionTemplates: Record<SupportedLanguage, string> = {
    es: hasLearnerContext
      ? `TAREA ACTUAL: Check-in semanal

ESTRUCTURA DEL CHECK-IN (sigue este orden estrictamente):
1. SALUDO — "¡Hola [nombre], es nuestra reunión semanal! 👋 ¿Cómo va todo?" (usa el nombre del ${participantNoun} indicado abajo)
2. COMPRENSIÓN — "Del 1 al 10, ¿qué tan bien entendiste la lección de esta semana?"
3. IMPLEMENTACIÓN — "Del 1 al 10, ¿qué tanto pudiste poner en práctica lo que aprendimos?"
4. INGRESOS — "¿Cuánto vendiste esta semana? No importa la cantidad, lo importante es que lo estés midiendo."
5. OBSTÁCULO — ${obstacleQuestion}

INSTRUCCIONES:
- Estás en el paso indicado abajo. Haz SOLO la pregunta de este paso.
- NO adelantes pasos. Espera la respuesta del ${participantNoun} antes de avanzar.
- Después de cada respuesta, responde brevemente (1-2 oraciones de reconocimiento) y luego haz la siguiente pregunta.
- Después del paso 5, da un breve resumen motivador y despídete hasta la próxima semana.
- Si la comprensión es 1-${FLAG_RED_THRESHOLD}/10, NO continúes el check-in normal. En vez, responde con empatía y prepárate para re-enseñar.`
      : `TAREA ACTUAL: Check-in semanal

ESTRUCTURA DEL CHECK-IN (sigue este orden estrictamente):
1. SALUDO — "¡Hola [nombre], es nuestra reunión semanal! 👋 ¿Cómo va todo?" (usa el nombre del ${participantNoun} indicado abajo)
2. COMPRENSIÓN — "Del 1 al 10, ¿qué tan bien entendiste la lección de esta semana?"
3. IMPLEMENTACIÓN — "Del 1 al 10, ¿qué tanto pudiste poner en práctica lo que aprendimos?"
4. OBSTÁCULO — ${obstacleQuestion}

INSTRUCCIONES:
- Estás en el paso indicado abajo. Haz SOLO la pregunta de este paso.
- NO adelantes pasos. Espera la respuesta del ${participantNoun} antes de avanzar.
- Después de cada respuesta, responde brevemente (1-2 oraciones de reconocimiento) y luego haz la siguiente pregunta.
- Después del paso 4, da un breve resumen motivador y despídete hasta la próxima semana.
- Si la comprensión es 1-${FLAG_RED_THRESHOLD}/10, NO continúes el check-in normal. En vez, responde con empatía y prepárate para re-enseñar.`,

    en: hasLearnerContext
      ? `CURRENT TASK: Weekly check-in

CHECK-IN STRUCTURE (follow this order strictly):
1. GREETING — "Hi [name], it's time for our weekly check-in! 👋 How's everything going?" (use the ${participantNoun}'s name indicated below)
2. COMPREHENSION — "On a scale of 1 to 10, how well did you understand this week's lesson?"
3. IMPLEMENTATION — "On a scale of 1 to 10, how much were you able to put what we learned into practice?"
4. REVENUE — "How much did you sell this week? The amount doesn't matter, what's important is that you're measuring it."
5. OBSTACLE — ${obstacleQuestion}

INSTRUCTIONS:
- You're on the step indicated below. Ask ONLY the question for this step.
- DON'T skip ahead. Wait for the ${participantNoun}'s response before moving on.
- After each response, respond briefly (1-2 sentences of acknowledgment) and then ask the next question.
- After step 5, give a brief motivating summary and say goodbye until next week.
- If comprehension is 1-${FLAG_RED_THRESHOLD}/10, DON'T continue the normal check-in. Instead, respond with empathy and prepare to reteach.`
      : `CURRENT TASK: Weekly check-in

CHECK-IN STRUCTURE (follow this order strictly):
1. GREETING — "Hi [name], it's time for our weekly check-in! 👋 How's everything going?" (use the ${participantNoun}'s name indicated below)
2. COMPREHENSION — "On a scale of 1 to 10, how well did you understand this week's lesson?"
3. IMPLEMENTATION — "On a scale of 1 to 10, how much were you able to put what we learned into practice?"
4. OBSTACLE — ${obstacleQuestion}

INSTRUCTIONS:
- You're on the step indicated below. Ask ONLY the question for this step.
- DON'T skip ahead. Wait for the ${participantNoun}'s response before moving on.
- After each response, respond briefly (1-2 sentences of acknowledgment) and then ask the next question.
- After step 4, give a brief motivating summary and say goodbye until next week.
- If comprehension is 1-${FLAG_RED_THRESHOLD}/10, DON'T continue the normal check-in. Instead, respond with empathy and prepare to reteach.`,

    pt: hasLearnerContext
      ? `TAREFA ATUAL: Check-in semanal

ESTRUTURA DO CHECK-IN (siga esta ordem estritamente):
1. SAUDAÇÃO — "Olá [nome], é hora do nosso check-in semanal! 👋 Como vai tudo?" (use o nome do ${participantNoun} indicado abaixo)
2. COMPREENSÃO — "De 1 a 10, o quanto você entendeu a lição desta semana?"
3. IMPLEMENTAÇÃO — "De 1 a 10, o quanto você conseguiu colocar em prática o que aprendemos?"
4. RECEITAS — "Quanto você vendeu esta semana? O valor não importa, o importante é que você está medindo."
5. OBSTÁCULO — ${obstacleQuestion}

INSTRUÇÕES:
- Você está no passo indicado abaixo. Faça APENAS a pergunta deste passo.
- NÃO pule passos. Espere a resposta do ${participantNoun} antes de avançar.
- Após cada resposta, responda brevemente (1-2 frases de reconhecimento) e depois faça a próxima pergunta.
- Após o passo 5, dê um breve resumo motivador e despeça-se até a próxima semana.
- Se a compreensão for 1-${FLAG_RED_THRESHOLD}/10, NÃO continue o check-in normal. Em vez disso, responda com empatia e prepare-se para reensinar.`
      : `TAREFA ATUAL: Check-in semanal

ESTRUTURA DO CHECK-IN (siga esta ordem estritamente):
1. SAUDAÇÃO — "Olá [nome], é hora do nosso check-in semanal! 👋 Como vai tudo?" (use o nome do ${participantNoun} indicado abaixo)
2. COMPREENSÃO — "De 1 a 10, o quanto você entendeu a lição desta semana?"
3. IMPLEMENTAÇÃO — "De 1 a 10, o quanto você conseguiu colocar em prática o que aprendemos?"
4. OBSTÁCULO — ${obstacleQuestion}

INSTRUÇÕES:
- Você está no passo indicado abaixo. Faça APENAS a pergunta deste passo.
- NÃO pule passos. Espere a resposta do ${participantNoun} antes de avançar.
- Após cada resposta, responda brevemente (1-2 frases de reconhecimento) e depois faça a próxima pergunta.
- Após o passo 4, dê um breve resumo motivador e despeça-se até a próxima semana.
- Se a compreensão for 1-${FLAG_RED_THRESHOLD}/10, NÃO continue o check-in normal. Em vez disso, responda com empatia e prepare-se para reensinar.`,
  };

  const defaultInstructions = instructionTemplates[language] ?? instructionTemplates['en'];

  const instructions = await loadActivePrompt('checkin', defaultInstructions, scope, sink, 'task');
  return `${instructions}\n\n${dynamicContext.trim()}`;
}

// ─── RETEACH ────────────────────────────────────────────────────────

async function buildReteachPrompt(
  socio: Socio,
  reteach: ReteachState,
  meta: Awaited<ReturnType<typeof getCourseMeta>>,
  participantNoun: string,
  language: SupportedLanguage,
  sink?: PromptVersionSink,
  scope?: ConfigScope,
): Promise<string> {
  // Context reference - use learnerContext label or generic
  const contextRefStrings: Record<SupportedLanguage, string> = {
    es: 'su contexto',
    en: 'their context',
    pt: 'seu contexto',
  };
  let contextReference = contextRefStrings[language] ?? contextRefStrings['en'];
  if (meta.learnerContext) {
    const contextLabel = resolveLocalized(meta.learnerContext.label, language);
    contextReference = language === 'en'
      ? `their ${contextLabel.toLowerCase()}`
      : `su ${contextLabel.toLowerCase()}`;
  }

  // Localized scaffolding
  const scf: Record<SupportedLanguage, {
    contextHeader: string;
    lessonLabel: string;
    comprehensionLabel: string;
    nameLabel: string;
    contextRefLabel: string;
    markersLabel: string;
    completeLabel: string;
    persistentLowLabel: string;
    friendLabel: string;
  }> = {
    es: {
      contextHeader: 'CONTEXTO',
      lessonLabel: 'Lección',
      comprehensionLabel: 'Puntuación de comprensión reportada',
      nameLabel: `Nombre del ${participantNoun}`,
      contextRefLabel: 'Referencia de contexto',
      markersLabel: 'MARCADORES (usa este número de lección)',
      completeLabel: 'Completar bien',
      persistentLowLabel: `Comprensión baja persistente en Lección ${reteach.lessonNumber} después de re-enseñanza`,
      friendLabel: 'amigo',
    },
    en: {
      contextHeader: 'CONTEXT',
      lessonLabel: 'Lesson',
      comprehensionLabel: 'Reported comprehension score',
      nameLabel: `${participantNoun.charAt(0).toUpperCase() + participantNoun.slice(1)} name`,
      contextRefLabel: 'Context reference',
      markersLabel: 'MARKERS (use this lesson number)',
      completeLabel: 'Complete successfully',
      persistentLowLabel: `Persistent low comprehension in Lesson ${reteach.lessonNumber} after reteaching`,
      friendLabel: 'friend',
    },
    pt: {
      contextHeader: 'CONTEXTO',
      lessonLabel: 'Lição',
      comprehensionLabel: 'Pontuação de compreensão reportada',
      nameLabel: `Nome do ${participantNoun}`,
      contextRefLabel: 'Referência de contexto',
      markersLabel: 'MARCADORES (use este número de lição)',
      completeLabel: 'Completar com sucesso',
      persistentLowLabel: `Compreensão baixa persistente na Lição ${reteach.lessonNumber} após reensino`,
      friendLabel: 'amigo',
    },
  };
  const s = scf[language] ?? scf['en'];

  const dynamicContext = `${s.contextHeader}:
- ${s.lessonLabel} ${reteach.lessonNumber} ("${reteach.lessonTitleEs}")
- ${s.comprehensionLabel}: ${reteach.understandingScore}/10
- ${s.nameLabel}: ${socio.name || s.friendLabel}
- ${s.contextRefLabel}: ${socio.businessDescription || contextReference}

${s.markersLabel}:
- ${s.completeLabel}: [LESSON_COMPLETE:${reteach.lessonNumber}]
- ${s.persistentLowLabel}: [FLAG:RED|${s.persistentLowLabel}]`;

  const instructionTemplates: Record<SupportedLanguage, string> = {
    es: `TAREA ACTUAL: Re-enseñar lección

INSTRUCCIONES:
1. Primero, pregunta con empatía qué parte fue confusa: "Entiendo, [nombre]. ¿Qué parte te costó más entender? Así te la explico de otra forma."
2. Espera su respuesta.
3. Explica SOLO la parte que mencionaron, no repitas toda la lección. Usa:
   - Una analogía de la vida diaria (cocinar, ir al mercado, manejar la casa)
   - Un ejemplo concreto usando el contexto del ${participantNoun} (ver datos abajo)
   - Lenguaje aún más simple que la primera vez
4. Máximo 3 mensajes para la re-enseñanza.
5. Después pregunta: "¿Ahora quedó más claro? Del 1 al 10, ¿cómo te sientes con esta lección?"
6. Si la nueva puntuación es 4+, celebra y avanza: "¡Ahí vamos! 💪" → Agrega [LESSON_COMPLETE] con el número de lección indicado abajo.
7. Si sigue en 1-${FLAG_RED_THRESHOLD} después de re-enseñar, responde con ánimo: "No te preocupes, vamos a seguir practicando. Tu mentor humano también puede ayudarte con esto." → Agrega [FLAG:RED] según indicación abajo.`,
    en: `CURRENT TASK: Reteach lesson

INSTRUCTIONS:
1. First, ask empathetically which part was confusing: "I understand, [name]. Which part was hardest to understand? I'll explain it differently."
2. Wait for their response.
3. Explain ONLY the part they mentioned, don't repeat the whole lesson. Use:
   - An everyday analogy (cooking, going to the market, managing the house)
   - A concrete example using the ${participantNoun}'s context (see data below)
   - Even simpler language than the first time
4. Maximum 3 messages for reteaching.
5. Then ask: "Is it clearer now? On a scale of 1 to 10, how do you feel about this lesson?"
6. If the new score is 4+, celebrate and move on: "There we go! 💪" → Add [LESSON_COMPLETE] with the lesson number indicated below.
7. If still at 1-${FLAG_RED_THRESHOLD} after reteaching, respond encouragingly: "Don't worry, we'll keep practicing. Your human mentor can also help you with this." → Add [FLAG:RED] as indicated below.`,
    pt: `TAREFA ATUAL: Reensinar lição

INSTRUÇÕES:
1. Primeiro, pergunte com empatia qual parte foi confusa: "Entendo, [nome]. Qual parte foi mais difícil de entender? Vou explicar de outra forma."
2. Espere a resposta.
3. Explique APENAS a parte que mencionaram, não repita toda a lição. Use:
   - Uma analogia do dia a dia (cozinhar, ir ao mercado, gerenciar a casa)
   - Um exemplo concreto usando o contexto do ${participantNoun} (veja dados abaixo)
   - Linguagem ainda mais simples que da primeira vez
4. Máximo 3 mensagens para o reensino.
5. Depois pergunte: "Ficou mais claro agora? De 1 a 10, como você se sente com esta lição?"
6. Se a nova pontuação for 4+, celebre e avance: "Aí sim! 💪" → Adicione [LESSON_COMPLETE] com o número da lição indicado abaixo.
7. Se ainda estiver em 1-${FLAG_RED_THRESHOLD} após reensinar, responda com ânimo: "Não se preocupe, vamos continuar praticando. Seu mentor humano também pode ajudá-lo com isso." → Adicione [FLAG:RED] conforme indicação abaixo.`,
  };

  const defaultInstructions = instructionTemplates[language] ?? instructionTemplates['en'];
  const instructions = await loadActivePrompt('reteach', defaultInstructions, scope, sink, 'task');
  return `${instructions}\n\n${dynamicContext.trim()}`;
}

// ─── REMINDER ───────────────────────────────────────────────────────

async function buildReminderPrompt(
  socio: Socio,
  reminder: ReminderState,
  participantNoun: string,
  language: SupportedLanguage = 'es',
  sink?: PromptVersionSink,
  scope?: ConfigScope,
): Promise<string> {
  // Localized scaffolding
  const scf: Record<SupportedLanguage, {
    contextHeader: string;
    lessonLabel: string;
    stoppedAtLabel: string;
    reminderLabel: string;
    nameLabel: string;
    toneExampleLabel: string;
    toneExample: (name: string, title: string) => string;
    friendLabel: string;
  }> = {
    es: {
      contextHeader: 'CONTEXTO',
      lessonLabel: 'Lección',
      stoppedAtLabel: 'Se quedó en el mensaje',
      reminderLabel: 'Recordatorio',
      nameLabel: `Nombre del ${participantNoun}`,
      toneExampleLabel: 'Ejemplo de tono',
      toneExample: (name, title) => `"Hola ${name}, estábamos hablando sobre ${title}. ¿Quieres que sigamos? 😊"`,
      friendLabel: 'amigo',
    },
    en: {
      contextHeader: 'CONTEXT',
      lessonLabel: 'Lesson',
      stoppedAtLabel: 'Stopped at message',
      reminderLabel: 'Reminder',
      nameLabel: `${participantNoun.charAt(0).toUpperCase() + participantNoun.slice(1)} name`,
      toneExampleLabel: 'Tone example',
      toneExample: (name, title) => `"Hi ${name}, we were talking about ${title}. Want to continue? 😊"`,
      friendLabel: 'friend',
    },
    pt: {
      contextHeader: 'CONTEXTO',
      lessonLabel: 'Lição',
      stoppedAtLabel: 'Parou na mensagem',
      reminderLabel: 'Lembrete',
      nameLabel: `Nome do ${participantNoun}`,
      toneExampleLabel: 'Exemplo de tom',
      toneExample: (name, title) => `"Olá ${name}, estávamos falando sobre ${title}. Quer continuar? 😊"`,
      friendLabel: 'amigo',
    },
  };
  const s = scf[language] ?? scf['en'];
  const name = socio.name || s.friendLabel;

  const dynamicContext = `${s.contextHeader}:
- ${s.lessonLabel} ${reminder.lessonNumber} ("${reminder.lessonTitleEs}")
- ${s.stoppedAtLabel} ${reminder.messageIndex} de ${reminder.totalMessages}
- ${s.reminderLabel} ${reminder.reminderNumber} de ${reminder.maxReminders}
- ${s.nameLabel}: ${name}
- ${s.toneExampleLabel}: ${s.toneExample(name, reminder.lessonTitleEs)}`;

  const instructionTemplates: Record<SupportedLanguage, string> = {
    es: `TAREA ACTUAL: Enviar recordatorio

INSTRUCCIONES:
- Envía UN solo mensaje corto y amigable.
- Menciona el tema específico según el contexto, no digas "tu lección": usa el título de la lección indicado abajo.
- No presiones ni hagas sentir culpa.
- Si es el último recordatorio permitido, que suene natural, no como una advertencia.`,
    en: `CURRENT TASK: Send reminder

INSTRUCTIONS:
- Send ONE short, friendly message.
- Mention the specific topic from context, don't say "your lesson": use the lesson title indicated below.
- Don't pressure or make them feel guilty.
- If this is the last allowed reminder, make it sound natural, not like a warning.`,
    pt: `TAREFA ATUAL: Enviar lembrete

INSTRUÇÕES:
- Envie UMA mensagem curta e amigável.
- Mencione o tema específico do contexto, não diga "sua lição": use o título da lição indicado abaixo.
- Não pressione nem faça sentir culpa.
- Se este for o último lembrete permitido, que soe natural, não como um aviso.`,
  };

  const defaultInstructions = instructionTemplates[language] ?? instructionTemplates['en'];
  const instructions = await loadActivePrompt('reminder', defaultInstructions, scope, sink, 'task');
  return `${instructions}\n\n${dynamicContext.trim()}`;
}

// ─── MENTOR_HANDOFF ─────────────────────────────────────────────────

async function buildMentorHandoffPrompt(
  socio: Socio,
  mentor: MentorSession,
  participantNoun: string,
  language: SupportedLanguage = 'es',
  sink?: PromptVersionSink,
  scope?: ConfigScope,
): Promise<string> {
  const scf: Record<SupportedLanguage, {
    contextHeader: string;
    humanMentorLabel: string;
    theParticipant: string;
  }> = {
    es: {
      contextHeader: 'CONTEXTO',
      humanMentorLabel: 'Mentor humano',
      theParticipant: `el ${participantNoun}`,
    },
    en: {
      contextHeader: 'CONTEXT',
      humanMentorLabel: 'Human mentor',
      theParticipant: `the ${participantNoun}`,
    },
    pt: {
      contextHeader: 'CONTEXTO',
      humanMentorLabel: 'Mentor humano',
      theParticipant: `o ${participantNoun}`,
    },
  };
  const s = scf[language] ?? scf['en'];

  const dynamicContext = `${s.contextHeader}:
- ${participantNoun.charAt(0).toUpperCase() + participantNoun.slice(1)}: ${socio.name || s.theParticipant}
- ${s.humanMentorLabel}: ${mentor.mentorName}`;

  const instructionTemplates: Record<SupportedLanguage, string> = {
    es: `TAREA ACTUAL: Transferencia a mentor humano

INSTRUCCIONES:
- Envía exactamente UN mensaje: "¡Hola [nombre]! [nombre mentor] está aquí para ayudarte personalmente. 👋 Te dejo en buenas manos." (usa los nombres indicados arriba)
- Después de enviar este mensaje, NO respondas más hasta que el mentor se retire.
- No resumas la conversación al ${participantNoun} — el mentor tiene acceso al resumen en su dashboard.`,
    en: `CURRENT TASK: Human mentor handoff

INSTRUCTIONS:
- Send exactly ONE message: "Hi [name]! [mentor name] is here to help you personally. 👋 I'm leaving you in good hands." (use the names indicated above)
- After sending this message, DON'T respond again until the mentor leaves.
- Don't summarize the conversation to the ${participantNoun} — the mentor has access to the summary in their dashboard.`,
    pt: `TAREFA ATUAL: Transferência para mentor humano

INSTRUÇÕES:
- Envie exatamente UMA mensagem: "Olá [nome]! [nome do mentor] está aqui para ajudá-lo pessoalmente. 👋 Deixo você em boas mãos." (use os nomes indicados acima)
- Após enviar esta mensagem, NÃO responda mais até que o mentor saia.
- Não resuma a conversa para o ${participantNoun} — o mentor tem acesso ao resumo em seu painel.`,
  };

  const defaultInstructions = instructionTemplates[language] ?? instructionTemplates['en'];
  const instructions = await loadActivePrompt('mentor_handoff', defaultInstructions, scope, sink, 'task');
  return `${instructions}\n\n${dynamicContext.trim()}`;
}

// ─── POST_MENTOR ────────────────────────────────────────────────────

async function buildPostMentorPrompt(
  socio: Socio,
  mentor: MentorSession,
  participantNoun: string,
  language: SupportedLanguage = 'es',
  sink?: PromptVersionSink,
  scope?: ConfigScope,
): Promise<string> {
  const scf: Record<SupportedLanguage, {
    contextHeader: string;
    humanMentorLabel: string;
    mentorNotesLabel: string;
    theParticipant: string;
  }> = {
    es: {
      contextHeader: 'CONTEXTO',
      humanMentorLabel: 'Mentor humano',
      mentorNotesLabel: 'Notas del mentor (refiérete brevemente si son relevantes)',
      theParticipant: `el ${participantNoun}`,
    },
    en: {
      contextHeader: 'CONTEXT',
      humanMentorLabel: 'Human mentor',
      mentorNotesLabel: 'Mentor notes (refer briefly if relevant)',
      theParticipant: `the ${participantNoun}`,
    },
    pt: {
      contextHeader: 'CONTEXTO',
      humanMentorLabel: 'Mentor humano',
      mentorNotesLabel: 'Notas do mentor (refira brevemente se relevante)',
      theParticipant: `o ${participantNoun}`,
    },
  };
  const s = scf[language] ?? scf['en'];

  const notesLine = mentor.mentorNotes
    ? `- ${s.mentorNotesLabel}: ${mentor.mentorNotes}`
    : '';

  const dynamicContext = `${s.contextHeader}:
- ${participantNoun.charAt(0).toUpperCase() + participantNoun.slice(1)}: ${socio.name || s.theParticipant}
- ${s.humanMentorLabel}: ${mentor.mentorName}
${notesLine}`;

  const instructionTemplates: Record<SupportedLanguage, string> = {
    es: `TAREA ACTUAL: Reanudar después de intervención de mentor

INSTRUCCIONES:
- Saluda brevemente: "¡Hola [nombre]! Espero que la charla con [nombre mentor] haya sido útil." (usa los nombres indicados arriba)
- Si hay notas del mentor en el contexto, refiérelas brevemente si son relevantes.
- Retoma el flujo normal. Si hay una lección pendiente, ofrece continuarla. Si no, espera a que el ${participantNoun} inicie contacto.
- No repitas lo que el mentor ya cubrió.`,
    en: `CURRENT TASK: Resume after mentor intervention

INSTRUCTIONS:
- Greet briefly: "Hi [name]! I hope the chat with [mentor name] was helpful." (use the names indicated above)
- If there are mentor notes in the context, refer to them briefly if relevant.
- Resume normal flow. If there's a pending lesson, offer to continue it. If not, wait for the ${participantNoun} to initiate contact.
- Don't repeat what the mentor already covered.`,
    pt: `TAREFA ATUAL: Retomar após intervenção do mentor

INSTRUÇÕES:
- Cumprimente brevemente: "Olá [nome]! Espero que a conversa com [nome do mentor] tenha sido útil." (use os nomes indicados acima)
- Se houver notas do mentor no contexto, refira-as brevemente se forem relevantes.
- Retome o fluxo normal. Se houver uma lição pendente, ofereça para continuar. Se não, espere o ${participantNoun} iniciar contato.
- Não repita o que o mentor já cobriu.`,
  };

  const defaultInstructions = instructionTemplates[language] ?? instructionTemplates['en'];
  const instructions = await loadActivePrompt('post_mentor', defaultInstructions, scope, sink, 'task');
  return `${instructions}\n\n${dynamicContext.trim()}`;
}
