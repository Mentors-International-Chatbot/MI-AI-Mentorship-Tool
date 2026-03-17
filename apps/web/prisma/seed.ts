import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const CORE_SYSTEM_PROMPT = `Eres el mentor virtual de Mentors International. Guías a micro-emprendedores en Colombia a crecer sus negocios a través de WhatsApp.

REGLAS ABSOLUTAS:
- Habla español colombiano sencillo. Nada de jerga técnica. Si usas un término técnico, defínelo primero en lenguaje simple.
- Máximo 4 oraciones por mensaje. WhatsApp es un medio rápido.
- Solo enseña el currículo de Mentors International. No inventes consejos de otras fuentes.
- NUNCA des consejos legales ni tributarios.
- NUNCA recomiendes préstamos específicos ni productos financieros.
- Si no sabes algo, dilo honestamente: "No tengo esa información. Tu mentor humano puede ayudarte mejor con eso."
- NUNCA adivines ni especules sobre decisiones de negocio.

TONO:
- Cálido y alentador, como un vecino que sabe de negocios y quiere verte salir adelante.
- Celebra cada logro, por pequeño que sea.
- Usa ejemplos de la vida cotidiana colombiana: tiendas de barrio, panaderías, ventas por WhatsApp, mercados locales.
- Emojis con moderación: máximo 1-2 por mensaje, solo cuando sea natural.
- Nunca seas condescendiente. Trata al socio como un profesional que está aprendiendo.
- Sé paciente. Si el socio no entiende, explica de otra manera sin frustración.

FORMATO:
- Mensajes cortos y claros. Párrafos de 1-2 oraciones máximo.
- Una idea por mensaje.
- Haz preguntas abiertas para que el socio reflexione y participe.
- Cuando des un consejo, incluye un paso concreto que puedan hacer hoy.

MARCADORES DE SISTEMA (el socio NO los ve — son procesados por el backend):
- Preocupación moderada: [FLAG:YELLOW|razón breve]
- Urgente (crisis financiera, emergencia, deseo de cerrar negocio, angustia): [FLAG:RED|razón breve]
- Lección completada: [LESSON_COMPLETE:número]
- Escalar a mentor humano: [ESCALATE|razón breve]
- Pon los marcadores al FINAL del mensaje, después de todo el texto para el socio.

PREGUNTAS FUERA DE TEMA:
Si el socio pregunta algo que no tiene que ver con negocios ni con el currículo, redirige amablemente:
"Estoy aquí para ayudarte con tu negocio. ¿Hay algo de tu emprendimiento en lo que pueda apoyarte?"
No escales — simplemente redirige.`;

const CONFIG_SEEDS = [
  // ── Lesson pacing ──
  { key: 'RETEACH_THRESHOLD',       value: '3',     type: 'number',  label: 'Reteach Threshold',           description: 'Understanding score at or below this triggers RETEACH mode',         category: 'lesson_pacing' },
  { key: 'MAX_LESSON_NUMBER',       value: '5',     type: 'number',  label: 'Max Lesson Number',           description: 'Highest lesson number with structured data',                         category: 'lesson_pacing' },
  { key: 'MAX_LESSONS_PER_DAY',     value: '1',     type: 'number',  label: 'Max Lessons Per Day',         description: 'Maximum lessons a socio can complete in a single day',                category: 'lesson_pacing' },
  { key: 'LESSONS_PER_WEEK',        value: '2',     type: 'number',  label: 'Lessons Per Week',            description: 'Target lessons per week',                                            category: 'lesson_pacing' },
  // ── AI behavior ──
  { key: 'MAX_SENTENCES_PER_MESSAGE', value: '4',   type: 'number',  label: 'Max Sentences Per Message',   description: 'Max sentences the AI should use per WhatsApp message',               category: 'ai_behavior' },
  { key: 'MAX_EMOJIS_PER_MESSAGE',   value: '2',    type: 'number',  label: 'Max Emojis Per Message',      description: 'Max emojis the AI should use per message',                           category: 'ai_behavior' },
  // ── Flagging ──
  { key: 'FLAG_YELLOW_THRESHOLD',   value: '5',     type: 'number',  label: 'Yellow Flag Threshold',       description: 'Score at or below this triggers a YELLOW flag',                      category: 'flagging' },
  { key: 'FLAG_RED_THRESHOLD',      value: '2',     type: 'number',  label: 'Red Flag Threshold',          description: 'Score at or below this triggers a RED flag',                         category: 'flagging' },
  // ── Reminders ──
  { key: 'FOLLOWUP_ENABLED',        value: 'true',  type: 'boolean', label: 'Follow-up Enabled',           description: 'Master toggle for follow-up reminder messages',                      category: 'reminders' },
  { key: 'FOLLOWUP_DELAY_HOURS',    value: '24',    type: 'number',  label: 'Follow-up Delay (hours)',     description: 'Hours of inactivity before a proactive reminder is sent',             category: 'reminders' },
  { key: 'MAX_REMINDERS',           value: '2',     type: 'number',  label: 'Max Reminders',               description: 'Max reminder messages per lesson before stopping',                   category: 'reminders' },
  // ── Onboarding ──
  { key: 'REQUIRE_LEGAL_CONSENT',   value: 'false', type: 'boolean', label: 'Require Legal Consent',       description: 'Whether to require legal consent step during onboarding',            category: 'onboarding' },
  // ── Sentiment thresholds ──
  { key: 'SENTIMENT_URGENCY_RED',       value: '8', type: 'number', label: 'Urgency → Red Flag',           description: 'Urgency score at or above this triggers a RED flag',                 category: 'sentiment' },
  { key: 'SENTIMENT_CONFUSION_YELLOW',  value: '7', type: 'number', label: 'Confusion → Yellow Flag',      description: 'Confusion score at or above this triggers a YELLOW flag',             category: 'sentiment' },
  { key: 'SENTIMENT_FRUSTRATION_YELLOW', value: '7', type: 'number', label: 'Frustration → Yellow Flag',   description: 'Frustration score at or above this triggers a YELLOW flag',           category: 'sentiment' },
];

async function main() {
  // ── Seed core system prompt ──
  const existing = await prisma.systemPrompt.findFirst({
    where: { version: '1.0', category: 'core', active: true },
  });

  if (existing) {
    console.log(`Core system prompt v1.0 already exists (id: ${existing.id}). Skipping.`);
  } else {
    const prompt = await prisma.systemPrompt.create({
      data: {
        version: '1.0',
        category: 'core',
        content: CORE_SYSTEM_PROMPT,
        active: true,
        authorId: 'seed',
      },
    });
    console.log(`Created core system prompt v1.0 (id: ${prompt.id})`);
  }

  // ── Seed program config ──
  let created = 0;
  let skipped = 0;
  for (const cfg of CONFIG_SEEDS) {
    const exists = await prisma.programConfig.findUnique({ where: { key: cfg.key } });
    if (exists) {
      skipped++;
      continue;
    }
    await prisma.programConfig.create({ data: cfg });
    created++;
  }
  console.log(`ProgramConfig: ${created} created, ${skipped} already existed.`);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
