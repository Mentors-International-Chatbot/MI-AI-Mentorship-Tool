import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, type SessionIdentity } from '@/lib/auth/session';

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

    let session: SessionIdentity | null = null;

    if (userType === 'socio') {
      const socio = await prisma.socio.findFirst({
        where: { whatsappPhoneNumber: identifier },
      });

      if (!socio || !socio.passwordHash) {
        return NextResponse.json(
          { error: 'Invalid phone number or password' },
          { status: 401 },
        );
      }

      const valid = await verifyPassword(password, socio.passwordHash);
      if (!valid) {
        return NextResponse.json(
          { error: 'Invalid phone number or password' },
          { status: 401 },
        );
      }

      session = {
        userId: socio.id,
        role: 'socio',
        name: socio.name || 'Socio',
      };
    } else {
      const mentor = await prisma.mentor.findUnique({
        where: { email: identifier.toLowerCase() },
      });

      if (!mentor || !mentor.passwordHash) {
        return NextResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 },
        );
      }

      const valid = await verifyPassword(password, mentor.passwordHash);
      if (!valid) {
        return NextResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 },
        );
      }

      session = {
        userId: mentor.id,
        role: mentor.role === 'admin' ? 'admin' : 'mentor',
        name: mentor.name,
      };
    }

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
