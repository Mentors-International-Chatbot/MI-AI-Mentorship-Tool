import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { randomUUID } from 'crypto';
import { sendPasswordResetEmail } from '@/lib/email/service';

export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string };

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Always return success to prevent email enumeration
    const mentor = await prisma.mentor.findUnique({
      where: { email: normalizedEmail },
    });

    if (mentor) {
      // Invalidate any existing unused tokens for this email
      await prisma.passwordResetToken.updateMany({
        where: { email: normalizedEmail, usedAt: null },
        data: { expiresAt: new Date() },
      });

      const token = randomUUID();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.passwordResetToken.create({
        data: {
          email: normalizedEmail,
          token,
          expiresAt,
        },
      });

      try {
        await sendPasswordResetEmail(normalizedEmail, token);
      } catch (emailErr) {
        console.error('[ForgotPassword] Failed to send email:', emailErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'If an account with that email exists, a reset link has been sent.',
    });
  } catch (error) {
    console.error('[ForgotPassword] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
