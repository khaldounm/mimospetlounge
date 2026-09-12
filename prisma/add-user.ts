import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedRbac } from "./rbac";
import { seedBookingTypes } from "./reference-data";
import { assertClinicDatabase } from "../src/lib/clinic-guard";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Credentials come from env vars so they never get committed. Set them inline
// for a one-off run, e.g.:
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' pnpm tsx prisma/add-user.ts
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set the ${name} env var before running this.`);
  return value;
}

const EMAIL = required("ADMIN_EMAIL");
const PASSWORD = required("ADMIN_PASSWORD");
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
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, roleId: role.roleId, isActive: true },
    create: {
      email: EMAIL,
      passwordHash,
      firstName: FIRST_NAME,
      lastName: LAST_NAME,
      roleId: role.roleId,
    },
  });

  console.log(`User ${user.email} (id ${user.userId}) set as ${ROLE_NAME}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
