#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * Seed MetricDefinitions
 * ═══════════════════════════════════════════════════════════════════════════
 * MetricObservations can only be written for dimension keys that have a
 * MetricDefinition row. Assessment completion looks definitions up by key
 * (completeAssessment.lookupMetricIds) and silently skips anything missing —
 * which means mentor/flywheel data is lost for undefined dimensions.
 *
 * Sources of truth for which keys must exist, per organization:
 *   1. Every `trackedDimensions[]` entry in every ProgramVersion config
 *      (covers PB&J's `sequencing` / `confidence` and MI's `comprehension` /
 *      `engagement` / `emotional-state`).
 *   2. DIMENSION_DEFINITIONS — the keys the main sensing loop emits
 *      (`comprehension`, `confusion`), which are not always course-tracked.
 *
 * Idempotent: upserts on the (organizationId, key) unique constraint, so
 * re-running refreshes name/category/scale without duplicating rows.
 *
 * Run: npm run db:seed:metrics
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

/** All tracked dimensions are continuous 0-10 scores today. */
const DEFAULT_DATA_TYPE = "continuous";
const DEFAULT_SCALE = { min: 0, max: 10 };

/**
 * Mirrors DIMENSION_DEFINITIONS in src/lib/ai/prompts/constants.ts — the keys
 * the main sensing loop emits for every socio, course-tracked or not. Inlined
 * so this script does not drag the config/prisma singleton chain in with it.
 */
const CORE_SENSING_DIMENSIONS = [
  { key: "comprehension", label: "Comprehension", category: "comprehension" },
  { key: "confusion", label: "Confusion", category: "emotional" },
] as const;

interface DimensionSeed {
  key: string;
  name: string;
  category: string;
  scale: { min: number; max: number };
  /** Where this key came from, for the run log */
  origin: string;
}

/** Shape of a trackedDimensions[] entry inside ProgramVersion.config (JSON). */
interface TrackedDimensionJson {
  key?: unknown;
  label?: unknown;
  category?: unknown;
  scale?: { min?: unknown; max?: unknown };
}

function toDimensionSeed(d: TrackedDimensionJson, origin: string): DimensionSeed | null {
  if (typeof d.key !== "string" || d.key.length === 0) return null;

  return {
    key: d.key,
    name: typeof d.label === "string" && d.label.length > 0 ? d.label : d.key,
    category: typeof d.category === "string" && d.category.length > 0 ? d.category : "learning",
    scale: {
      min: typeof d.scale?.min === "number" ? d.scale.min : DEFAULT_SCALE.min,
      max: typeof d.scale?.max === "number" ? d.scale.max : DEFAULT_SCALE.max,
    },
    origin,
  };
}

/**
 * Collects every dimension key an organization needs a definition for.
 * Later entries do not overwrite earlier ones - the first ProgramVersion that
 * declares a key wins, so an explicit course label beats the generic fallback.
 */
async function collectDimensionsForOrg(
  organizationId: string,
): Promise<Map<string, DimensionSeed>> {
  const dims = new Map<string, DimensionSeed>();

  const versions = await prisma.programVersion.findMany({
    where: { program: { organizationId } },
    select: { id: true, version: true, config: true, program: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });

  for (const v of versions) {
    const config = v.config as { trackedDimensions?: unknown } | null;
    const tracked = config?.trackedDimensions;
    if (!Array.isArray(tracked)) continue;

    for (const raw of tracked) {
      const seed = toDimensionSeed(
        raw as TrackedDimensionJson,
        `${v.program.slug}@${v.version}`,
      );
      if (seed && !dims.has(seed.key)) {
        dims.set(seed.key, seed);
      }
    }
  }

  // The main sensing loop writes these regardless of what a course tracks.
  for (const def of CORE_SENSING_DIMENSIONS) {
    if (dims.has(def.key)) continue;
    dims.set(def.key, {
      key: def.key,
      name: def.label,
      category: def.category,
      scale: DEFAULT_SCALE,
      origin: "core-sensing",
    });
  }

  return dims;
}

async function main() {
  const organizations = await prisma.organization.findMany({
    select: { id: true, slug: true },
    orderBy: { createdAt: "asc" },
  });

  if (organizations.length === 0) {
    console.log("No organizations found. Nothing to seed.");
    return;
  }

  let created = 0;
  let updated = 0;

  for (const org of organizations) {
    const dims = await collectDimensionsForOrg(org.id);
    console.log(`\nOrganization: ${org.slug} (${org.id})`);

    for (const dim of dims.values()) {
      const existing = await prisma.metricDefinition.findUnique({
        where: { organizationId_key: { organizationId: org.id, key: dim.key } },
        select: { id: true },
      });

      await prisma.metricDefinition.upsert({
        where: { organizationId_key: { organizationId: org.id, key: dim.key } },
        create: {
          organizationId: org.id,
          key: dim.key,
          name: dim.name,
          description: `Tracked dimension "${dim.key}" (source: ${dim.origin})`,
          category: dim.category,
          dataType: DEFAULT_DATA_TYPE,
          scale: dim.scale,
        },
        update: {
          name: dim.name,
          category: dim.category,
          dataType: DEFAULT_DATA_TYPE,
          scale: dim.scale,
        },
      });

      if (existing) {
        updated++;
        console.log(`  ~ ${dim.key} (updated, from ${dim.origin})`);
      } else {
        created++;
        console.log(`  + ${dim.key} (created, from ${dim.origin})`);
      }
    }
  }

  console.log(`\nMetricDefinition: ${created} created, ${updated} updated.`);
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
