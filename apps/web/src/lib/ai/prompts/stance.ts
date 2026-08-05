/**
 * Teaching stance — the router's second axis
 * ═══════════════════════════════════════════════════════════════════════════
 * `InteractionMode` answers "what kind of turn is this" (LESSON_START, RETEACH,
 * FREEFORM_QUESTION…). Stance answers a separate, orthogonal question: what is
 * the AI's job right now.
 *
 *   tutor — build the knowledge the learner needs to attempt the task
 *   coach — support execution: obstacles, progress, morale, next action
 *
 * The two axes are independent. "What does gross margin mean" and "I raised
 * prices and customers complained" are both FREEFORM_QUESTION, and before this
 * module they produced an identical prompt — one that instructs the model to
 * answer from curriculum or decline, which is the wrong shape for the second
 * message entirely.
 *
 * Selection is code's decision, not the model's, on the same principle as mode.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { repo } from '@/lib/repo';
import type { SocioFlag } from '@/lib/repo/types';
import { getLessonData, hasLessonData } from '@/lib/lessons/db-lesson-service';
import { loadActivePrompt, type PromptVersionSink } from './loadPrompt';
import type { ConfigScope } from './scope';
import type { SupportedLanguage } from '@/lib/i18n/languages';

export type Stance = 'tutor' | 'coach';

/**
 * Why a stance was chosen. Recorded on the AI trace so stance behaviour can be
 * compared across turns without re-deriving the decision from raw state.
 */
export type StanceReason =
  | 'distress'          // rule (a): an active RED flag outranks everything
  | 'tutor_detour'      // a bounded return to tutor from resting coach
  | 'gate_not_passed'   // rule (b): no demonstrated knowledge yet
  | 'gate_passed';      // rule (c): resting state once the gate is cleared

export interface StanceDecision {
  stance: Stance;
  reason: StanceReason;
}

/**
 * How many turns a tutor detour lasts once opened, including the turn that
 * opened it. See `resolveStance` for why this is a floor and not a ceiling.
 */
export const TUTOR_DETOUR_TURNS = 3;

/** Key under `socio.promptOverrides` holding detour bookkeeping. */
export const STANCE_DETOUR_KEY = 'stanceDetour';

export interface StanceDetour {
  /** Turns still owed to tutor, including the current one. */
  turnsRemaining: number;
  /** Lesson the detour was opened against. Moving on ends it early. */
  lessonNumber: number;
}

export function readStanceDetour(
  promptOverrides: Record<string, unknown> | null | undefined,
): StanceDetour | null {
  const raw = promptOverrides?.[STANCE_DETOUR_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const o = raw as Record<string, unknown>;
  const turnsRemaining = typeof o.turnsRemaining === 'number' ? o.turnsRemaining : NaN;
  const lessonNumber = typeof o.lessonNumber === 'number' ? o.lessonNumber : NaN;
  if (!Number.isFinite(turnsRemaining) || !Number.isFinite(lessonNumber)) return null;
  if (turnsRemaining <= 0) return null;

  return { turnsRemaining, lessonNumber };
}

/**
 * Persists (or clears) the detour on `socio.promptOverrides`.
 *
 * promptOverrides is already the established home for internal per-socio state
 * that does not warrant a column — `awaitingFeedback` and `onboardingStep` live
 * here too, and `stripInternalPromptOverrides` in builder.ts keeps all of them
 * out of the slider parsing. Chosen over a migration because ST2 explicitly
 * excludes schema changes, and because the state is genuinely transient.
 */
async function persistDetour(
  socioId: string,
  promptOverrides: Record<string, unknown> | null | undefined,
  detour: StanceDetour | null,
): Promise<void> {
  const next = { ...(promptOverrides ?? {}) };
  if (detour) {
    next[STANCE_DETOUR_KEY] = detour;
  } else {
    delete next[STANCE_DETOUR_KEY];
  }

  try {
    await repo.updateSocio(socioId, {
      promptOverrides: Object.keys(next).length > 0 ? next : null,
    });
  } catch (error) {
    // A failed write costs one turn of hysteresis, not the reply. Falling back
    // to recomputation is exactly the flapping this module exists to prevent,
    // but a dropped turn is strictly better than a dropped response.
    console.error(`[Stance] Failed to persist detour for socio ${socioId}:`, error);
  }
}

/**
 * Has the learner passed the gate(s) on their current lesson?
 *
 * `passedAt !== null` is the pass fact — deliberately not `status`, because a
 * session can be `completed` with `passedAt` null, which is a fail. The same
 * distinction is documented in `src/lib/signals/positive.ts`, and the router's
 * own `checkGatePosition` gets it wrong for its own (different) purpose: it
 * treats any completed session as clearing the gate, because for *progression*
 * a failed-but-finished attempt should not block forever.
 *
 * A lesson with no gates returns false. That is deliberate rather than an
 * oversight: with no gate there is no evidence the learner knows the material,
 * and tutor is the honest default. A course that wants its learners coached
 * declares a teach-back gate. Note this means curricula imported without gates
 * (the legacy MI collection among them) stay tutor unless distress flips them.
 */
export async function hasPassedCurrentLessonGates(
  socioId: string,
  collectionKey: string,
  lessonNumber: number,
): Promise<boolean> {
  if (!hasLessonData(collectionKey, lessonNumber)) return false;

  const lesson = getLessonData(collectionKey, lessonNumber);
  if (lesson.gates.length === 0) return false;

  for (const gate of lesson.gates) {
    const sessions = await repo.getAssessmentSessionsForSocioLesson?.(
      socioId,
      lesson.lessonKey,
      gate.blockId,
    );
    const passed = sessions?.some((s) => s.passedAt !== null) ?? false;
    if (!passed) return false;
  }

  return true;
}

/** An active RED flag is the distress signal. YELLOW is not a crisis. */
export function hasActiveDistress(flags: readonly SocioFlag[]): boolean {
  return flags.some((f) => f.level === 'RED');
}

export interface ResolveStanceParams {
  socioId: string;
  promptOverrides: Record<string, unknown> | null | undefined;
  collectionKey: string;
  currentLessonNumber: number;
  /** Already-fetched active flags. The router reads them once per turn. */
  activeFlags: readonly SocioFlag[];
  /**
   * Whether the router chose RETEACH this turn. This is the detour's entry
   * signal — see below for why it is not a fresh dimension threshold.
   */
  reteachThisTurn: boolean;
}

/**
 * Chooses the stance for this turn, in precedence order.
 *
 *   a. active RED distress flag → coach   (never tutor someone in crisis)
 *   b. gate not passed          → tutor
 *   c. gate passed              → coach
 *
 * ── Hysteresis ────────────────────────────────────────────────────────────
 * Coach is the resting state once the gate is passed. A tutor detour from
 * coach is an explicit, bounded return rather than a per-turn recomputation.
 *
 * Entry is signal-driven: the detour opens only when the router already chose
 * RETEACH this turn. That reuses a decision the router makes carefully (an
 * explicit low score OR a dimension threshold gated at confidence >= 0.4)
 * instead of introducing a second, differently-tuned threshold.
 *
 * Exit is turn-count-driven, and this is the whole point. Once open, a detour
 * runs its full `TUTOR_DETOUR_TURNS` budget even if the signal that opened it
 * vanishes on the next turn. It cannot exit early, so it cannot flap. Binding
 * stance directly to the reteach signal would inherit that signal's noise: an
 * EMA thresholded at confidence >= 0.4 crosses back and forth, and stance would
 * oscillate between postures mid-conversation.
 *
 * Two things end a detour before its budget: distress (rule (a) outranks it)
 * and moving to a different lesson (the detour was about *that* material).
 *
 * Writes only happen while a detour is open or being opened. Steady-state
 * coach and pre-gate tutor cost no writes at all.
 */
export async function resolveStance(params: ResolveStanceParams): Promise<StanceDecision> {
  const {
    socioId,
    promptOverrides,
    collectionKey,
    currentLessonNumber,
    activeFlags,
    reteachThisTurn,
  } = params;

  const detour = readStanceDetour(promptOverrides);

  // ── (a) Distress outranks everything, including an open detour ──────────
  if (hasActiveDistress(activeFlags)) {
    if (detour) await persistDetour(socioId, promptOverrides, null);
    return { stance: 'coach', reason: 'distress' };
  }

  // ── (b) No demonstrated knowledge yet → tutor is the base state ─────────
  const gatePassed = await hasPassedCurrentLessonGates(
    socioId,
    collectionKey,
    currentLessonNumber,
  );

  if (!gatePassed) {
    // Tutor is already the answer; a detour would be redundant bookkeeping.
    if (detour) await persistDetour(socioId, promptOverrides, null);
    return { stance: 'tutor', reason: 'gate_not_passed' };
  }

  // ── (c) Gate passed: coach rests here, tutor visits ─────────────────────
  if (detour && detour.lessonNumber === currentLessonNumber) {
    const turnsRemaining = detour.turnsRemaining - 1;
    await persistDetour(
      socioId,
      promptOverrides,
      turnsRemaining > 0 ? { turnsRemaining, lessonNumber: currentLessonNumber } : null,
    );
    return { stance: 'tutor', reason: 'tutor_detour' };
  }

  if (reteachThisTurn) {
    await persistDetour(socioId, promptOverrides, {
      turnsRemaining: TUTOR_DETOUR_TURNS - 1,
      lessonNumber: currentLessonNumber,
    });
    return { stance: 'tutor', reason: 'tutor_detour' };
  }

  // A stale detour from a previous lesson, if any, ends here.
  if (detour) await persistDetour(socioId, promptOverrides, null);
  return { stance: 'coach', reason: 'gate_passed' };
}

// ─── Stance framing for Layer 3 ─────────────────────────────────────────────

/**
 * Code defaults, localized.
 *
 * Localized rather than Spanish-only for the same reason the task defaults are:
 * this is the floor a course lands on when it has published no stance prompt of
 * its own, so a Spanish-only default would move one tenant's language from the
 * database into the code rather than removing it.
 */
const TUTOR_FRAMING: Record<SupportedLanguage, (pn: string) => string> = {
  es: (pn) => `POSTURA: TUTOR — construir conocimiento

Tu trabajo ahora es que el ${pn} ENTIENDA, no que ejecute.
- Explica, ejemplifica y verifica la comprensión antes de pedir acción.
- Si no entiende, cambia la explicación; no repitas la misma en voz más alta.
- Todavía no le pidas que reporte resultados ni avances de su tarea.`,
  en: (pn) => `STANCE: TUTOR — build knowledge

Your job right now is for the ${pn} to UNDERSTAND, not to execute.
- Explain, give examples, and check comprehension before asking for action.
- If they do not understand, change the explanation; do not repeat it louder.
- Do not yet ask them to report results or progress on their task.`,
  pt: (pn) => `POSTURA: TUTOR — construir conhecimento

Seu trabalho agora é que o ${pn} ENTENDA, não que execute.
- Explique, dê exemplos e verifique a compreensão antes de pedir ação.
- Se não entender, mude a explicação; não repita a mesma mais alto.
- Ainda não peça que relate resultados ou progresso de sua tarefa.`,
};

const COACH_FRAMING: Record<SupportedLanguage, (pn: string) => string> = {
  es: (pn) => `POSTURA: COACH — apoyar la ejecución

El ${pn} ya demostró que entiende el material. Tu trabajo ahora es que AVANCE,
no volver a enseñarle.
- Empieza por dónde va: qué intentó, qué pasó, qué lo está frenando.
- Ante un obstáculo, ayúdalo a resolverlo — no lo reemplaces con una lección.
- Reconoce el progreso real y nombra el siguiente paso concreto.
- Re-explica solo si él lo pide o si claramente se le olvidó algo puntual.`,
  en: (pn) => `STANCE: COACH — support execution

The ${pn} has already shown they understand the material. Your job now is to
help them MAKE PROGRESS, not to teach it again.
- Start from where they are: what they tried, what happened, what is blocking them.
- When they hit an obstacle, help them solve it — do not substitute a lesson for it.
- Acknowledge real progress and name the next concrete step.
- Re-explain only if they ask, or if they clearly forgot something specific.`,
  pt: (pn) => `POSTURA: COACH — apoiar a execução

O ${pn} já demonstrou que entende o material. Seu trabalho agora é que ele
AVANCE, não ensinar de novo.
- Comece de onde ele está: o que tentou, o que aconteceu, o que o está travando.
- Diante de um obstáculo, ajude-o a resolvê-lo — não substitua por uma lição.
- Reconheça o progresso real e nomeie o próximo passo concreto.
- Reexplique apenas se ele pedir, ou se claramente esqueceu algo pontual.`,
};

const TASK_BLOCK_LABELS: Record<SupportedLanguage, { header: string; exercise: string; commitment: string }> = {
  es: {
    header: 'LO QUE EL PARTICIPANTE ESTÁ TRATANDO DE HACER',
    exercise: 'Ejercicio de esta lección',
    commitment: 'Compromiso',
  },
  en: {
    header: 'WHAT THE PARTICIPANT IS TRYING TO DO',
    exercise: "This lesson's exercise",
    commitment: 'Commitment',
  },
  pt: {
    header: 'O QUE O PARTICIPANTE ESTÁ TENTANDO FAZER',
    exercise: 'Exercício desta lição',
    commitment: 'Compromisso',
  },
};

/**
 * The concrete task the learner is working on, injected for coach stance only.
 *
 * Coach stance is where the AI needs to know what the learner is trying to DO,
 * not only what they are learning. Today that means `lesson.exercise` and
 * `lesson.commitment`, which are real per-lesson fields carried through
 * `db-lesson-service`.
 *
 * ── Known constraint, not an oversight ──────────────────────────────────────
 * `outcome.project` — the completable project a whole course builds toward —
 * belongs in this block and is NOT here, because it does not survive import.
 * `import-journey-package.ts` validates `pkg.outcome` (project, milestones,
 * mentorResources), pushes a warning, and drops it: there are no Outcome or
 * Milestone tables. So coach stance knows this lesson's task and not the
 * overall goal. Closing that needs the outcome migration, which ST2 excludes.
 * If a coach-vs-tutor prompt diff ever reads thin, this absence is the first
 * thing to check.
 */
function buildTaskFactsBlock(
  collectionKey: string,
  lessonNumber: number,
  language: SupportedLanguage,
): string | null {
  if (!hasLessonData(collectionKey, lessonNumber)) return null;

  const lesson = getLessonData(collectionKey, lessonNumber);
  const exercise = lesson.exercise?.trim();
  const commitment = lesson.commitment?.trim();
  if (!exercise && !commitment) return null;

  const l = TASK_BLOCK_LABELS[language] ?? TASK_BLOCK_LABELS['en'];
  const lines = [`${l.header}:`];
  if (exercise) lines.push(`- ${l.exercise}: ${exercise}`);
  if (commitment) lines.push(`- ${l.commitment}: ${commitment}`);
  return lines.join('\n');
}

/**
 * Builds the stance section appended to Layer 3.
 *
 * The framing text follows the same tier walk as every other course-owned
 * prompt — course → org → platform → localized code default — via
 * `loadActivePrompt`, so a course lead can retune either posture without a
 * deploy. `stance_tutor` and `stance_coach` are registered in `categories.ts`
 * as course-scoped, which means an unscoped row is refused at write time.
 */
export async function buildStanceBlock(params: {
  stance: Stance;
  participantNoun: string;
  collectionKey: string;
  currentLessonNumber: number;
  language: SupportedLanguage;
  sink?: PromptVersionSink;
  scope?: ConfigScope;
}): Promise<string> {
  const { stance, participantNoun, collectionKey, currentLessonNumber, language, sink, scope } =
    params;

  const table = stance === 'coach' ? COACH_FRAMING : TUTOR_FRAMING;
  const defaultFraming = (table[language] ?? table['en'])(participantNoun);

  // Two literal call sites rather than one with a computed category. The
  // registry guard in `categories.test.ts` scans source for a quoted category
  // name and cannot see through a ternary — a computed category would register
  // as read-by-nothing and, worse, would still work at runtime, so the drift
  // that guard exists to catch would go back to being invisible.
  const framing =
    stance === 'coach'
      ? await loadActivePrompt('stance_coach', defaultFraming, scope, sink, 'stanceText')
      : await loadActivePrompt('stance_tutor', defaultFraming, scope, sink, 'stanceText');

  if (stance !== 'coach') return framing;

  const taskFacts = buildTaskFactsBlock(collectionKey, currentLessonNumber, language);
  return taskFacts ? `${framing}\n\n${taskFacts}` : framing;
}
