/**
 * Course Metadata Service
 * ═══════════════════════════════════════════════════════════════════════════
 * SINGLE SOURCE OF TRUTH for all course configuration.
 * Resolves: course-specific values → platform defaults (from defaults.ts)
 *
 * This loader is the ONLY path consumers should use - never read raw package
 * JSON elsewhere.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prisma } from '@/lib/db';
import type {
  LocalizedString,
  Identity,
  Terminology,
  LearnerContext,
  OnboardingConfig,
  ScheduledCheckin,
} from '@/lib/journey-package/journey-package.schema';
import {
  DEFAULT_IDENTITY,
  DEFAULT_TERMINOLOGY,
  DEFAULT_LEARNER_CONTEXT,
  DEFAULT_ONBOARDING,
  DEFAULT_SCHEDULED_CHECKINS,
  DEFAULT_COURSE_NAME,
  DEFAULT_DESCRIPTION,
  DEFAULT_LANGUAGE,
  DEFAULT_WELCOME_TEMPLATE,
} from './defaults';
import type { SupportedLanguage } from '@/lib/i18n/languages';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CourseMeta {
  // Basic info
  courseName: string;
  description: string;
  language: string;

  // Identity (Phase A')
  identity: Identity;
  /** Shorthand for identity.mentorName */
  mentorName: string;
  /** Shorthand for identity.displayName ?? courseName */
  displayName: string;

  // Terminology (Phase A')
  terminology: Terminology;

  // Learner Context (Phase A') - undefined = generic course, no context collection
  learnerContext: LearnerContext | undefined;

  // Onboarding (Phase A')
  onboarding: OnboardingConfig;

  // Scheduled Check-ins (Phase A')
  scheduledCheckins: ScheduledCheckin[];
}

// ── LocalizedString Resolution ───────────────────────────────────────────────

/**
 * Resolves a LocalizedString to the requested language.
 * Falls back to 'en' if requested language not available.
 * Never returns empty - en is required in the schema.
 */
export function resolveLocalized(
  str: LocalizedString,
  language: SupportedLanguage | string = 'en',
): string {
  const lang = language as keyof LocalizedString;
  return str[lang] ?? str.en;
}

// ── Course Configuration ─────────────────────────────────────────────────────

/**
 * Course-specific configuration overrides.
 * SINGLE SOURCE OF TRUTH for per-course identity and settings.
 */
interface CourseConfig {
  identity?: Partial<Identity>;
  terminology?: Partial<Terminology>;
  learnerContext?: LearnerContext;
  onboarding?: Partial<OnboardingConfig>;
  scheduledCheckins?: ScheduledCheckin[];
}

const COURSE_CONFIGS: Record<string, CourseConfig> = {
  'mi-colombia-curriculum': {
    identity: {
      mentorName: 'Martín',
      displayName: 'Mentors International',
    },
    terminology: {
      participant: { en: 'partner', es: 'socio' },
    },
    learnerContext: {
      label: {
        en: 'Business',
        es: 'Negocio',
      },
      intakeQuestion: {
        en: 'What type of business do you have and where is it located?',
        es: '¿Qué tipo de negocio tienes y dónde está ubicado?',
      },
      personalizationInstruction: {
        en: 'Adapt all examples and advice to the partner\'s specific business type and location. Use their business context to make lessons concrete and actionable.',
        es: 'Adapta todos los ejemplos y consejos al tipo de negocio específico y ubicación del socio. Usa su contexto de negocio para hacer las lecciones concretas y accionables.',
      },
      fields: [
        { key: 'businessType', extractionHint: 'type of business or product/service' },
        { key: 'location', extractionHint: 'city, region, or neighborhood' },
      ],
    },
    onboarding: {
      welcome: {
        en: `Great{participantName}! 👋 We can start your mentorship now.

I'm here to help you strengthen your business with practical lessons on finances, sales, and more.

📚 When you're ready, type "start" to begin your first lesson.`,
        es: `¡Perfecto{participantName}! 👋 Ya podemos empezar con tu mentoría.

Estoy aquí para ayudarte a fortalecer tu negocio con lecciones prácticas sobre finanzas, ventas y más.

📚 Cuando estés listo(a), escribe "comenzar" para iniciar tu primera lección.`,
        pt: `Perfeito{participantName}! 👋 Já podemos começar sua mentoria.

Estou aqui para ajudá-lo a fortalecer seu negócio com lições práticas sobre finanças, vendas e mais.

📚 Quando estiver pronto(a), digite "começar" para iniciar sua primeira lição.`,
      },
      steps: [
        {
          id: 'name',
          field: 'name',
          prompt: {
            en: "Hi! I'm Martín, your virtual mentor 🤖. I'm here to help you grow your business. To get started, what's your name?",
            es: '¡Hola! Soy Martín, tu mentor virtual 🤖. Estoy aquí para ayudarte a crecer tu negocio. Para empezar, ¿cómo te llamas?',
            pt: 'Olá! Sou Martín, seu mentor virtual 🤖. Estou aqui para ajudá-lo a crescer seu negócio. Para começar, qual é o seu nome?',
          },
          required: true,
        },
        {
          id: 'business',
          field: 'businessDescription',
          prompt: {
            en: 'Thanks! Now tell me, what kind of business do you have? For example: clothing store, food sales, cleaning services, etc.',
            es: '¡Gracias! Ahora cuéntame, ¿qué tipo de negocio tienes? Por ejemplo: tienda de ropa, venta de comida, servicios de limpieza, etc.',
            pt: 'Obrigado! Agora me conte, que tipo de negócio você tem? Por exemplo: loja de roupas, venda de comida, serviços de limpeza, etc.',
          },
          required: false,
        },
      ],
    },
    scheduledCheckins: [
      {
        id: 'financial-weekly',
        cadence: 'weekly',
        prompt: {
          en: 'Hi! It\'s time for your weekly business report. Please tell me: this week, what was your total income (everything that came in) and what was your net profit (what you had left after paying expenses)? You can say something like "I sold 500 and kept 200".',
          es: 'Hola! Es momento de tu reporte semanal de negocio. Por favor cuéntame: esta semana, cuánto fue tu ingreso total (todo lo que entró) y cuánto fue tu ganancia neta (lo que te quedó después de pagar gastos)? Puedes decirme algo como "vendí 500000 y me quedaron 200000".',
          pt: 'Olá! É hora do seu relatório semanal de negócios. Por favor me conte: esta semana, qual foi sua receita total (tudo que entrou) e qual foi seu lucro líquido (o que sobrou depois de pagar as despesas)? Você pode dizer algo como "vendi 500 e sobrou 200".',
        },
        captureMarker: 'FINANCIAL',
        enabled: true,
      },
    ],
  },
  'pbj-basics': {
    identity: {
      mentorName: 'Chef',
      displayName: 'PB&J Academy',
    },
    // No terminology override - uses defaults
    // No learnerContext - generic course
    // No onboarding steps - skip mode in package
    // No scheduled checkins
  },
};

// ── Cache ────────────────────────────────────────────────────────────────────

const metaCache = new Map<string, CourseMeta>();
const loadPromises = new Map<string, Promise<CourseMeta>>();

// ── Resolution Logic ─────────────────────────────────────────────────────────

function mergeIdentity(config?: Partial<Identity>): Identity {
  return {
    mentorName: config?.mentorName ?? DEFAULT_IDENTITY.mentorName,
    displayName: config?.displayName ?? DEFAULT_IDENTITY.displayName,
  };
}

function mergeTerminology(config?: Partial<Terminology>): Terminology {
  return {
    participant: config?.participant ?? DEFAULT_TERMINOLOGY.participant,
  };
}

function mergeOnboarding(config?: Partial<OnboardingConfig>): OnboardingConfig {
  return {
    welcome: config?.welcome ?? DEFAULT_ONBOARDING.welcome,
    steps: config?.steps ?? DEFAULT_ONBOARDING.steps,
  };
}

/**
 * Loads course metadata from DB and merges with course config.
 */
async function loadCourseMetaFromDb(collectionKey: string): Promise<CourseMeta> {
  const collection = await prisma.contentCollection.findFirst({
    where: { slug: collectionKey },
    select: {
      name: true,
      description: true,
    },
  });

  const courseName = collection?.name || DEFAULT_COURSE_NAME;
  const description = collection?.description || DEFAULT_DESCRIPTION;

  // Get course-specific config (or empty)
  const config = COURSE_CONFIGS[collectionKey] || {};

  // Merge with defaults
  const identity = mergeIdentity(config.identity);
  const terminology = mergeTerminology(config.terminology);
  const onboarding = mergeOnboarding(config.onboarding);
  const learnerContext = config.learnerContext ?? DEFAULT_LEARNER_CONTEXT;
  const scheduledCheckins = config.scheduledCheckins ?? DEFAULT_SCHEDULED_CHECKINS;

  return {
    courseName,
    description,
    language: DEFAULT_LANGUAGE,

    identity,
    mentorName: identity.mentorName,
    displayName: identity.displayName ?? courseName,

    terminology,
    learnerContext,
    onboarding,
    scheduledCheckins,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Gets course metadata by collection key.
 * Cached per key, concurrent-safe.
 * This is the ONLY entry point for course configuration.
 */
export async function getCourseMeta(collectionKey: string): Promise<CourseMeta> {
  const cached = metaCache.get(collectionKey);
  if (cached) return cached;

  let loadPromise = loadPromises.get(collectionKey);
  if (!loadPromise) {
    loadPromise = loadCourseMetaFromDb(collectionKey).then((meta) => {
      metaCache.set(collectionKey, meta);
      loadPromises.delete(collectionKey);
      return meta;
    });
    loadPromises.set(collectionKey, loadPromise);
  }

  return loadPromise;
}

/**
 * Clears the metadata cache (for testing).
 */
export function clearCourseMetaCache(): void {
  metaCache.clear();
  loadPromises.clear();
}

// ── Welcome Message Builder ──────────────────────────────────────────────────

/**
 * Builds the welcome message for a participant.
 * Uses course config welcome or falls back to generic template.
 * Substitutes placeholders: {mentorName}, {courseName}, {participantName}
 */
export function buildWelcomeMessage(
  meta: CourseMeta,
  language: SupportedLanguage | string,
  participantName?: string | null,
): string {
  // Get welcome template from config or default
  const welcomeTemplate = meta.onboarding.welcome ?? DEFAULT_WELCOME_TEMPLATE;
  let message = resolveLocalized(welcomeTemplate, language);

  // Substitute placeholders
  message = message.replace(/{mentorName}/g, meta.mentorName);
  message = message.replace(/{courseName}/g, meta.courseName);

  // Participant name: ", Name" or "" if not provided
  const nameStr = participantName?.trim() ? `, ${participantName.trim()}` : '';
  message = message.replace(/{participantName}/g, nameStr);

  return message;
}

// Re-export types for consumers
export type { LocalizedString, Identity, Terminology, LearnerContext, OnboardingConfig, ScheduledCheckin };
