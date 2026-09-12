import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedRbac } from "./rbac";
import { seedBookingTypes } from "./reference-data";
import { seedServices } from "./seed-services";
import { assertClinicDatabase } from "../src/lib/clinic-guard";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // A fresh database is claimed for this clinic; a populated one must agree.
  await assertClinicDatabase(prisma, { claim: true });
  await seedRbac(prisma);

  // Admin user
  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { name: "Admin" },
  });
  const passwordHash = await bcrypt.hash("test123", 10);
  await prisma.user.upsert({
    where: { email: "masrikhaldoun@gmail.com" },
    update: { roleId: adminRole.roleId },
    create: {
      email: "masrikhaldoun@gmail.com",
      passwordHash,
      firstName: "Clinic",
      lastName: "Admin",
      roleId: adminRole.roleId,
    },
  });

  await seedBookingTypes(prisma);

  // The clinic's real service list, from the old Access system. Bootstrap only:
  // it fills a fresh database and never deletes, so a service somebody added in
  // the app survives a re-seed. `pnpm seed:services` is the one that prunes the
  // old invented catalogue and restores prices from the export.
  await seedServices(prisma);

  console.log("Seed complete:");
  console.log(`  roles: ${await prisma.role.count()}`);
  console.log(`  permissions: ${await prisma.permission.count()}`);
  console.log(`  users: ${await prisma.user.count()}`);
  console.log(`  booking types: ${await prisma.bookingType.count()}`);
  console.log(`  services: ${await prisma.service.count()}`);
  console.log("  admin login: admin@vetclinic.local / admin123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
