/**
 * L1.b (Auth & Login Restructure) — password provider.
 *
 * Wraps the lookup + verifyPassword logic that previously lived inline in
 * /api/auth/login (and, before signup grew its own creation path, was
 * duplicated there too). Behavior-preserving: same two lookups, same
 * bcrypt compare, same refusal to distinguish "no such account" from
 * "wrong password" in the failure it raises.
 */
import { prisma } from '@/lib/db';
import { verifyPassword } from '../password';
import type { AuthProvider, ProviderCompletionResult } from './types';

export type PasswordCompleteParams = {
  userType: 'socio' | 'mentor';
  identifier: string;
  password: string;
};

/**
 * Deliberately one error shape for both "no such account" and "wrong
 * password" — same non-disclosure the inline logic already had. The caller
 * chooses its own user-facing message (it still knows `userType`); this
 * provider does not leak which half failed.
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}

export class PasswordProvider implements AuthProvider<PasswordCompleteParams> {
  async complete({ userType, identifier, password }: PasswordCompleteParams): Promise<ProviderCompletionResult> {
    if (userType === 'socio') {
      const socio = await prisma.socio.findFirst({ where: { whatsappPhoneNumber: identifier } });
      if (!socio?.passwordHash || !(await verifyPassword(password, socio.passwordHash))) {
        throw new InvalidCredentialsError();
      }
      return {
        provider: 'password',
        subject: socio.id,
        attributes: { role: 'socio', name: socio.name || 'Socio', socioId: socio.id },
      };
    }

    const mentor = await prisma.mentor.findUnique({ where: { email: identifier.toLowerCase() } });
    if (!mentor?.passwordHash || !(await verifyPassword(password, mentor.passwordHash))) {
      throw new InvalidCredentialsError();
    }
    return {
      provider: 'password',
      subject: mentor.id,
      attributes: {
        role: mentor.role === 'admin' ? 'admin' : 'mentor',
        name: mentor.name,
        mentorId: mentor.id,
      },
    };
  }
}
