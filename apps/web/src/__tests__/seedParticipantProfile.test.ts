/**
 * prisma/seed.ts — seeded socios are anchored to an organization
 * ----------------------------------------------------------------------------
 * Org-scoped mentor queries filter on ParticipantProfile.organizationId, so a
 * seeded socio with no profile is invisible to every dashboard and a fresh dev
 * seed silently produces a broken world.
 *
 * The seed runs main() at module scope, so importing it under a mocked
 * PrismaClient IS the test. The client mock is a Proxy that auto-stubs any
 * model/method the seed reaches for, so this stays green as the seed grows and
 * only fails on the behaviour being pinned here.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

const ORG_ID = 'org-seeded-0000-0000-0001';
const SOCIO_ID = 'socio-seeded-0000-0000-01';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ model: string; method: string; args: unknown }>,
  disconnected: null as Promise<void> | null,
  resolveDisconnected: null as (() => void) | null,
}));

vi.mock('@prisma/client', () => {
  const ORG = { id: 'org-seeded-0000-0000-0001', slug: 'mentors-international', name: 'Mentors International' };
  const SOCIO = {
    id: 'socio-seeded-0000-0000-01',
    name: 'María Test',
    language: 'es',
    passwordHash: null,
  };

  // Per-model default returns. Anything not listed resolves to null, which
  // drives the seed down its "create" branches.
  const returns: Record<string, Record<string, unknown>> = {
    organization: { upsert: ORG },
    socio: { findFirst: null, create: SOCIO, update: SOCIO },
    participantProfile: { upsert: { id: 'participant-seeded' } },
  };

  function modelProxy(model: string) {
    return new Proxy(
      {},
      {
        get(_t, method: string) {
          return async (args: unknown) => {
            state.calls.push({ model, method, args });
            const configured = returns[model]?.[method];
            if (configured !== undefined) return configured;
            // Unconfigured reads return null (seed takes the create branch);
            // unconfigured writes return a row shape with an id.
            return method.startsWith('find') ? null : { id: `${model}-stub` };
          };
        },
      },
    );
  }

  class PrismaClient {
    constructor() {
      return new Proxy(this, {
        get(target, prop: string) {
          if (prop === '$disconnect') {
            return async () => {
              state.resolveDisconnected?.();
            };
          }
          if (prop in target) return (target as Record<string, unknown>)[prop];
          return modelProxy(prop);
        },
      });
    }
  }

  return { PrismaClient };
});

vi.mock('@prisma/adapter-neon', () => ({
  PrismaNeon: class {},
}));

vi.mock('@neondatabase/serverless', () => ({ neonConfig: {} }));
vi.mock('ws', () => ({ default: class {} }));
vi.mock('bcryptjs', () => ({ default: { hash: async () => 'hashed' } }));

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  state.disconnected = new Promise<void>((resolve) => {
    state.resolveDisconnected = resolve;
  });
  // Importing runs main(); the seed's own .finally() calls $disconnect, which
  // is how we know it finished.
  await import('../../prisma/seed');
  await state.disconnected;
});

function callsTo(model: string, method: string) {
  return state.calls.filter((c) => c.model === model && c.method === method);
}

describe('prisma/seed.ts', () => {
  it('upserts the organization on the slug backfill-phase1 uses', () => {
    const [call] = callsTo('organization', 'upsert');
    expect(call).toBeDefined();
    const args = call.args as { where: { slug: string } };
    // Same natural key as scripts/backfill-phase1.ts, so the two converge on one
    // row and either can be re-run safely.
    expect(args.where).toEqual({ slug: 'mentors-international' });
  });

  it('gives the seeded socio a ParticipantProfile in that organization', () => {
    const [call] = callsTo('participantProfile', 'upsert');
    expect(call).toBeDefined();
    const args = call.args as {
      where: { socioId: string };
      create: { organizationId: string; socioId: string; preferredLang: string };
    };
    expect(args.create.organizationId).toBe(ORG_ID);
    expect(args.create.socioId).toBe(SOCIO_ID);
    expect(args.create.preferredLang).toBe('es');
  });

  it('keys the profile on socioId so re-seeding cannot duplicate it', () => {
    const [call] = callsTo('participantProfile', 'upsert');
    const args = call.args as { where: { socioId: string } };
    expect(args.where).toEqual({ socioId: SOCIO_ID });
    // One profile write per seed run, not one per socio branch.
    expect(callsTo('participantProfile', 'create')).toHaveLength(0);
  });
});
