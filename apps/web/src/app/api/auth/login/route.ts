import { NextRequest, NextResponse } from 'next/server';
import { createSession, type SessionIdentity } from '@/lib/auth/session';
import { findOrCreatePrincipal } from '@/lib/auth/principal';
import { PasswordProvider, InvalidCredentialsError } from '@/lib/auth/providers/password';

const passwordProvider = new PasswordProvider();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userType, identifier, password, rememberMe } = body as {
      userType: 'socio' | 'mentor';
      identifier: string;
      password: string;
      rememberMe?: boolean;
    };

    if (!userType || !identifier || !password) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      );
    }

    let result;
    try {
      result = await passwordProvider.complete({ userType, identifier, password });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        // Same non-disclosure the inline lookup always had: never reveal
        // whether the account exists or the password was wrong.
        const message = userType === 'socio' ? 'Invalid phone number or password' : 'Invalid email or password';
        return NextResponse.json({ error: message }, { status: 401 });
      }
      throw error;
    }

    const principal = await findOrCreatePrincipal({
      provider: result.provider,
      subject: result.subject,
      role: result.attributes.role,
      socioId: result.attributes.socioId,
      mentorId: result.attributes.mentorId,
    });

    const session: SessionIdentity = {
      userId: result.subject,
      role: result.attributes.role,
      name: result.attributes.name,
      principalId: principal.id,
    };

    await createSession(session, rememberMe ?? false);

    return NextResponse.json({
      success: true,
      role: session.role,
      name: session.name,
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
