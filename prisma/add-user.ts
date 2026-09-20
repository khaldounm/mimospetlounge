import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedRbac } from "./rbac";
import { seedBookingTypes } from "./reference-data";
import { assertClinicDatabase } from "../src/lib/clinic-guard";
import {
  enrollmentExpiry,
  enrollmentUrl,
  hashEnrollmentToken,
  newEnrollmentToken,
} from "../src/lib/enrollment";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Creates (or re-roles) a user and prints a one-time enrollment link for them
// to set up a passkey. No password is ever set: this is the same link the
// staff list sends by WhatsApp, minted from a terminal.
//
// It is also the break-glass. If the last admin at a clinic loses every
// device, nobody inside the app can issue a link; this can. Like the in-app
// button, it wipes the person's passkeys and ends their sessions, so run it
// only for the person who asked.
//
//   ADMIN_EMAIL=you@example.com pnpm tsx prisma/add-user.ts
//
// NEXTAUTH_URL must be the clinic's real domain when minting for production,
// because the link is bound to it.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set the ${name} env var before running this.`);
  return value;
}

const EMAIL = required("ADMIN_EMAIL");
const FIRST_NAME = process.env.ADMIN_FIRST_NAME ?? "Admin";
const LAST_NAME = process.env.ADMIN_LAST_NAME ?? "User";
const ROLE_NAME = process.env.ADMIN_ROLE ?? "Admin";

async function main() {
  await assertClinicDatabase(prisma);
  // Ensure roles, permissions and booking types exist so this works on a
  // fresh, unseeded DB.
  await seedRbac(prisma);
  await seedBookingTypes(prisma);

  const role = await prisma.role.findUniqueOrThrow({
    where: { name: ROLE_NAME },
  });

  const token = newEnrollmentToken();
  const now = new Date();
  const expiresAt = enrollmentExpiry(now);
  const enrollment = {
    enrollmentTokenHash: hashEnrollmentToken(token),
    enrollmentExpiresAt: expiresAt,
  };

  const user = await prisma.$transaction(async (tx) => {
    const row = await tx.user.upsert({
      where: { email: EMAIL },
      update: {
        ...enrollment,
        roleId: role.roleId,
        isActive: true,
        sessionsValidFrom: now,
      },
      create: {
        ...enrollment,
        email: EMAIL,
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
        roleId: role.roleId,
      },
    });
    await tx.userPasskey.deleteMany({ where: { userId: row.userId } });
    return row;
  });

  console.log(`User ${user.email} (id ${user.userId}) set as ${ROLE_NAME}.`);
  console.log(
    `Passkeys removed, sessions ended. One-time link, expires ${expiresAt.toISOString()}:`,
  );
  console.log();
  console.log(enrollmentUrl(token));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
