/**
 * `occurrenceCount` / `lastOccurredAt` finally have a writer.
 *
 * Both columns shipped with the flag lifecycle migration and nothing wrote
 * them — every row read `1` and `null` no matter how many times the underlying
 * thing happened. That is the exact shape `writePathAudit.test.ts` exists to
 * catch at the table level, one level down at the column. These tests hold the
 * writer in place.
 */
import { describe, expect, it } from "vitest";
import { inMemoryRepo } from "@/lib/repo/inMemoryRepo";

const NOW = new Date("2026-08-15T12:00:00Z");
const LATER = new Date("2026-08-15T13:00:00Z");

let seq = 0;

async function seedFlag() {
  const socio = await inMemoryRepo.createSocio("web", `learner-${seq++}`);
  const flag = await inMemoryRepo.createFlag({
    socioId: socio.id,
    level: "RED",
    reason: "Learner requested human help",
    source: "learner_request",
    reasonCode: "help.requested",
    reasonParams: { collectionKey: "ai-essentials" },
  });
  return { socioId: socio.id, flag };
}

describe("recordFlagOccurrence", () => {
  it("starts a new flag at one occurrence with no recorded repeat", async () => {
    const { flag } = await seedFlag();
    expect(flag.occurrenceCount).toBe(1);
    expect(flag.lastOccurredAt).toBeNull();
  });

  it("increments the count and stamps the time", async () => {
    const { flag } = await seedFlag();

    const bumped = await inMemoryRepo.recordFlagOccurrence(flag.id, NOW);

    expect(bumped.occurrenceCount).toBe(2);
    expect(bumped.lastOccurredAt).toEqual(NOW);
  });

  it("accumulates across repeated presses", async () => {
    const { flag } = await seedFlag();

    await inMemoryRepo.recordFlagOccurrence(flag.id, NOW);
    await inMemoryRepo.recordFlagOccurrence(flag.id, NOW);
    const third = await inMemoryRepo.recordFlagOccurrence(flag.id, LATER);

    expect(third.occurrenceCount).toBe(4);
    expect(third.lastOccurredAt).toEqual(LATER);
  });

  it("leaves status, level and reason untouched", async () => {
    const { flag } = await seedFlag();

    const bumped = await inMemoryRepo.recordFlagOccurrence(flag.id, NOW);

    expect(bumped.status).toBe(flag.status);
    expect(bumped.level).toBe(flag.level);
    expect(bumped.reason).toBe(flag.reason);
    expect(bumped.reasonCode).toBe(flag.reasonCode);
    expect(bumped.resolved).toBe(false);
  });

  it("throws on an unknown flag rather than silently doing nothing", async () => {
    await expect(inMemoryRepo.recordFlagOccurrence("no-such-flag", NOW)).rejects.toThrow();
  });
});
