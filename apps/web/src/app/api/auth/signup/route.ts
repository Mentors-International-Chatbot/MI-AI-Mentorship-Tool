import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { createSession, type SessionIdentity } from '@/lib/auth/session';
import { findOrCreatePrincipal } from '@/lib/auth/principal';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userType, identifier, password, name, rememberMe } = body as {
      userType: 'socio' | 'mentor';
      identifier: string;
      password: string;
      name: string;
      rememberMe?: boolean;
    };

    if (!userType || !identifier || !password || !name) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 },
      );
    }

    const hashed = await hashPassword(password);
    let session: SessionIdentity;

    if (userType === 'socio') {
      const existing = await prisma.socio.findFirst({
        where: { whatsappPhoneNumber: identifier },
      });

      if (existing?.passwordHash) {
        return NextResponse.json(
          { error: 'An account with this phone number already exists' },
          { status: 409 },
        );
      }

      if (existing) {
        // Socio exists from WhatsApp onboarding but has no password yet — link the account
        await prisma.socio.update({
          where: { id: existing.id },
          data: { passwordHash: hashed, name: existing.name || name },
        });

        session = {
          userId: existing.id,
          role: 'socio',
          name: existing.name || name,
        };
      } else {
        const socio = await prisma.$transaction(async (tx) => {
          const created = await tx.socio.create({
            data: {
              whatsappPhoneNumber: identifier,
              channelType: 'web',
              externalId: identifier,
              name,
              passwordHash: hashed,
              status: 'ACTIVE',
            },
          });
          return tx.socio.update({
            where: { id: created.id },
            data: { externalId: created.id },
          });
        });

        session = {
          userId: socio.id,
          role: 'socio',
          name,
        };
      }
    } else {
      const existing = await prisma.mentor.findUnique({
        where: { email: identifier.toLowerCase() },
      });

      if (existing) {
        return NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 409 },
        );
      }

      const mentor = await prisma.mentor.create({
        data: {
          name,
          email: identifier.toLowerCase(),
          passwordHash: hashed,
          role: 'mentor',
        },
      });

      session = {
        userId: mentor.id,
        role: 'mentor',
        name,
      };
    }

    // Signup never re-verifies a password (there's nothing to verify against
    // yet), so it calls findOrCreatePrincipal directly rather than going
    // through PasswordProvider — same "password" provider convention
    // (subject = the account's own id) as a subsequent login for this same
    // account will resolve to.
    const principal = await findOrCreatePrincipal({
      provider: 'password',
      subject: session.userId,
      role: session.role,
      socioId: session.role === 'socio' ? session.userId : undefined,
      mentorId: session.role !== 'socio' ? session.userId : undefined,
    });
    session.principalId = principal.id;

    // Fresh signups default to remembered: the user just proved intent, and this
    // is exactly the population that re-registers rather than re-logging-in when
    // bounced to the login screen.
    await createSession(session, rememberMe ?? true);

    return NextResponse.json({
      success: true,
      role: session.role,
      name: session.name,
    });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
