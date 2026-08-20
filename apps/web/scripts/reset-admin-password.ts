#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * Reset a mentor/admin account's password.
 * ----------------------------------------------------------------------------
 *   node --env-file=.env ./node_modules/.bin/tsx scripts/reset-admin-password.ts <email> <new-password>
 *
 * A script rather than an endpoint on purpose: this bypasses the normal
 * `forgot-password` email flow entirely, and a file under scripts/ is not a
 * route, is not in the deployed bundle, and cannot be reached over HTTP.
 * There is no surface to guard, so there is no env flag to mis-set.
 *
 * Both arguments are required, with no defaults — a reset that guesses which
 * account or picks a placeholder password is one tab-complete away from
 * resetting the wrong account, or resetting it to something guessable.
 *
 * Admin accounts live in the `Mentor` table (`role: "admin"`); this works for
 * any mentor row, admin or not, since the lookup and hashing are identical —
 * the filename just names the common case.
 */

import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";

async function main() {
  const email = process.argv[2];
  const newPassword = process.argv[3];

  if (!email || !newPassword) {
    console.error("Usage: reset-admin-password.ts <email> <new-password>");
    console.error("  Both arguments are required. There is no default account or password.");
    process.exit(1);
  }

  if (newPassword.length < 6) {
    console.error("Refusing: password must be at least 6 characters (same floor as signup).");
    process.exit(1);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const mentor = await prisma.mentor.findUnique({ where: { email: normalizedEmail } });
  if (!mentor) {
    console.error(`No mentor/admin account found with email "${normalizedEmail}".`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.mentor.update({ where: { id: mentor.id }, data: { passwordHash } });

  console.log(`Password reset for ${mentor.name} <${mentor.email}> (role: ${mentor.role}).`);
  console.log("Log in with the new password at /login.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
