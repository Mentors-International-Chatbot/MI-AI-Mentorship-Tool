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
import { RETEACH_THRESHOLD } from './constants';
import { loadActivePrompt, type PromptVersionSink } from './loadPrompt';
import type { ConfigScope } from './scope';
import type { SupportedLanguage } from '@/lib/i18n/languages';
import { resolveCourseProject, resolveCourseMilestones } from './courseOutcome';
import { createGateSessionLoader, type GateSessionLoader } from './gateSessions';
import { canDeliverGatedAssessment } from '@/lib/ai/assessment/channelSupport';



export type Stance = 'tutor' | 'coach';

/**
 * Why a stance was chosen. Recorded on the AI trace so stance behaviour can be
 * compared across turns without re-deriving the decision from raw state.
 */
export type StanceReason =
  | 'distress'            // rule (a): an active RED flag outranks everything
  | 'tutor_detour'        // a bounded return to tutor from resting coach
  | 'gate_not_passed'     // gated lesson, bar not yet cleared
  | 'gate_passed'         // gated lesson, bar cleared
  // ── Ungated lessons only. See the evidence ladder in `resolveStance`. ──
  | 'milestone_reached'   // reported doing part of the course project
  | 'lesson_taught_out'   // the lesson has no teaching left to deliver
  | 'awaiting_evidence';  // ungated, mid-lesson, nothing reported yet

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
 * What the current lesson's gates say about this learner.
 *
 *   `no_gates`   the lesson declares no teach-back, so gates cannot answer
 *   `passed`     every gate has a session with `passedAt` set
 *   `not_passed` at least one gate is outstanding
 *
 * `passedAt !== null` is the pass fact — deliberately not `status`, because a
 * session can be `completed` with `passedAt` null, which is a fail. The same
 * distinction is documented in `src/lib/signals/positive.ts`, and the router's
 * own `checkGatePosition` gets it wrong for its own (different) purpose: it
 * treats any completed session as clearing the gate, because for *progression*
 * a failed-but-finished attempt should not block forever.
 *
 * `no_gates` is kept distinct from `not_passed` because they are different
 * facts. "This learner has not passed the bar" and "this course set no bar"
 * used to collapse into the same `false`, which is what made coach unreachable
 * for every curriculum imported without gates — the legacy MI collection among
 * them. See `resolveStance` for what happens in the `no_gates` case now.
 */
export type GateEvidence = 'no_gates' | 'passed' | 'not_passed';

export async function readGateEvidence(
  socioId: string,
  collectionKey: string,
  lessonNumber: number,
  loadGateSessions: GateSessionLoader = createGateSessionLoader(socioId),
  /**
   * The learner's channel. A gate that cannot be delivered here reads as
   * `no_gates`, matching what the router's progression check does with it.
   * Omitted by callers with no channel, which keeps the pre-existing behaviour.
   */
  channelType?: string,
): Promise<GateEvidence> {
  if (!hasLessonData(collectionKey, lessonNumber)) return 'no_gates';

  const lesson = getLessonData(collectionKey, lessonNumber);
  if (lesson.gates.length === 0) return 'no_gates';

  // The router skips these gates for progression; stance must agree. Reporting
  // `not_passed` for a gate the learner can never attempt would pin them to
  // tutor for the entire course — the exact defect the ungated ladder exists to
  // prevent, arriving through the side door.
  if (!canDeliverGatedAssessment(channelType)) return 'no_gates';

  // Every gate must be passed, but they are independent — asking about gate two
  // does not depend on gate one's answer, so they go out together.
  const results = await Promise.all(
    lesson.gates.map(async (gate) => {
      const sessions = await loadGateSessions(lesson.lessonKey, gate.blockId);
      return sessions.some((s) => s.passedAt !== null);
    }),
  );

  return results.every(Boolean) ? 'passed' : 'not_passed';
}

/**
 * Has the learner passed the gate(s) on their current lesson?
 *
 * A lesson with no gates returns false: nothing was passed, because there was
 * nothing to pass. Callers deciding a *stance* want `readGateEvidence` instead,
 * which does not collapse "no bar" into "did not clear the bar".
 */
export async function hasPassedCurrentLessonGates(
  socioId: string,
  collectionKey: string,
  lessonNumber: number,
  /**
   * The turn's shared gate-session loader. Supplied by the router so this and
   * `checkGatePosition` fetch the same rows once; standalone callers (tests,
   * anything outside the conversational path) get their own.
   */
  loadGateSessions: GateSessionLoader = createGateSessionLoader(socioId),
): Promise<boolean> {
  const evidence = await readGateEvidence(socioId, collectionKey, lessonNumber, loadGateSessions);
  return evidence === 'passed';
}

/**
 * Has the lesson run out of things to teach this learner?
 *
 * `currentMessageIndex >= messages.length` means every teaching message in the
 * lesson has been delivered and the model has not emitted `[LESSON_COMPLETE]`.
 * This is not an inferred state — it is the exact condition under which the
 * router itself stops returning LESSON_DELIVERY and falls through to
 * FREEFORM_QUESTION, which is to say the state where the learner has the whole
 * lesson and is working with it.
 */
export function isLessonTaughtOut(collectionKey: string, lessonNumber: number, currentMessageIndex: number): boolean {
  if (!hasLessonData(collectionKey, lessonNumber)) return false;
  const lesson = getLessonData(collectionKey, lessonNumber);
  if (lesson.messages.length === 0) return false;
  return currentMessageIndex >= lesson.messages.length;
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
  /**
   * The turn's shared gate-session loader, threaded from the router so the
   * pass check reuses the rows the progression check already fetched.
   */
  loadGateSessions?: GateSessionLoader;
  /**
   * Where the learner sits inside the current lesson's message list. Feeds the
   * taught-out rung of the ungated ladder.
   */
  currentMessageIndex: number;
  /**
   * The understanding score from the most recently completed lesson, or null if
   * none was ever captured. A score at or below `RETEACH_THRESHOLD` vetoes the
   * taught-out rung; null does not (see `resolveStance`).
   */
  weeklyUnderstanding: number | null;
  /**
   * Milestone keys this learner has reached on this course. Lazy and memoized
   * by the router, because on a gated lesson the decision never needs it and on
   * a course that declares no milestones there is nothing to read.
   */
  loadReachedMilestones?: () => Promise<ReadonlySet<string>>;
  /**
   * The learner's delivery channel. Gates this channel cannot deliver read as
   * absent rather than failed, so the ungated ladder applies.
   */
  channelType?: string;
}

/**
 * Chooses the stance for this turn, in precedence order.
 *
 *   a. active RED distress flag → coach   (never tutor someone in crisis)
 *   b. the current lesson declares gates → the gates decide, and nothing else
 *   c. the current lesson declares no gates → the evidence ladder below
 *
 * ── Why (b) and (c) are separate ──────────────────────────────────────────
 * Until 2026-08-09 both collapsed into "gate passed?", and a lesson with no
 * gates answered no. The reasoning was that with no gate there is no evidence
 * the learner knows the material, so tutor is the honest default — a course
 * that wants its learners coached should declare a teach-back.
 *
 * That is right about a *gated* course and wrong about an ungated one. It made
 * coach unreachable for every curriculum imported without gates, the legacy MI
 * collection among them, so those learners were tutored through the entire
 * course and the coach half of the system never ran for them. "This course set
 * no bar" is not the same fact as "this learner did not clear the bar", and
 * treating them the same disabled a feature rather than defaulting it safely.
 *
 * So gates keep their authority exactly where a course declared them: on a
 * gated lesson a failed teach-back still means tutor, and no amount of weaker
 * evidence overrides it. The ladder below runs only when there is no gate to
 * override.
 *
 * ── The ungated evidence ladder ───────────────────────────────────────────
 *   c1. a milestone reached on this course → coach
 *       The strongest signal in the system that someone has DONE part of the
 *       task rather than been taught it. Written from the learner's own report
 *       via `[MILESTONE:key]`, validated against the course's declared keys.
 *
 *   c2. the lesson has been taught out → coach
 *       Every teaching message delivered, no `[LESSON_COMPLETE]` yet. This is
 *       the precise state in which the router stops delivering lesson content
 *       and falls through to FREEFORM_QUESTION: the learner holds the whole
 *       lesson and is working with it. Tutor has nothing left to teach here,
 *       and re-explaining material already delivered is the failure mode coach
 *       stance exists to prevent.
 *
 *       A recorded understanding at or below RETEACH_THRESHOLD vetoes this
 *       rung — they finished the material and told us they did not get it.
 *       A *null* score does not veto: most lessons complete without a parsed
 *       score, so treating absence as failure would leave the ladder as
 *       unreachable as the gate rule it replaces. Absence is no objection, not
 *       an objection. If they truly did not follow it, RETEACH fires and opens
 *       a tutor detour, which is the mechanism already built for exactly this.
 *
 *   c3. otherwise → tutor
 *       Ungated and mid-lesson. There is still teaching to deliver.
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
 *
 * The detour applies to every route into coach, not only the gate route — a
 * learner coached because they reached a milestone can still need a bounded
 * return to tutor when they stumble.
 */
export async function resolveStance(params: ResolveStanceParams): Promise<StanceDecision> {
  const {
    socioId,
    promptOverrides,
    collectionKey,
    currentLessonNumber,
    activeFlags,
    reteachThisTurn,
    loadGateSessions,
    currentMessageIndex,
    weeklyUnderstanding,
    loadReachedMilestones,
    channelType,
  } = params;

  const detour = readStanceDetour(promptOverrides);

  // ── (a) Distress outranks everything, including an open detour ──────────
  if (hasActiveDistress(activeFlags)) {
    if (detour) await persistDetour(socioId, promptOverrides, null);
    return { stance: 'coach', reason: 'distress' };
  }

  // ── (b)/(c) Has this learner earned coach, and on what evidence? ────────
  const evidence = await readCoachEvidence({
    socioId,
    collectionKey,
    currentLessonNumber,
    currentMessageIndex,
    weeklyUnderstanding,
    loadGateSessions: loadGateSessions ?? createGateSessionLoader(socioId),
    loadReachedMilestones,
    channelType,
  });

  if (!evidence.coach) {
    // Tutor is already the answer; a detour would be redundant bookkeeping.
    if (detour) await persistDetour(socioId, promptOverrides, null);
    return { stance: 'tutor', reason: evidence.reason };
  }

  // ── Coach earned: coach rests here, tutor visits ────────────────────────
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
  return { stance: 'coach', reason: evidence.reason };
}

/**
 * Rules (b) and (c): does this learner get coach, and on what evidence?
 *
 * Split out so the ladder can be read as a ladder, and so the detour handling
 * in `resolveStance` stays about hysteresis rather than about evidence.
 */
async function readCoachEvidence(params: {
  socioId: string;
  collectionKey: string;
  currentLessonNumber: number;
  currentMessageIndex: number;
  weeklyUnderstanding: number | null;
  loadGateSessions: GateSessionLoader;
  loadReachedMilestones?: () => Promise<ReadonlySet<string>>;
  channelType?: string;
}): Promise<{ coach: boolean; reason: StanceReason }> {
  const {
    socioId, collectionKey, currentLessonNumber, currentMessageIndex,
    weeklyUnderstanding, loadGateSessions, loadReachedMilestones, channelType,
  } = params;

  // ── (b) A declared gate is the authority, full stop ─────────────────────
  const gate = await readGateEvidence(
    socioId, collectionKey, currentLessonNumber, loadGateSessions, channelType,
  );
  if (gate === 'passed') return { coach: true, reason: 'gate_passed' };
  if (gate === 'not_passed') return { coach: false, reason: 'gate_not_passed' };

  // ── (c1) Reported doing part of the project ─────────────────────────────
  if (loadReachedMilestones) {
    let reached: ReadonlySet<string> = new Set();
    try {
      reached = await loadReachedMilestones();
    } catch (error) {
      // Losing milestone progress for a turn costs this rung, not the reply.
      // The taught-out rung below still applies.
      console.error(`[Stance] Failed to read milestone progress for ${socioId}:`, error);
    }
    if (reached.size > 0) return { coach: true, reason: 'milestone_reached' };
  }

  // ── (c2) Nothing left to teach in this lesson ───────────────────────────
  if (isLessonTaughtOut(collectionKey, currentLessonNumber, currentMessageIndex)) {
    // A recorded score at or below the reteach bar vetoes; a null score does
    // not. See the ladder note on `resolveStance` for why absence is not a veto.
    const understandingObjects =
      weeklyUnderstanding !== null && weeklyUnderstanding <= RETEACH_THRESHOLD;
    if (!understandingObjects) return { coach: true, reason: 'lesson_taught_out' };
  }

  // ── (c3) Ungated and still mid-lesson ───────────────────────────────────
  return { coach: false, reason: 'awaiting_evidence' };
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

const TASK_BLOCK_LABELS: Record<
  SupportedLanguage,
  {
    header: string; exercise: string; commitment: string; project: string;
    deliverables: string; progress: string; done: string; pending: string; marker: string;
  }
> = {
  es: {
    header: 'LO QUE EL PARTICIPANTE ESTÁ TRATANDO DE HACER',
    exercise: 'Ejercicio de esta lección',
    commitment: 'Compromiso',
    project: 'Proyecto del curso',
    deliverables: 'Entregables',
    progress: 'Avance del proyecto',
    done: 'hecho',
    pending: 'pendiente',
    marker: 'Cuando el participante REPORTE haber completado un hito pendiente, agrega [MILESTONE:clave] al final de tu respuesta, usando la clave exacta de la lista. Solo cuando lo reporte él, nunca por tu cuenta.',
  },
  en: {
    header: 'WHAT THE PARTICIPANT IS TRYING TO DO',
    exercise: "This lesson's exercise",
    commitment: 'Commitment',
    project: 'Course project',
    deliverables: 'Deliverables',
    progress: 'Project progress',
    done: 'done',
    pending: 'pending',
    marker: 'When the participant REPORTS completing a pending milestone, add [MILESTONE:key] at the end of your reply, using the exact key from the list. Only when they report it, never on your own.',
  },
  pt: {
    header: 'O QUE O PARTICIPANTE ESTÁ TENTANDO FAZER',
    exercise: 'Exercício desta lição',
    commitment: 'Compromisso',
    project: 'Projeto do curso',
    deliverables: 'Entregáveis',
    progress: 'Progresso do projeto',
    done: 'feito',
    pending: 'pendente',
    marker: 'Quando o participante RELATAR ter concluído um marco pendente, adicione [MILESTONE:chave] ao final da sua resposta, usando a chave exata da lista. Somente quando ele relatar, nunca por conta própria.',
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
 * Two scopes, deliberately both:
 *
 *   `outcome.project`   the completable thing the whole course builds toward
 *   `lesson.exercise` / `lesson.commitment`   this lesson's slice of it
 *
 * The project was unreachable until 2026-08-08 — the importer validated it and
 * dropped it for want of a table — so coach stance knew the immediate task and
 * not the goal it served. It now rides in `ProgramVersion.config.outcome`.
 *
 * Still absent, and it is the next real gap: nothing records that a participant
 * *reached* a milestone. `outcome.milestones` is imported and read by nothing,
 * so the AI knows what the project is and cannot know how far along they are.
 * That needs per-participant state, which needs tables.
 */
async function buildTaskFactsBlock(
  collectionKey: string,
  lessonNumber: number,
  language: SupportedLanguage,
  scope?: ConfigScope,
  reachedMilestoneKeys?: ReadonlySet<string>,
): Promise<string | null> {
  const l = TASK_BLOCK_LABELS[language] ?? TASK_BLOCK_LABELS['en'];
  const lines: string[] = [];

  const project = scope ? await resolveCourseProject(scope) : null;
  if (project) {
    const desc = project.description ? ` — ${project.description}` : '';
    lines.push(`- ${l.project}: ${project.title}${desc}`);
    if (project.deliverables.length > 0) {
      const items = project.deliverables
        .map((d) => (d.description ? `${d.name} (${d.description})` : d.name))
        .join('; ');
      lines.push(`- ${l.deliverables}: ${items}`);
    }
  }

  if (hasLessonData(collectionKey, lessonNumber)) {
    const lesson = getLessonData(collectionKey, lessonNumber);
    const exercise = lesson.exercise?.trim();
    const commitment = lesson.commitment?.trim();
    if (exercise) lines.push(`- ${l.exercise}: ${exercise}`);
    if (commitment) lines.push(`- ${l.commitment}: ${commitment}`);
  }

  // Milestone progress — how far along they actually are, which is the thing
  // the AI could not know before `milestone_progress` existed. Rendered with
  // the key visible so the marker instruction below has something exact to
  // quote; a paraphrased key would not survive validation in handler.ts.
  const milestones = scope ? await resolveCourseMilestones(scope) : [];
  if (milestones.length > 0) {
    const reached = reachedMilestoneKeys ?? new Set<string>();
    const rendered = milestones
      .map((m) => `${m.name} [${m.key}] — ${reached.has(m.key) ? l.done : l.pending}`)
      .join('; ');
    lines.push(`- ${l.progress}: ${rendered}`);
    // Only ask for the marker when something is still outstanding. Inviting it
    // with everything done is an invitation to emit a duplicate.
    if (milestones.some((m) => !reached.has(m.key))) {
      lines.push(`- ${l.marker}`);
    }
  }

  if (lines.length === 0) return null;
  return [`${l.header}:`, ...lines].join('\n');
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
  /** Milestone keys this participant has already reached, for coach stance. */
  reachedMilestoneKeys?: ReadonlySet<string>;
}): Promise<string> {
  const {
    stance, participantNoun, collectionKey, currentLessonNumber, language, sink, scope,
    reachedMilestoneKeys,
  } = params;

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

  const taskFacts = await buildTaskFactsBlock(
    collectionKey, currentLessonNumber, language, scope, reachedMilestoneKeys,
  );
  return taskFacts ? `${framing}\n\n${taskFacts}` : framing;
}
