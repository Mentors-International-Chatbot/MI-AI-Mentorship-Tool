import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFlagWithSocio: vi.fn(),
  resolveFlag: vi.fn(),
  snoozeFlag: vi.fn(),
  getSocioById: vi.fn(),
  updateSocio: vi.fn(),
}));

vi.mock('@/lib/repo', () => ({
  repo: {
    getFlagWithSocio: mocks.getFlagWithSocio,
    resolveFlag: mocks.resolveFlag,
    snoozeFlag: mocks.snoozeFlag,
    getSocioById: mocks.getSocioById,
    updateSocio: mocks.updateSocio,
  },
}));

import { executeResolveFlag, executeSnoozeFlag, executeAdjustLearnerOverrides, WrongSocioError } from '../execute';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The one property execute.ts adds beyond the original per-flag routes: a
 * flag id the model supplies must belong to the socio this assistant panel
 * is scoped to, not merely to some socio this mentor owns. Without this, a
 * mentor with two learner pages open could resolve learner B's flag from
 * learner A's panel.
 */
describe('mentor assistant execute — cross-socio flag guard', () => {
  it('resolve_flag refuses a flag that belongs to a different socio', async () => {
    mocks.getFlagWithSocio.mockResolvedValue({ id: 'flag-1', level: 'YELLOW', socio: { id: 'socio-B' } });

    await expect(
      executeResolveFlag('socio-A', 'mentor-1', {
        flagId: 'flag-1',
        disposition: 'monitoring',
      }),
    ).rejects.toBeInstanceOf(WrongSocioError);

    expect(mocks.resolveFlag).not.toHaveBeenCalled();
  });

  it('snooze_flag refuses a flag that belongs to a different socio', async () => {
    mocks.getFlagWithSocio.mockResolvedValue({ id: 'flag-1', level: 'YELLOW', socio: { id: 'socio-B' } });

    await expect(
      executeSnoozeFlag('socio-A', 'mentor-1', { flagId: 'flag-1', days: 3 }),
    ).rejects.toBeInstanceOf(WrongSocioError);

    expect(mocks.snoozeFlag).not.toHaveBeenCalled();
  });

  it('resolve_flag proceeds when the flag does belong to this socio', async () => {
    mocks.getFlagWithSocio.mockResolvedValue({ id: 'flag-1', level: 'YELLOW', socio: { id: 'socio-A' } });
    mocks.resolveFlag.mockResolvedValue({});

    await executeResolveFlag('socio-A', 'mentor-1', { flagId: 'flag-1', disposition: 'monitoring' });

    expect(mocks.resolveFlag).toHaveBeenCalledWith('flag-1', 'mentor-1', { disposition: 'monitoring' });
  });

  it('resolve_flag requires a note when the flag is RED', async () => {
    mocks.getFlagWithSocio.mockResolvedValue({ id: 'flag-1', level: 'RED', socio: { id: 'socio-A' } });

    await expect(
      executeResolveFlag('socio-A', 'mentor-1', { flagId: 'flag-1', disposition: 'escalated' }),
    ).rejects.toThrow(/note is required/i);

    expect(mocks.resolveFlag).not.toHaveBeenCalled();
  });
});

describe('mentor assistant execute — adjust_learner_overrides', () => {
  it('merges only the fields the model actually supplied', async () => {
    mocks.getSocioById.mockResolvedValue({ id: 'socio-A', promptOverrides: { complexity: 0.9, toneOverride: 'kept' } });
    mocks.updateSocio.mockResolvedValue({});

    await executeAdjustLearnerOverrides('socio-A', { warmth: 0.2 });

    expect(mocks.updateSocio).toHaveBeenCalledWith('socio-A', {
      promptOverrides: { complexity: 0.9, toneOverride: 'kept', warmth: 0.2 },
    });
  });
});
