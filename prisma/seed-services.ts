/**
 * Cleans out the invented service catalogue and re-seeds the clinic's real one.
 *
 * The app shipped with a hand-written list of 62 textbook procedures
 * ("Specialty consult (neurology)", "Physical therapy/hydrotherapy") that this
 * clinic does not offer. Not one of them was ever put on an invoice. The real
 * list is seed-data/services.json, carried from the old Access system and
 * pointed at by thousands of historical invoice lines.
 *
 *   pnpm seed:services              prune the invented ones, restore the real ones
 *   pnpm seed:services -- --check   report what would change, write nothing
 *   pnpm seed:services -- --no-prune  restore only, delete nothing
 *
 * Against production, pull its env and point the script at it:
 *
 *   vercel env pull .env.production
 *   npx tsx --env-file=.env.production prisma/seed-services.ts -- --check
 *
 * Safe to run repeatedly, and safe to run on a database that has already been
 * cleaned: pruning is scoped by name and skips anything ever billed, and the
 * restore is an upsert keyed on legacyId.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolve } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { assertClinicDatabase } from "../src/lib/clinic-guard";

type SeedService = {
  legacyId: number;
  name: string;
  category: string | null;
  price: number;
  isActive: boolean;
  description: string | null;
  needsReview: boolean;
  reviewNote: string | null;
};

type GenericService = { name: string };

const DATA_DIR = join(import.meta.dirname, "seed-data");

function load<T>(file: string): T[] {
  return JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")) as T[];
}

// A capitalised duplicate of the legacy "visit" (legacyId 534). The legacy row
// carries the real billing history; this one has never been used. Not part of
// the old seed's list, so it is named here rather than silently swept up by a
// broader rule.
const EXTRA_PRUNABLE = ["Visit"];

// Prune candidates are matched BY NAME, never by "has no legacyId".
//
// Every service a staff member creates in the app also has no legacyId, so the
// broader rule would quietly delete something the clinic added last week and
// has not billed yet. On a live database that is real data. Naming the rows
// keeps the blast radius to exactly the catalogue this app shipped with.
function prunableNames(): string[] {
  return [
    ...load<GenericService>("services-generic.json").map((s) => s.name),
    ...EXTRA_PRUNABLE,
  ];
}

type ServiceClient = Pick<PrismaClient, "service" | "$executeRaw">;

/**
 * Bootstrap: put the real services on a database that is missing them.
 *
 * Additive only. It never deletes and never overwrites, so a fresh database
 * comes up with a working catalogue while a live one keeps every price the
 * clinic has corrected since. `pnpm seed:services` is the destructive half.
 */
export async function seedServices(client: ServiceClient): Promise<number> {
  const services = load<SeedService>("services.json");
  const { count } = await client.service.createMany({
    // Keyed on legacyId, which the old system guarantees unique, so re-running
    // cannot duplicate a service the way matching on name could.
    data: services.map((s) => ({
      legacyId: s.legacyId,
      name: s.name,
      category: s.category,
      price: s.price.toFixed(2),
      isActive: s.isActive,
      description: s.description,
      needsReview: s.needsReview,
      reviewNote: s.reviewNote,
    })),
    skipDuplicates: true,
  });
  return count;
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  // The catalogue below is Mimo's: refuses any other clinic's database.
  await assertClinicDatabase(prisma, { expected: "mimo" });
  const checkOnly = process.argv.includes("--check");
  const noPrune = process.argv.includes("--no-prune");
  const services = load<SeedService>("services.json");
  const names = prunableNames();

  // What is actually there, so the report describes this database rather than
  // assuming it looks like the one this was written against.
  const candidates = await prisma.service.findMany({
    where: { legacyId: null, name: { in: names } },
    select: {
      serviceId: true,
      name: true,
      category: true,
      _count: { select: { lineItems: true } },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  const removable = candidates.filter((s) => s._count.lineItems === 0);
  const billed = candidates.filter((s) => s._count.lineItems > 0);

  const [before, beforeLegacy] = await Promise.all([
    prisma.service.count(),
    prisma.service.count({ where: { legacyId: { not: null } } }),
  ]);

  console.log(
    `${before} services now (${beforeLegacy} from the old system).\n` +
      `  ${services.length} real services to restore\n` +
      `  ${removable.length} invented services to remove` +
      (billed.length
        ? `\n  ${billed.length} KEPT despite being on the list: they have been billed`
        : "") +
      (checkOnly ? "\n  (check only, nothing will be written)" : ""),
  );

  for (const s of billed) {
    console.log(
      `    keep  ${s.name} (${s._count.lineItems} invoice line${
        s._count.lineItems === 1 ? "" : "s"
      })`,
    );
  }

  if (checkOnly) {
    await prisma.$disconnect();
    return;
  }

  // Restore first, prune second. If anything fails, the failure leaves the real
  // catalogue in place rather than a database with the old list deleted and the
  // new one not yet written.
  //
  // Only the columns the export owns are written. partner_id, the two rate
  // overrides and the cost recipe are the clinic's own configuration and are
  // deliberately absent from the UPDATE, so re-seeding never unpicks a
  // partner deal or a service's costing.
  const values = services.map(
    (s) => Prisma.sql`(
      ${s.legacyId}::int, ${s.name}::varchar, ${s.category}::varchar,
      ${s.price.toFixed(2)}::numeric, ${s.isActive}::boolean,
      ${s.description}::text, ${s.needsReview}::boolean,
      ${s.reviewNote}::text)`,
  );
  await prisma.$executeRaw`
    INSERT INTO services (
      legacy_id, name, category, price, is_active, description,
      needs_review, review_note)
    VALUES ${Prisma.join(values)}
    ON CONFLICT (legacy_id) DO UPDATE SET
      name         = EXCLUDED.name,
      category     = EXCLUDED.category,
      price        = EXCLUDED.price,
      is_active    = EXCLUDED.is_active,
      description  = EXCLUDED.description,
      needs_review = EXCLUDED.needs_review,
      review_note  = EXCLUDED.review_note`;
  console.log(`  restored ${services.length} services from the old system`);

  if (noPrune) {
    console.log("  --no-prune: left the invented catalogue in place");
  } else if (removable.length > 0) {
    // Re-checked in the delete rather than trusting the ids read above, so a
    // line billed against one of these between the read and now still protects
    // it. invoice_line_items.service_id is ON DELETE SET NULL, and a line with
    // neither a service nor an item violates invoice_line_items_check, so this
    // guard is what keeps the delete from failing on a live database.
    const { count } = await prisma.service.deleteMany({
      where: {
        serviceId: { in: removable.map((s) => s.serviceId) },
        legacyId: null,
        lineItems: { none: {} },
      },
    });
    console.log(`  removed ${count} invented services`);
  } else {
    console.log("  no invented services to remove");
  }

  const [after, afterLegacy] = await Promise.all([
    prisma.service.count(),
    prisma.service.count({ where: { legacyId: { not: null } } }),
  ]);
  console.log(`${after} services now (${afterLegacy} from the old system).`);

  await prisma.$disconnect();
}

// Guarded so importing this module for seedServices() does not run the CLI.
if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
