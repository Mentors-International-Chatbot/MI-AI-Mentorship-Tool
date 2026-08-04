import type { SupportedLanguage } from './languages';

export interface DashboardStrings {
  // Layout
  panelTitle: string;
  navWebChat: string;
  navAdmin: string;
  signOut: string;
  // Socios list
  sociosTitle: string;
  noActiveSocios: string;
  // Health filter (socios list)
  filterAll: string;
  filterRed: string;
  filterYellow: string;
  filterGreen: string;
  noSociosWithStatus: (status: string) => string;
  // Health reasons — one per HealthReason kind. Spanish is the pre-existing
  // wording, preserved byte-for-byte; en/pt use real plural forms.
  healthReasonRedAlerts: (count: number) => string;
  healthReasonYellowAlerts: (count: number) => string;
  healthReasonInactive: (days: number) => string;
  healthReasonLowUnderstanding: (score: number) => string;
  healthReasonModerateUnderstanding: (score: number) => string;
  healthReasonNone: string;
  thStatus: string;
  thName: string;
  thChannel: string;
  thCourse: string;
  thLesson: string;
  thLastInteraction: string;
  noName: string;
  never: string;
  // Course rollup (socios list). Course *names* come from ContentCollection.name
  // — data, not this table. Only the chrome around them is translated.
  courseFilterAll: string;
  /** Bucket for socios with no curriculumCollectionKey. Not a course. */
  courseUnassigned: string;
  courseParticipants: (count: number) => string;
  courseAvgProgress: (current: number, total: number) => string;
  /** Same, for a collection whose lesson count could not be resolved. */
  courseAvgProgressNoTotal: (current: number) => string;
  courseLastActivity: string;
  coursePlaceholder: string;
  // Detail header
  backToSocios: string;
  channel: string;
  language: string;
  currentLesson: string;
  /** Latest socio satisfaction score (1–10), shown in header when present */
  satisfactionLabel: string;
  // Chat
  chatTitle: string;
  noMessages: string;
  roleSocio: string;
  roleAI: string;
  roleMentor: string;
  roleSystem: string;
  // AI toggle
  aiActive: string;
  aiPausedLabel: string;
  takeOver: string;
  handBackToAi: string;
  // Send message
  sendPlaceholder: string;
  sendButton: string;
  sending: string;
  messageSent: string;
  sendError: string;
  // Sliders
  aiSettings: string;
  saved: string;
  complexity: string;
  simple: string;
  advanced: string;
  warmth: string;
  direct: string;
  warm: string;
  positivity: string;
  realistic: string;
  positive: string;
  // Flags
  alertsTitle: string;
  noAlerts: string;
  resolved: string;
  resolveFlag: string;
  showResolved: string;
  hideResolved: string;
  flagSourceAI: string;
  flagSourceAuto: string;
  flagSourceMentor: string;
  flagUrgency: string;
  flagConfusion: string;
  flagFrustration: string;
  flagMood: string;
  sentimentDistressed: string;
  sentimentNegative: string;
  sentimentNeutral: string;
  sentimentPositive: string;
  // Lesson progress
  lessonProgressTitle: string;
  lessonProgressEmpty: string;
  lessonPending: string;
  lessonCompleted: string;
  lessonInProgress: string;
  // Weekly summaries (socio detail)
  weeklySummariesTitle: string;
  summaryGenerate: string;
  summaryGenerating: string;
  summaryRegenerate: string;
  summaryNone: string;
  summaryShow: string;
  summaryHide: string;
  summaryAchievements: string;
  summaryRisks: string;
  summaryRecommendedAction: string;
  summaryMetricMessages: string;
  summaryMetricLessons: string;
  summaryMetricConfusion: string;
  summaryMetricFrustration: string;
  summaryGenerateErrorNoMessages: string;
  summaryGenerateErrorGeneric: string;
  // Revenue trend (socio detail)
  revenueTrendTitle: string;
  revenueTrendEmpty: string;
  // Configurable panels
  /** Fallback heading for a dimension_trend panel with no configured title. */
  dimensionTrendTitle: (dimension: string) => string;
  dimensionTrendEmpty: string;
  assessmentScoresTitle: string;
  assessmentScoresEmpty: string;
  assessmentPassed: string;
  assessmentNotPassed: string;
  assessmentInProgress: string;
  assessmentAttempts: (n: number) => string;
  // ── Alert snapshot (/dashboard/alerts) ────────────────────────────────────
  // Zone headings and empty states must stay course-neutral: a university
  // course has students, not socios. Where a participant noun is unavoidable,
  // these use a neutral plural; the per-card noun is resolved from
  // CourseMeta.terminology instead, so a single page can name two courses'
  // participants differently.
  signalsTitle: string;
  signalsSubtitle: string;
  tileNeedsYouNow: string;
  tileWatching: string;
  tileGoodNews: string;
  zoneNeedsYouNowTitle: string;
  /**
   * Zone 2. Never "AI is handling" — the AI does not see these flags at all.
   * See the ZoneKey docblock in `src/lib/signals/zones.ts`.
   */
  zoneWatchingTitle: string;
  zoneGoodNewsTitle: string;
  /** Empty states read as good news, not as a blank panel. */
  zoneNeedsYouNowEmpty: string;
  zoneWatchingEmpty: string;
  zoneGoodNewsEmpty: string;
  signalsCount: (count: number) => string;
  signalsLessonProgress: (current: number, total: number) => string;
  signalsLessonProgressNoTotal: (current: number) => string;
  signalsNoCourse: string;
  actionTakeOverChat: string;
  actionReadTranscript: string;
  actionStepIn: string;
  // Positive signals — one per PositiveSignal kind.
  positiveGatePassedFirstTry: (lessonKey: string) => string;
  positiveLessonCompleted: (lessonNumber: number) => string;
  positiveReturnedAfterQuiet: (days: number) => string;
  positiveSustainedSentiment: (count: number) => string;
}

const es: DashboardStrings = {
  panelTitle: 'Panel de Mentores',
  navWebChat: 'Chat web',
  navAdmin: 'Administración',
  signOut: 'Cerrar sesión',
  sociosTitle: 'Aprendices',
  noActiveSocios: 'No hay aprendices activos.',
  filterAll: 'Todos',
  filterRed: 'Rojo',
  filterYellow: 'Amarillo',
  filterGreen: 'Verde',
  noSociosWithStatus: (status) => `No hay aprendices con estado ${status}.`,
  healthReasonRedAlerts: (count) => `${count} alerta(s) roja(s) sin resolver`,
  healthReasonYellowAlerts: (count) => `${count} alerta(s) amarilla(s) sin resolver`,
  healthReasonInactive: (days) => `Inactivo por ${days} días`,
  healthReasonLowUnderstanding: (score) => `Comprensión baja: ${score}/10`,
  healthReasonModerateUnderstanding: (score) => `Comprensión moderada: ${score}/10`,
  healthReasonNone: 'Sin alertas',
  thStatus: 'Estado',
  thName: 'Nombre',
  thChannel: 'Canal',
  thCourse: 'Curso',
  thLesson: 'Lección',
  thLastInteraction: 'Última interacción',
  noName: 'Sin nombre',
  never: 'Nunca',
  courseFilterAll: 'Todos los cursos',
  courseUnassigned: 'Sin curso',
  courseParticipants: (count) => (count === 1 ? '1 participante' : `${count} participantes`),
  courseAvgProgress: (current, total) => `Progreso promedio · lección ${current} de ${total}`,
  courseAvgProgressNoTotal: (current) => `Progreso promedio · lección ${current}`,
  courseLastActivity: 'Última actividad',
  coursePlaceholder: 'Un curso nuevo aparece aquí como configuración, sin código.',
  backToSocios: 'Volver a aprendices',
  channel: 'Canal',
  language: 'Idioma',
  currentLesson: 'Lección actual',
  satisfactionLabel: 'Satisfacción',
  chatTitle: 'Historial de conversación',
  noMessages: 'Sin mensajes aún.',
  roleSocio: 'Aprendiz',
  roleAI: 'IA',
  roleMentor: 'Mentor',
  roleSystem: 'Sistema',
  aiActive: 'Chatbot activo',
  aiPausedLabel: 'Chatbot pausado',
  takeOver: 'Pausar chatbot y responder manualmente',
  handBackToAi: 'Devolver control al chatbot',
  sendPlaceholder: 'Escribir mensaje como mentor...',
  sendButton: 'Enviar mensaje',
  sending: 'Enviando...',
  messageSent: 'Mensaje enviado',
  sendError: 'Error al enviar',
  aiSettings: 'Ajustes de IA',
  saved: 'Guardado',
  complexity: 'Complejidad',
  simple: 'Simple',
  advanced: 'Avanzado',
  warmth: 'Calidez',
  direct: 'Directo',
  warm: 'Cálido',
  positivity: 'Positividad',
  realistic: 'Realista',
  positive: 'Positivo',
  alertsTitle: 'Alertas',
  noAlerts: 'Sin alertas.',
  resolved: 'Resuelta',
  resolveFlag: 'Resolver',
  showResolved: 'Mostrar resueltas',
  hideResolved: 'Ocultar resueltas',
  flagSourceAI: 'IA',
  flagSourceAuto: 'Automático',
  flagSourceMentor: 'Mentor',
  flagUrgency: 'Urgencia',
  flagConfusion: 'Confusión',
  flagFrustration: 'Frustración',
  flagMood: 'Estado de ánimo',
  sentimentDistressed: 'Angustiado',
  sentimentNegative: 'Negativo',
  sentimentNeutral: 'Neutral',
  sentimentPositive: 'Positivo',
  lessonProgressTitle: 'Progreso de lecciones',
  lessonProgressEmpty: 'Este curso aún no tiene lecciones.',
  lessonPending: 'Pendiente',
  lessonCompleted: 'Completada',
  lessonInProgress: 'En progreso',
  weeklySummariesTitle: 'Resúmenes semanales',
  summaryGenerate: 'Generar resumen',
  summaryGenerating: 'Generando...',
  summaryRegenerate: 'Regenerar en el idioma actual',
  summaryNone: 'Sin resúmenes aún.',
  summaryShow: 'Ver',
  summaryHide: 'Ocultar',
  summaryAchievements: 'Logros',
  summaryRisks: 'Riesgos',
  summaryRecommendedAction: 'Acción recomendada',
  summaryMetricMessages: 'Mensajes',
  summaryMetricLessons: 'Lecciones',
  summaryMetricConfusion: 'Confusión prom.',
  summaryMetricFrustration: 'Frustración prom.',
  summaryGenerateErrorNoMessages: 'No hay suficientes mensajes esta semana para generar un resumen.',
  summaryGenerateErrorGeneric: 'No se pudo generar el resumen.',
  revenueTrendTitle: 'Tendencia de ingresos',
  revenueTrendEmpty:
    'Aún no hay datos suficientes para mostrar una tendencia. Los ingresos aparecerán cuando el aprendiz reporte cifras en la conversación.',
  dimensionTrendTitle: (dimension) => `Tendencia: ${dimension}`,
  dimensionTrendEmpty: 'Aún no hay suficientes mediciones para mostrar una tendencia.',
  assessmentScoresTitle: 'Resultados de evaluación',
  assessmentScoresEmpty: 'Sin evaluaciones aún.',
  assessmentPassed: 'Aprobada',
  assessmentNotPassed: 'No aprobada',
  assessmentInProgress: 'En curso',
  assessmentAttempts: (n) => (n === 1 ? '1 intento' : `${n} intentos`),
  signalsTitle: 'Señales',
  signalsSubtitle: 'Quién necesita tu atención hoy, y quién va bien.',
  tileNeedsYouNow: 'Te necesitan ahora',
  tileWatching: 'En observación',
  tileGoodNews: 'Buenas noticias',
  zoneNeedsYouNowTitle: 'Te necesitan ahora',
  zoneWatchingTitle: 'En observación',
  zoneGoodNewsTitle: 'Buenas noticias',
  zoneNeedsYouNowEmpty: 'Nadie necesita atención urgente. Todo en orden por ahora.',
  zoneWatchingEmpty: 'Nadie en observación ahora mismo.',
  zoneGoodNewsEmpty: 'Aún no hay avances que destacar esta semana. Aparecerán aquí cuando alguien complete una lección o apruebe una evaluación.',
  signalsCount: (count) => (count === 1 ? '1 señal' : `${count} señales`),
  signalsLessonProgress: (current, total) => `Lección ${current} de ${total}`,
  signalsLessonProgressNoTotal: (current) => `Lección ${current}`,
  signalsNoCourse: 'Sin curso',
  actionTakeOverChat: 'Tomar la conversación',
  actionReadTranscript: 'Leer conversación',
  actionStepIn: 'Intervenir',
  positiveGatePassedFirstTry: (lessonKey) => `Aprobó la evaluación de "${lessonKey}" al primer intento`,
  positiveLessonCompleted: (lessonNumber) => `Completó la lección ${lessonNumber} esta semana`,
  positiveReturnedAfterQuiet: (days) => `Volvió a escribir después de ${days} días en silencio`,
  positiveSustainedSentiment: (count) => `Ánimo positivo sostenido (${count} mensajes, sin señales negativas)`,
};

const en: DashboardStrings = {
  panelTitle: 'Mentor Dashboard',
  navWebChat: 'Web chat',
  navAdmin: 'Admin',
  signOut: 'Sign Out',
  sociosTitle: 'Learners',
  noActiveSocios: 'No active learners.',
  filterAll: 'All',
  filterRed: 'Red',
  filterYellow: 'Yellow',
  filterGreen: 'Green',
  noSociosWithStatus: (status) => `No learners with status ${status}.`,
  healthReasonRedAlerts: (count) =>
    count === 1 ? '1 unresolved red alert' : `${count} unresolved red alerts`,
  healthReasonYellowAlerts: (count) =>
    count === 1 ? '1 unresolved yellow alert' : `${count} unresolved yellow alerts`,
  healthReasonInactive: (days) =>
    days === 1 ? 'Inactive for 1 day' : `Inactive for ${days} days`,
  healthReasonLowUnderstanding: (score) => `Low comprehension: ${score}/10`,
  healthReasonModerateUnderstanding: (score) => `Moderate comprehension: ${score}/10`,
  healthReasonNone: 'No alerts',
  thStatus: 'Status',
  thName: 'Name',
  thChannel: 'Channel',
  thCourse: 'Course',
  thLesson: 'Lesson',
  thLastInteraction: 'Last interaction',
  noName: 'No name',
  never: 'Never',
  courseFilterAll: 'All courses',
  courseUnassigned: 'Unassigned',
  courseParticipants: (count) => (count === 1 ? '1 participant' : `${count} participants`),
  courseAvgProgress: (current, total) => `Avg progress · lesson ${current} of ${total}`,
  courseAvgProgressNoTotal: (current) => `Avg progress · lesson ${current}`,
  courseLastActivity: 'Last activity',
  coursePlaceholder: 'A new course appears here as configuration, no code.',
  backToSocios: 'Back to learners',
  channel: 'Channel',
  language: 'Language',
  currentLesson: 'Current lesson',
  satisfactionLabel: 'Satisfaction',
  chatTitle: 'Conversation history',
  noMessages: 'No messages yet.',
  roleSocio: 'Learner',
  roleAI: 'AI',
  roleMentor: 'Mentor',
  roleSystem: 'System',
  aiActive: 'Chatbot active',
  aiPausedLabel: 'Chatbot paused',
  takeOver: 'Pause chatbot & respond manually',
  handBackToAi: 'Hand back to chatbot',
  sendPlaceholder: 'Write a message as mentor...',
  sendButton: 'Send message',
  sending: 'Sending...',
  messageSent: 'Message sent',
  sendError: 'Error sending',
  aiSettings: 'AI Settings',
  saved: 'Saved',
  complexity: 'Complexity',
  simple: 'Simple',
  advanced: 'Advanced',
  warmth: 'Warmth',
  direct: 'Direct',
  warm: 'Warm',
  positivity: 'Positivity',
  realistic: 'Realistic',
  positive: 'Positive',
  alertsTitle: 'Alerts',
  noAlerts: 'No alerts.',
  resolved: 'Resolved',
  resolveFlag: 'Resolve',
  showResolved: 'Show resolved',
  hideResolved: 'Hide resolved',
  flagSourceAI: 'AI',
  flagSourceAuto: 'Auto',
  flagSourceMentor: 'Mentor',
  flagUrgency: 'Urgency',
  flagConfusion: 'Confusion',
  flagFrustration: 'Frustration',
  flagMood: 'Mood',
  sentimentDistressed: 'Distressed',
  sentimentNegative: 'Negative',
  sentimentNeutral: 'Neutral',
  sentimentPositive: 'Positive',
  lessonProgressTitle: 'Lesson progress',
  lessonProgressEmpty: 'This course has no lessons yet.',
  lessonPending: 'Pending',
  lessonCompleted: 'Completed',
  lessonInProgress: 'In progress',
  weeklySummariesTitle: 'Weekly summaries',
  summaryGenerate: 'Generate summary',
  summaryGenerating: 'Generating...',
  summaryRegenerate: 'Regenerate in current language',
  summaryNone: 'No summaries yet.',
  summaryShow: 'Show',
  summaryHide: 'Hide',
  summaryAchievements: 'Achievements',
  summaryRisks: 'Risks',
  summaryRecommendedAction: 'Recommended action',
  summaryMetricMessages: 'Messages',
  summaryMetricLessons: 'Lessons',
  summaryMetricConfusion: 'Avg. confusion',
  summaryMetricFrustration: 'Avg. frustration',
  summaryGenerateErrorNoMessages: 'Not enough messages this week to generate a summary.',
  summaryGenerateErrorGeneric: 'Could not generate the summary.',
  revenueTrendTitle: 'Revenue trend',
  revenueTrendEmpty:
    'Not enough data yet to show a trend. Revenue appears when the learner reports figures in conversation.',
  dimensionTrendTitle: (dimension) => `${dimension} trend`,
  dimensionTrendEmpty: 'Not enough measurements yet to show a trend.',
  assessmentScoresTitle: 'Assessment results',
  assessmentScoresEmpty: 'No assessments yet.',
  assessmentPassed: 'Passed',
  assessmentNotPassed: 'Not passed',
  assessmentInProgress: 'In progress',
  assessmentAttempts: (n) => (n === 1 ? '1 attempt' : `${n} attempts`),
  signalsTitle: 'Signals',
  signalsSubtitle: 'Who needs you today, and who is doing well.',
  tileNeedsYouNow: 'Needs you now',
  tileWatching: 'Watching',
  tileGoodNews: 'Good news',
  zoneNeedsYouNowTitle: 'Needs you now',
  zoneWatchingTitle: 'Watching',
  zoneGoodNewsTitle: 'Good news',
  zoneNeedsYouNowEmpty: 'Nobody needs urgent attention. All clear for now.',
  zoneWatchingEmpty: 'Nobody on the watch list right now.',
  zoneGoodNewsEmpty: 'No wins to report yet this week. They show up here when someone completes a lesson or passes an assessment.',
  signalsCount: (count) => (count === 1 ? '1 signal' : `${count} signals`),
  signalsLessonProgress: (current, total) => `Lesson ${current} of ${total}`,
  signalsLessonProgressNoTotal: (current) => `Lesson ${current}`,
  signalsNoCourse: 'No course',
  actionTakeOverChat: 'Take over chat',
  actionReadTranscript: 'Read transcript',
  actionStepIn: 'Step in',
  positiveGatePassedFirstTry: (lessonKey) => `Passed the "${lessonKey}" gate on the first try`,
  positiveLessonCompleted: (lessonNumber) => `Completed lesson ${lessonNumber} this week`,
  positiveReturnedAfterQuiet: (days) =>
    days === 1 ? 'Messaged again after 1 day quiet' : `Messaged again after ${days} days quiet`,
  positiveSustainedSentiment: (count) => `Sustained positive mood (${count} messages, no negative signals)`,
};

const pt: DashboardStrings = {
  panelTitle: 'Painel de Mentores',
  navWebChat: 'Chat web',
  navAdmin: 'Administração',
  signOut: 'Sair',
  sociosTitle: 'Aprendizes',
  noActiveSocios: 'Nenhum aprendiz ativo.',
  filterAll: 'Todos',
  filterRed: 'Vermelho',
  filterYellow: 'Amarelo',
  filterGreen: 'Verde',
  noSociosWithStatus: (status) => `Nenhum aprendiz com status ${status}.`,
  healthReasonRedAlerts: (count) =>
    count === 1 ? '1 alerta vermelho não resolvido' : `${count} alertas vermelhos não resolvidos`,
  healthReasonYellowAlerts: (count) =>
    count === 1 ? '1 alerta amarelo não resolvido' : `${count} alertas amarelos não resolvidos`,
  healthReasonInactive: (days) => (days === 1 ? 'Inativo há 1 dia' : `Inativo há ${days} dias`),
  healthReasonLowUnderstanding: (score) => `Compreensão baixa: ${score}/10`,
  healthReasonModerateUnderstanding: (score) => `Compreensão moderada: ${score}/10`,
  healthReasonNone: 'Sem alertas',
  thStatus: 'Status',
  thName: 'Nome',
  thChannel: 'Canal',
  thCourse: 'Curso',
  thLesson: 'Lição',
  thLastInteraction: 'Última interação',
  noName: 'Sem nome',
  never: 'Nunca',
  courseFilterAll: 'Todos os cursos',
  courseUnassigned: 'Sem curso',
  courseParticipants: (count) => (count === 1 ? '1 participante' : `${count} participantes`),
  courseAvgProgress: (current, total) => `Progresso médio · lição ${current} de ${total}`,
  courseAvgProgressNoTotal: (current) => `Progresso médio · lição ${current}`,
  courseLastActivity: 'Última atividade',
  coursePlaceholder: 'Um curso novo aparece aqui como configuração, sem código.',
  backToSocios: 'Voltar aos aprendizes',
  channel: 'Canal',
  language: 'Idioma',
  currentLesson: 'Lição atual',
  satisfactionLabel: 'Satisfação',
  chatTitle: 'Histórico de conversa',
  noMessages: 'Sem mensagens ainda.',
  roleSocio: 'Aprendiz',
  roleAI: 'IA',
  roleMentor: 'Mentor',
  roleSystem: 'Sistema',
  aiActive: 'Chatbot ativo',
  aiPausedLabel: 'Chatbot pausado',
  takeOver: 'Pausar chatbot e responder manualmente',
  handBackToAi: 'Devolver controle ao chatbot',
  sendPlaceholder: 'Escrever mensagem como mentor...',
  sendButton: 'Enviar mensagem',
  sending: 'Enviando...',
  messageSent: 'Mensagem enviada',
  sendError: 'Erro ao enviar',
  aiSettings: 'Configurações de IA',
  saved: 'Salvo',
  complexity: 'Complexidade',
  simple: 'Simples',
  advanced: 'Avançado',
  warmth: 'Calidez',
  direct: 'Direto',
  warm: 'Caloroso',
  positivity: 'Positividade',
  realistic: 'Realista',
  positive: 'Positivo',
  alertsTitle: 'Alertas',
  noAlerts: 'Sem alertas.',
  resolved: 'Resolvida',
  resolveFlag: 'Resolver',
  showResolved: 'Mostrar resolvidas',
  hideResolved: 'Ocultar resolvidas',
  flagSourceAI: 'IA',
  flagSourceAuto: 'Automático',
  flagSourceMentor: 'Mentor',
  flagUrgency: 'Urgência',
  flagConfusion: 'Confusão',
  flagFrustration: 'Frustração',
  flagMood: 'Humor',
  sentimentDistressed: 'Angustiado',
  sentimentNegative: 'Negativo',
  sentimentNeutral: 'Neutro',
  sentimentPositive: 'Positivo',
  lessonProgressTitle: 'Progresso das lições',
  lessonProgressEmpty: 'Este curso ainda não tem lições.',
  lessonPending: 'Pendente',
  lessonCompleted: 'Concluída',
  lessonInProgress: 'Em andamento',
  weeklySummariesTitle: 'Resumos semanais',
  summaryGenerate: 'Gerar resumo',
  summaryGenerating: 'Gerando...',
  summaryRegenerate: 'Regenerar no idioma atual',
  summaryNone: 'Nenhum resumo ainda.',
  summaryShow: 'Ver',
  summaryHide: 'Ocultar',
  summaryAchievements: 'Conquistas',
  summaryRisks: 'Riscos',
  summaryRecommendedAction: 'Ação recomendada',
  summaryMetricMessages: 'Mensagens',
  summaryMetricLessons: 'Lições',
  summaryMetricConfusion: 'Confusão média',
  summaryMetricFrustration: 'Frustração média',
  summaryGenerateErrorNoMessages: 'Mensagens insuficientes esta semana para gerar um resumo.',
  summaryGenerateErrorGeneric: 'Não foi possível gerar o resumo.',
  revenueTrendTitle: 'Tendência de receita',
  revenueTrendEmpty:
    'Ainda não há dados suficientes para mostrar uma tendência. A receita aparece quando o aprendiz informar valores na conversa.',
  dimensionTrendTitle: (dimension) => `Tendência: ${dimension}`,
  dimensionTrendEmpty: 'Ainda não há medições suficientes para mostrar uma tendência.',
  assessmentScoresTitle: 'Resultados da avaliação',
  assessmentScoresEmpty: 'Nenhuma avaliação ainda.',
  assessmentPassed: 'Aprovada',
  assessmentNotPassed: 'Não aprovada',
  assessmentInProgress: 'Em andamento',
  assessmentAttempts: (n) => (n === 1 ? '1 tentativa' : `${n} tentativas`),
  signalsTitle: 'Sinais',
  signalsSubtitle: 'Quem precisa de você hoje, e quem está indo bem.',
  tileNeedsYouNow: 'Precisam de você agora',
  tileWatching: 'Em observação',
  tileGoodNews: 'Boas notícias',
  zoneNeedsYouNowTitle: 'Precisam de você agora',
  zoneWatchingTitle: 'Em observação',
  zoneGoodNewsTitle: 'Boas notícias',
  zoneNeedsYouNowEmpty: 'Ninguém precisa de atenção urgente. Tudo em ordem por enquanto.',
  zoneWatchingEmpty: 'Ninguém em observação no momento.',
  zoneGoodNewsEmpty: 'Ainda não há avanços para destacar esta semana. Eles aparecem aqui quando alguém conclui uma lição ou é aprovado numa avaliação.',
  signalsCount: (count) => (count === 1 ? '1 sinal' : `${count} sinais`),
  signalsLessonProgress: (current, total) => `Lição ${current} de ${total}`,
  signalsLessonProgressNoTotal: (current) => `Lição ${current}`,
  signalsNoCourse: 'Sem curso',
  actionTakeOverChat: 'Assumir a conversa',
  actionReadTranscript: 'Ler conversa',
  actionStepIn: 'Intervir',
  positiveGatePassedFirstTry: (lessonKey) => `Foi aprovado na avaliação de "${lessonKey}" na primeira tentativa`,
  positiveLessonCompleted: (lessonNumber) => `Concluiu a lição ${lessonNumber} esta semana`,
  positiveReturnedAfterQuiet: (days) =>
    days === 1 ? 'Voltou a escrever após 1 dia em silêncio' : `Voltou a escrever após ${days} dias em silêncio`,
  positiveSustainedSentiment: (count) => `Ânimo positivo sustentado (${count} mensagens, sem sinais negativos)`,
};

const DASHBOARD_STRINGS: Record<SupportedLanguage, DashboardStrings> = { es, en, pt };

export function getDashboardStrings(lang: SupportedLanguage): DashboardStrings {
  return DASHBOARD_STRINGS[lang] ?? DASHBOARD_STRINGS.es;
}
