import type { SupportedLanguage } from './languages';

export interface DashboardStrings {
  // Layout
  panelTitle: string;
  // Socios list
  sociosTitle: string;
  noActiveSocios: string;
  thStatus: string;
  thName: string;
  thChannel: string;
  thLesson: string;
  thLastInteraction: string;
  noName: string;
  never: string;
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
}

const es: DashboardStrings = {
  panelTitle: 'Panel de Mentores',
  sociosTitle: 'Socios',
  noActiveSocios: 'No hay socios activos.',
  thStatus: 'Estado',
  thName: 'Nombre',
  thChannel: 'Canal',
  thLesson: 'Lección',
  thLastInteraction: 'Última interacción',
  noName: 'Sin nombre',
  never: 'Nunca',
  backToSocios: 'Volver a socios',
  channel: 'Canal',
  language: 'Idioma',
  currentLesson: 'Lección actual',
  satisfactionLabel: 'Satisfacción',
  chatTitle: 'Historial de conversación',
  noMessages: 'Sin mensajes aún.',
  roleSocio: 'Socio',
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
    'Aún no hay datos suficientes para mostrar una tendencia. Los ingresos aparecerán cuando el socio reporte cifras en la conversación.',
};

const en: DashboardStrings = {
  panelTitle: 'Mentor Dashboard',
  sociosTitle: 'Socios',
  noActiveSocios: 'No active socios.',
  thStatus: 'Status',
  thName: 'Name',
  thChannel: 'Channel',
  thLesson: 'Lesson',
  thLastInteraction: 'Last interaction',
  noName: 'No name',
  never: 'Never',
  backToSocios: 'Back to socios',
  channel: 'Channel',
  language: 'Language',
  currentLesson: 'Current lesson',
  satisfactionLabel: 'Satisfaction',
  chatTitle: 'Conversation history',
  noMessages: 'No messages yet.',
  roleSocio: 'Socio',
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
    'Not enough data yet to show a trend. Revenue appears when the socio reports figures in conversation.',
};

const pt: DashboardStrings = {
  panelTitle: 'Painel de Mentores',
  sociosTitle: 'Sócios',
  noActiveSocios: 'Nenhum sócio ativo.',
  thStatus: 'Status',
  thName: 'Nome',
  thChannel: 'Canal',
  thLesson: 'Lição',
  thLastInteraction: 'Última interação',
  noName: 'Sem nome',
  never: 'Nunca',
  backToSocios: 'Voltar aos sócios',
  channel: 'Canal',
  language: 'Idioma',
  currentLesson: 'Lição atual',
  satisfactionLabel: 'Satisfação',
  chatTitle: 'Histórico de conversa',
  noMessages: 'Sem mensagens ainda.',
  roleSocio: 'Sócio',
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
    'Ainda não há dados suficientes para mostrar uma tendência. A receita aparece quando o sócio informar valores na conversa.',
};

const DASHBOARD_STRINGS: Record<SupportedLanguage, DashboardStrings> = { es, en, pt };

export function getDashboardStrings(lang: SupportedLanguage): DashboardStrings {
  return DASHBOARD_STRINGS[lang] ?? DASHBOARD_STRINGS.es;
}
