/**
 * Backfill Flag Reason Codes
 * ═══════════════════════════════════════════════════════════════════════════
 * Parses the Spanish prose in legacy `sentiment_auto` SocioFlag rows and sets
 * the structured `reasonCode` / `reasonParams` pair, so old flags render in the
 * mentor's dashboard language like new ones do.
 *
 * Three prose formats were written over the life of the pipeline:
 *   A. "Confusión (8/10) o frustración (2/10) elevada. Temas: other"
 *   B. "Alto nivel de urgencia detectado (9/10). Sentimiento: distressed. Temas: business"
 *   C. "Detección automática: urgencia=6, sentimiento=distressed"   ← the key=value
 *      form the FlagsPanel legacy regex targets
 *
 * Rows that match none of them are left alone: the panel's legacy path still
 * renders them, and a wrong code is worse than no code.
 *
 * Usage:
 *   npx tsx scripts/backfill-flag-reason-codes.ts             # dry run (default)
 *   npx tsx scripts/backfill-flag-reason-codes.ts --apply     # actually write
 *
 * Idempotent: rows that already have a reasonCode are skipped.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import type { FlagReasonCode, FlagReasonParams } from '../src/lib/repo/types';

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  console.error('[Backfill] DATABASE_URL not set. Check your .env file.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

/** Same rule as the write side: 'other' alone is noise, not a topic. */
function usefulTopics(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const topics = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (topics.length === 0) return undefined;
  if (topics.length === 1 && topics[0] === 'other') return undefined;
  return topics;
}

type Parsed = { reasonCode: FlagReasonCode; reasonParams: FlagReasonParams };

/**
 * `thresholds` are today's configured values. The value in force when a flag
 * was written isn't recorded anywhere, so this is the best estimate available —
 * and it only decides which of two crossed signals to name.
 */
function parseReason(
  reason: string,
  thresholds: { urgency: number; confusion: number; frustration: number },
): Parsed | null {
  const topics = usefulTopics(reason.match(/Temas:\s*(.+?)\s*$/i)?.[1]);

  // ── Urgency / distress: formats B and C ────────────────────────────────
  const urgency =
    reason.match(/urgencia detectado\s*\((\d+)\/10\)/i)?.[1] ??
    reason.match(/urgencia=(\d+)/i)?.[1];
  const sentiment =
    reason.match(/Sentimiento:\s*(\w+)/i)?.[1] ?? reason.match(/sentimiento=(\w+)/i)?.[1];

  if (urgency !== undefined) {
    const value = Number(urgency);
    return {
      reasonCode: value >= thresholds.urgency ? 'sentiment.urgency_high' : 'sentiment.distressed',
      reasonParams: {
        urgency: value,
        threshold: thresholds.urgency,
        ...(sentiment ? { sentiment } : {}),
        ...(topics ? { topics } : {}),
      },
    };
  }

  // ── Confusion / frustration: formats A and C ───────────────────────────
  const confusionRaw =
    reason.match(/Confusión\s*\((\d+)\/10\)/i)?.[1] ?? reason.match(/confusión=(\d+)/i)?.[1];
  const frustrationRaw =
    reason.match(/frustración\s*\((\d+)\/10\)/i)?.[1] ?? reason.match(/frustración=(\d+)/i)?.[1];

  if (confusionRaw === undefined && frustrationRaw === undefined) return null;

  const confusion = confusionRaw === undefined ? null : Number(confusionRaw);
  const frustration = frustrationRaw === undefined ? null : Number(frustrationRaw);

  // The old text recorded both scores whichever one fired, so re-derive the
  // trigger the way the pipeline now does: whoever cleared by the wider margin,
  // confusion breaking a tie.
  const confusionMargin = confusion === null ? null : confusion - thresholds.confusion;
  const frustrationMargin = frustration === null ? null : frustration - thresholds.frustration;
  const confusionCrossed = confusionMargin !== null && confusionMargin >= 0;
  const frustrationCrossed = frustrationMargin !== null && frustrationMargin >= 0;

  // Neither crosses today's thresholds — the config must have moved. Not confident.
  if (!confusionCrossed && !frustrationCrossed) return null;

  const reportConfusion =
    confusionCrossed &&
    (!frustrationCrossed || (confusionMargin as number) >= (frustrationMargin as number));

  return {
    reasonCode: reportConfusion
      ? 'sentiment.confusion_elevated'
      : 'sentiment.frustration_elevated',
    reasonParams: {
      value: reportConfusion ? (confusion as number) : (frustration as number),
      threshold: reportConfusion ? thresholds.confusion : thresholds.frustration,
      ...(topics ? { topics } : {}),
    },
  };
}

async function main() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const configRows = await prisma.programConfig.findMany({
      where: {
        key: {
          in: [
            'SENTIMENT_URGENCY_RED',
            'SENTIMENT_CONFUSION_YELLOW',
            'SENTIMENT_FRUSTRATION_YELLOW',
          ],
        },
      },
    });
    const configured = (key: string, fallback: number): number => {
      // A key can now exist at several scopes. Flags carry no scope of their
      // own, so read the platform tier and fall back to whatever exists.
      const matches = configRows.filter((r) => r.key === key);
      const row =
        matches.find((r) => r.organizationId === null && r.collectionKey === null) ?? matches[0];
      const n = Number(row?.value);
      return Number.isFinite(n) ? n : fallback;
    };
    const thresholds = {
      urgency: configured('SENTIMENT_URGENCY_RED', 8),
      confusion: configured('SENTIMENT_CONFUSION_YELLOW', 7),
      frustration: configured('SENTIMENT_FRUSTRATION_YELLOW', 7),
    };

    console.log(
      `[Backfill] ${APPLY ? 'APPLY' : 'DRY RUN'} · thresholds urgency>=${thresholds.urgency} ` +
        `confusion>=${thresholds.confusion} frustration>=${thresholds.frustration}`,
    );

    const flags = await prisma.socioFlag.findMany({
      where: { source: 'sentiment_auto' },
      select: { id: true, reason: true, reasonCode: true },
      orderBy: { createdAt: 'asc' },
    });

    let updated = 0;
    let skippedExisting = 0;
    let unparseable = 0;
    const unparseableSamples: string[] = [];

    for (const flag of flags) {
      if (flag.reasonCode) {
        skippedExisting++;
        continue;
      }

      const parsed = parseReason(flag.reason, thresholds);
      if (!parsed) {
        unparseable++;
        if (unparseableSamples.length < 5) unparseableSamples.push(flag.reason);
        continue;
      }

      if (APPLY) {
        await prisma.socioFlag.update({
          where: { id: flag.id },
          data: {
            reasonCode: parsed.reasonCode,
            reasonParams: parsed.reasonParams as object,
          },
        });
      } else {
        console.log(
          `  ${flag.id} → ${parsed.reasonCode} ${JSON.stringify(parsed.reasonParams)}`,
        );
      }
      updated++;
    }

    console.log('[Backfill] ─────────────────────────────────');
    console.log(`[Backfill] scanned:           ${flags.length}`);
    console.log(`[Backfill] ${APPLY ? 'updated:' : 'would update:'}      ${updated}`);
    console.log(`[Backfill] skipped-existing:  ${skippedExisting}`);
    console.log(`[Backfill] unparseable:       ${unparseable}`);
    if (unparseableSamples.length > 0) {
      console.log('[Backfill] unparseable samples (left to the panel fallback):');
      for (const s of unparseableSamples) console.log(`    ${s}`);
    }
    if (!APPLY) {
      console.log('[Backfill] Dry run — nothing written. Re-run with --apply.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[Backfill] Failed:', err);
  process.exit(1);
});
