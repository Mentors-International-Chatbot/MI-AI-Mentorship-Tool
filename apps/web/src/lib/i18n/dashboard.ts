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
  // Lesson progress
  lessonProgressTitle: string;
  lessonPending: string;
  lessonCompleted: string;
  lessonInProgress: string;
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
  lessonProgressTitle: 'Progreso de lecciones',
  lessonPending: 'Pendiente',
  lessonCompleted: 'Completada',
  lessonInProgress: 'En progreso',
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
  lessonProgressTitle: 'Lesson progress',
  lessonPending: 'Pending',
  lessonCompleted: 'Completed',
  lessonInProgress: 'In progress',
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
  lessonProgressTitle: 'Progresso das lições',
  lessonPending: 'Pendente',
  lessonCompleted: 'Concluída',
  lessonInProgress: 'Em andamento',
};

const DASHBOARD_STRINGS: Record<SupportedLanguage, DashboardStrings> = { es, en, pt };

export function getDashboardStrings(lang: SupportedLanguage): DashboardStrings {
  return DASHBOARD_STRINGS[lang] ?? DASHBOARD_STRINGS.es;
}
