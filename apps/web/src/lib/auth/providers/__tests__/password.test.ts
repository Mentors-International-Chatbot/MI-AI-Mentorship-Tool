/**
 * PasswordProvider: behavior-preserving wrap of the lookup + verifyPassword
 * logic that used to live inline in /api/auth/login. Both failure modes
 * (no account, wrong password) collapse to one InvalidCredentialsError —
 * the caller, not the provider, decides the user-facing message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = {
  socio: { findFirst: vi.fn() },
  mentor: { findUnique: vi.fn() },
};
const mockVerifyPassword = vi.fn();

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../password', () => ({ verifyPassword: mockVerifyPassword }));

const { PasswordProvider, InvalidCredentialsError } = await import('../password');

const provider = new PasswordProvider();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PasswordProvider.complete — socio', () => {
  it('returns a password ProviderCompletionResult for a valid phone+password', async () => {
    mockPrisma.socio.findFirst.mockResolvedValue({ id: 'socio-1', name: 'Ana', passwordHash: 'hash' });
    mockVerifyPassword.mockResolvedValue(true);

    const result = await provider.complete({ userType: 'socio', identifier: '+571234', password: 'secret' });

    expect(result).toEqual({
      provider: 'password',
      subject: 'socio-1',
      attributes: { role: 'socio', name: 'Ana', socioId: 'socio-1' },
    });
  });

  it('falls back to "Socio" when the row has no name', async () => {
    mockPrisma.socio.findFirst.mockResolvedValue({ id: 'socio-1', name: null, passwordHash: 'hash' });
    mockVerifyPassword.mockResolvedValue(true);

    const result = await provider.complete({ userType: 'socio', identifier: '+571234', password: 'secret' });

    expect(result.attributes.name).toBe('Socio');
  });

  it('throws InvalidCredentialsError when no socio matches the identifier', async () => {
    mockPrisma.socio.findFirst.mockResolvedValue(null);

    await expect(
      provider.complete({ userType: 'socio', identifier: '+571234', password: 'secret' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('throws InvalidCredentialsError when the socio has no passwordHash yet (WhatsApp-only)', async () => {
    mockPrisma.socio.findFirst.mockResolvedValue({ id: 'socio-1', name: 'Ana', passwordHash: null });

    await expect(
      provider.complete({ userType: 'socio', identifier: '+571234', password: 'secret' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('throws InvalidCredentialsError when the password does not match', async () => {
    mockPrisma.socio.findFirst.mockResolvedValue({ id: 'socio-1', name: 'Ana', passwordHash: 'hash' });
    mockVerifyPassword.mockResolvedValue(false);

    await expect(
      provider.complete({ userType: 'socio', identifier: '+571234', password: 'wrong' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe('PasswordProvider.complete — mentor', () => {
  it('maps role "admin" through and lowercases the email lookup', async () => {
    mockPrisma.mentor.findUnique.mockResolvedValue({ id: 'mentor-1', name: 'Rosa', role: 'admin', passwordHash: 'hash' });
    mockVerifyPassword.mockResolvedValue(true);

    const result = await provider.complete({ userType: 'mentor', identifier: 'Rosa@Example.com', password: 'secret' });

    expect(mockPrisma.mentor.findUnique).toHaveBeenCalledWith({ where: { email: 'rosa@example.com' } });
    expect(result).toEqual({
      provider: 'password',
      subject: 'mentor-1',
      attributes: { role: 'admin', name: 'Rosa', mentorId: 'mentor-1' },
    });
  });

  it('maps any non-admin mentor role to "mentor"', async () => {
    mockPrisma.mentor.findUnique.mockResolvedValue({ id: 'mentor-2', name: 'Luis', role: 'mentor', passwordHash: 'hash' });
    mockVerifyPassword.mockResolvedValue(true);

    const result = await provider.complete({ userType: 'mentor', identifier: 'luis@example.com', password: 'secret' });

    expect(result.attributes.role).toBe('mentor');
  });

  it('throws InvalidCredentialsError when no mentor matches the email', async () => {
    mockPrisma.mentor.findUnique.mockResolvedValue(null);

    await expect(
      provider.complete({ userType: 'mentor', identifier: 'nobody@example.com', password: 'secret' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});
