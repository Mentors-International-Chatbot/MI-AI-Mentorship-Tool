import { Resend } from 'resend';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY || '');
  }
  return _resend;
}

export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
): Promise<void> {
  const fromAddress = process.env.EMAIL_FROM || 'onboarding@resend.dev';
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

  await getResend().emails.send({
    from: fromAddress,
    to: email,
    subject: 'Reset your password - Mentors International',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1B2A4A;">Password Reset</h2>
        <p>You requested a password reset for your Mentors International account.</p>
        <p>
          <a href="${resetUrl}"
             style="display: inline-block; padding: 12px 24px; background: #1B2A4A; color: white; text-decoration: none; border-radius: 8px; font-weight: 500;">
            Reset Password
          </a>
        </p>
        <p style="color: #666; font-size: 14px; margin-top: 24px;">
          This link expires in 1 hour. If you didn&rsquo;t request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}
