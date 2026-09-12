// Refuses to let a clinic-specific script run against the wrong database.
//
// The environment is not proof of anything: .env holds several connection
// pairs with the inactive ones commented out, the markers move during a
// session, and NEXT_PUBLIC_CLINIC_ID is a separate line that is easy to leave
// behind when the pair is swapped. So the database has to say who it is. A
// single settings row, `clinic.id`, is written once per database and every
// script that seeds, imports or wipes data compares it with what it expects
// before touching a row.
//
// The app itself never reads this row. A production deployment must not go
// down because a bootstrap row is missing; the scripts are where the damage
// is done, so the scripts are what refuse.
import type { PrismaClient } from "@/generated/prisma/client";
import type { ClinicId } from "@/types/clinic";
import { CLINIC } from "@/constants/clinic";
import { SETTING_KEYS } from "@/lib/settings";

interface GuardOptions {
  // The clinic whose data the script carries. Defaults to the clinic this
  // checkout is built for; seeds built from one clinic's export pass that
  // clinic explicitly so they cannot run anywhere else even when the build id
  // agrees.
  expected?: ClinicId;
  // Bootstrap: a database with no row yet is claimed for `expected` instead of
  // refused. Only the fresh-database seed should ask for this.
  claim?: boolean;
}

async function whereAmI(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.$queryRaw<
    { database: string; host: string | null }[]
  >`SELECT current_database() AS database, host(inet_server_addr()) AS host`;
  const row = rows[0];
  return row ? `${row.database} @ ${row.host ?? "local socket"}` : "unknown";
}

export async function assertClinicDatabase(
  prisma: PrismaClient,
  { expected = CLINIC.id, claim = false }: GuardOptions = {},
): Promise<void> {
  const key = SETTING_KEYS.clinicId;
  const row = await prisma.setting.findUnique({ where: { key } });
  const location = await whereAmI(prisma);

  if (row) {
    if (row.value === expected) return;
    throw new Error(
      `Refusing: the database at ${location} says it belongs to "${row.value}", ` +
        `but this script carries "${expected}" data.`,
    );
  }

  if (claim) {
    await prisma.setting.create({
      data: { key, value: expected, updatedBy: null },
    });
    console.log(`claimed ${location} for clinic "${expected}"`);
    return;
  }

  throw new Error(
    `Refusing: the database at ${location} does not say which clinic it ` +
      `belongs to, and this script needs "${expected}". If that is what this ` +
      `database is (prove it: SELECT current_database(), inet_server_addr()), ` +
      `run exactly once:\n` +
      `  INSERT INTO settings (key, value) VALUES ('${key}', '${expected}');`,
  );
}
