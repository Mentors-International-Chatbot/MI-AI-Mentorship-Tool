import { Socio, SocioFlag } from '@/lib/repo/types';
import { SocioProgress } from '../types';
import { getLessonTitle, getLessonCount } from '@/lib/lessons/db-lesson-service';
import { repo } from '@/lib/repo';
import { getCourseMeta, resolveLocalized } from '@/lib/courses/course-meta';
import type { SupportedLanguage } from '@/lib/i18n/languages';

/** Bump whenever the Layer 2 prompt text changes. Recorded on every AiInvocation. */
export const CONTEXT_PROMPT_VERSION = 'v2';

// ─── Layer 2: Socio Context (~150 tokens) — Always Sent ────────────
// Built dynamically from the database for every message.

export { getLessonTitle };

function formatCompletedLessons(
  completed: number[],
  collectionKey: string,
  language: SupportedLanguage = 'es',
): string {
  const noneLabels: Record<SupportedLanguage, string> = {
    es: 'Ninguna',
    en: 'None',
    pt: 'Nenhuma',
  };
  if (completed.length === 0) return noneLabels[language] ?? noneLabels['en'];
  return completed
    .map((n) => `${n} (${getLessonTitle(collectionKey, n)})`)
    .join(', ');
}

// Localized scaffolding strings for context prompts
interface ContextScaffolding {
  contextHeader: (pn: string) => string;
  nameLabel: string;
  notSpecifiedYet: string;
  notSpecified: string;
  currentLessonLabel: string;
  completedLessonsLabel: string;
  lastComprehensionLabel: string;
  lastImplementationLabel: string;
  daysSinceContactLabel: string;
  activeFlagsLabel: string;
  noneFlags: string;
  noneLessons: string;
  friendLabel: string;
  useNameNaturally: (pn: string) => string;
  typeOfLabel: (cl: string) => string;
}

const CONTEXT_SCAFFOLDING: Record<SupportedLanguage, ContextScaffolding> = {
  es: {
    contextHeader: (pn) => `CONTEXTO DEL ${pn.toUpperCase()}`,
    nameLabel: 'Nombre',
    notSpecifiedYet: 'No especificado aún',
    notSpecified: 'No especificado',
    currentLessonLabel: 'Lección actual',
    completedLessonsLabel: 'Lecciones completadas',
    lastComprehensionLabel: 'Última comprensión',
    lastImplementationLabel: 'Última implementación',
    daysSinceContactLabel: 'Días desde último contacto',
    activeFlagsLabel: 'Banderas activas',
    noneFlags: 'Ninguna',
    noneLessons: 'Ninguna',
    friendLabel: 'Amigo',
    useNameNaturally: (pn) => `Usa el nombre del ${pn} naturalmente en la conversación.`,
    typeOfLabel: (cl) => `Tipo de ${cl.toLowerCase()}`,
  },
  en: {
    contextHeader: (pn) => `${pn.toUpperCase()} CONTEXT`,
    nameLabel: 'Name',
    notSpecifiedYet: 'Not specified yet',
    notSpecified: 'Not specified',
    currentLessonLabel: 'Current lesson',
    completedLessonsLabel: 'Completed lessons',
    lastComprehensionLabel: 'Last comprehension',
    lastImplementationLabel: 'Last implementation',
    daysSinceContactLabel: 'Days since last contact',
    activeFlagsLabel: 'Active flags',
    noneFlags: 'None',
    noneLessons: 'None',
    friendLabel: 'Friend',
    useNameNaturally: (pn) => `Use the ${pn}'s name naturally in conversation.`,
    typeOfLabel: (cl) => `${cl} type`,
  },
  pt: {
    contextHeader: (pn) => `CONTEXTO DO ${pn.toUpperCase()}`,
    nameLabel: 'Nome',
    notSpecifiedYet: 'Não especificado ainda',
    notSpecified: 'Não especificado',
    currentLessonLabel: 'Lição atual',
    completedLessonsLabel: 'Lições completadas',
    lastComprehensionLabel: 'Última compreensão',
    lastImplementationLabel: 'Última implementação',
    daysSinceContactLabel: 'Dias desde último contato',
    activeFlagsLabel: 'Bandeiras ativas',
    noneFlags: 'Nenhuma',
    noneLessons: 'Nenhuma',
    friendLabel: 'Amigo',
    useNameNaturally: (pn) => `Use o nome do ${pn} naturalmente na conversa.`,
    typeOfLabel: (cl) => `Tipo de ${cl.toLowerCase()}`,
  },
};

/**
 * Renders the "active flags" line from the real flags.
 *
 * This line used to be the literal string "None" in all three languages,
 * unconditionally. A learner with three unresolved RED distress flags had a
 * context block telling the model there were none — not an absent signal but a
 * false assertion, which is worse, because the model had no way to notice.
 *
 * Only the level and the reason code are shown. `reason` is a raw key=value
 * debug line (see `sentiment/pipeline.ts:fallbackReason`) and reasonParams can
 * carry the learner's verbatim words; neither belongs in a prompt the learner's
 * own reply is generated from.
 */
function formatActiveFlags(
  flags: readonly SocioFlag[] | undefined,
  scf: ContextScaffolding,
): string {
  if (!flags || flags.length === 0) return scf.noneFlags;

  const red = flags.filter((f) => f.level === 'RED').length;
  const yellow = flags.filter((f) => f.level === 'YELLOW').length;

  const parts: string[] = [];
  if (red > 0) parts.push(`${red} RED`);
  if (yellow > 0) parts.push(`${yellow} YELLOW`);

  const codes = [...new Set(flags.map((f) => f.reasonCode).filter((c): c is string => !!c))];
  const suffix = codes.length > 0 ? ` (${codes.join(', ')})` : '';

  return `${parts.join(', ')}${suffix}`;
}

export async function buildContextPrompt(
  socio: Socio,
  progress: SocioProgress | undefined,
  collectionKey: string,
  language: SupportedLanguage = 'es',
  /**
   * Active flags, already fetched by the router. Undefined for the callers that
   * assemble a prompt outside the conversational path (the reminder cron, the
   * admin test sandbox) — those render "None", which is now honest rather than
   * merely true-by-hardcoding, because they have no socio state to read.
   */
  activeFlags?: readonly SocioFlag[],
): Promise<string> {
  const context = await repo.getSocioContext(socio.id);
  const meta = await getCourseMeta(collectionKey);

  // Resolve terminology for this language
  const participantNoun = resolveLocalized(meta.terminology.participant, language);
  const hasLearnerContext = meta.learnerContext !== undefined;
  const contextLabel = hasLearnerContext
    ? resolveLocalized(meta.learnerContext!.label, language)
    : undefined;
  const scf = CONTEXT_SCAFFOLDING[language] ?? CONTEXT_SCAFFOLDING['en'];

  if (!progress || progress.completedLessons.length === 0) {
    return buildNewSocioContext(socio, context, collectionKey, meta, participantNoun, hasLearnerContext, language, contextLabel, scf, activeFlags);
  }

  const currentTitle = getLessonTitle(collectionKey, progress.currentLessonNumber);

  // Build context block - business fields only when learnerContext exists
  let block = `${scf.contextHeader(participantNoun)}:
- ${scf.nameLabel}: ${socio.name || scf.friendLabel}`;

  if (hasLearnerContext && contextLabel) {
    block += `
- ${contextLabel}: ${socio.businessDescription || scf.notSpecifiedYet}
- ${scf.typeOfLabel(contextLabel)}: ${socio.businessName || scf.notSpecified}`;
  }

  block += `
- ${scf.currentLessonLabel}: ${progress.currentLessonNumber} — "${currentTitle}"
- ${scf.completedLessonsLabel}: ${formatCompletedLessons(progress.completedLessons, collectionKey, language)}
- ${scf.lastComprehensionLabel}: ${progress.weeklyUnderstanding ?? 'N/A'}/10`;

  // `weeklyImplementation` has no writer. The field exists, the repo maps it,
  // and this line rendered "N/A/10" into every prompt since launch, because the
  // only caller of `completeLesson` (messaging/handler.ts) passes `understanding`
  // and never `implementation`. The question that would populate it lives in
  // `buildCheckinPrompt`, which the router cannot reach.
  //
  // Emitting a permanently-N/A metric trains the model that the field is
  // meaningless, so the line is omitted until a writer exists rather than left
  // as decoration. Same class of defect as the flags line below, one severity
  // down: "N/A" was useless, "Active flags: None" was false.
  if (progress.weeklyImplementation !== null) {
    block += `
- ${scf.lastImplementationLabel}: ${progress.weeklyImplementation}/10`;
  }

  block += `
- ${scf.daysSinceContactLabel}: ${progress.daysSinceLastInteraction}
- ${scf.activeFlagsLabel}: ${formatActiveFlags(activeFlags, scf)}`;

  const contextSection = buildPersistentContextSection(context, hasLearnerContext, language, contextLabel);
  if (contextSection) {
    block += contextSection;
  }

  // Add personalization instruction - conditional on learnerContext
  if (hasLearnerContext) {
    const personalizationInstruction = resolveLocalized(meta.learnerContext!.personalizationInstruction, language);
    block += `\n\n${scf.useNameNaturally(participantNoun)} ${personalizationInstruction}`;
  } else {
    block += `\n\n${scf.useNameNaturally(participantNoun)}`;
  }

  return block;
}

function buildNewSocioContext(
  socio: Socio,
  context: Awaited<ReturnType<typeof repo.getSocioContext>>,
  collectionKey: string,
  meta: Awaited<ReturnType<typeof getCourseMeta>>,
  participantNoun: string,
  hasLearnerContext: boolean,
  language: SupportedLanguage,
  contextLabel: string | undefined,
  scf: ContextScaffolding,
  activeFlags?: readonly SocioFlag[],
): string {
  const lessonTitle = getLessonTitle(collectionKey, 1);
  const totalLessons = getLessonCount(collectionKey);

  // Localized first lesson message
  const firstLessonNote: Record<SupportedLanguage, string> = {
    es: 'Es su primera lección. Sé especialmente cálido y motivador.',
    en: 'This is their first lesson. Be especially warm and encouraging.',
    pt: 'Esta é sua primeira lição. Seja especialmente caloroso e motivador.',
  };

  // Localized welcome prompt
  const welcomePrompt: Record<SupportedLanguage, (pn: string) => string> = {
    es: (pn) => `Este ${pn} acaba de empezar el programa. Hazlo sentir bienvenido y emocionado por aprender.`,
    en: (pn) => `This ${pn} just started the program. Make them feel welcome and excited to learn.`,
    pt: (pn) => `Este ${pn} acabou de começar o programa. Faça-o se sentir bem-vindo e animado para aprender.`,
  };

  // Localized "we don't know yet"
  const notKnownYet: Record<SupportedLanguage, string> = {
    es: 'Aún no conocemos este dato.',
    en: 'We don\'t have this info yet.',
    pt: 'Ainda não temos essa informação.',
  };

  let block = `${scf.contextHeader(participantNoun)}:
- ${scf.nameLabel}: ${socio.name || scf.friendLabel}`;

  if (hasLearnerContext && contextLabel) {
    block += `
- ${contextLabel}: ${socio.businessDescription || notKnownYet[language] || notKnownYet['en']}`;
  }

  block += `
- ${scf.currentLessonLabel}: 1${totalLessons > 0 ? ` de ${totalLessons}` : ''} — "${lessonTitle}"
- ${firstLessonNote[language] ?? firstLessonNote['en']}
- ${scf.activeFlagsLabel}: ${formatActiveFlags(activeFlags, scf)}`;

  const contextSection = buildPersistentContextSection(context, hasLearnerContext, language, contextLabel);
  if (contextSection) {
    block += contextSection;
  } else if (hasLearnerContext) {
    // Only prompt to ask about context when learnerContext is defined
    const intakeQuestion = resolveLocalized(meta.learnerContext!.intakeQuestion, language);
    block += `\n\n${welcomePrompt[language]?.(participantNoun) ?? welcomePrompt['en'](participantNoun)} ${intakeQuestion}`;
  } else {
    // No learnerContext - generic welcome, no context intake
    block += `\n\n${welcomePrompt[language]?.(participantNoun) ?? welcomePrompt['en'](participantNoun)}`;
  }

  return block;
}

function buildPersistentContextSection(
  context: Awaited<ReturnType<typeof repo.getSocioContext>>,
  hasLearnerContext: boolean,
  language: SupportedLanguage,
  contextLabel?: string,
): string | null {
  if (!context) return null;

  // Localized field labels
  const fieldLabels: Record<SupportedLanguage, {
    contextType: (cl: string) => string;
    products: string;
    monthlyRevenue: string;
    monthlyExpenses: string;
    employees: string;
    location: string;
    challenges: string;
    goals: string;
    familyContext: string;
    otherFacts: string;
    dataHeader: string;
    importantNote: string;
  }> = {
    es: {
      contextType: (cl) => `Tipo de ${cl.toLowerCase()}`,
      products: 'Productos/servicios',
      monthlyRevenue: 'Ingresos mensuales',
      monthlyExpenses: 'Gastos mensuales',
      employees: 'Empleados',
      location: 'Ubicación',
      challenges: 'Desafíos',
      goals: 'Metas',
      familyContext: 'Contexto familiar',
      otherFacts: 'Otros datos',
      dataHeader: 'DATOS DEL PARTICIPANTE (recopilados de conversaciones anteriores)',
      importantNote: 'IMPORTANTE: Ya conoces estos datos. NO vuelvas a preguntar información que ya tienes. Úsala naturalmente en tus respuestas.',
    },
    en: {
      contextType: (cl) => `${cl} type`,
      products: 'Products/services',
      monthlyRevenue: 'Monthly revenue',
      monthlyExpenses: 'Monthly expenses',
      employees: 'Employees',
      location: 'Location',
      challenges: 'Challenges',
      goals: 'Goals',
      familyContext: 'Family context',
      otherFacts: 'Other facts',
      dataHeader: 'PARTICIPANT DATA (collected from previous conversations)',
      importantNote: 'IMPORTANT: You already know this information. DON\'T ask again for info you already have. Use it naturally in your responses.',
    },
    pt: {
      contextType: (cl) => `Tipo de ${cl.toLowerCase()}`,
      products: 'Produtos/serviços',
      monthlyRevenue: 'Receita mensal',
      monthlyExpenses: 'Despesas mensais',
      employees: 'Funcionários',
      location: 'Localização',
      challenges: 'Desafios',
      goals: 'Metas',
      familyContext: 'Contexto familiar',
      otherFacts: 'Outros dados',
      dataHeader: 'DADOS DO PARTICIPANTE (coletados de conversas anteriores)',
      importantNote: 'IMPORTANTE: Você já conhece essas informações. NÃO pergunte novamente por dados que já possui. Use-os naturalmente em suas respostas.',
    },
  };

  const labels = fieldLabels[language] ?? fieldLabels['en'];
  const facts: string[] = [];

  // Only include business-related fields when learnerContext is present
  if (hasLearnerContext && contextLabel) {
    if (context.businessType) facts.push(`${labels.contextType(contextLabel)}: ${context.businessType}`);
    if (context.products) facts.push(`${labels.products}: ${context.products}`);
    if (context.monthlyRevenue) facts.push(`${labels.monthlyRevenue}: ${context.monthlyRevenue}`);
    if (context.monthlyExpenses) facts.push(`${labels.monthlyExpenses}: ${context.monthlyExpenses}`);
    if (context.numEmployees) facts.push(`${labels.employees}: ${context.numEmployees}`);
    if (context.location) facts.push(`${labels.location}: ${context.location}`);
    if (context.challenges) facts.push(`${labels.challenges}: ${context.challenges}`);
    if (context.goals) facts.push(`${labels.goals}: ${context.goals}`);
  }

  // These are always included regardless of learnerContext
  if (context.familyContext) facts.push(`${labels.familyContext}: ${context.familyContext}`);
  if (context.customFacts) facts.push(`${labels.otherFacts}: ${context.customFacts}`);

  if (facts.length === 0) return null;

  return `\n\n${labels.dataHeader}:\n${facts.join('\n')}\n\n${labels.importantNote}`;
}
