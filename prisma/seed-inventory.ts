/**
 * Seeds the curated inventory items and services from the legacy Access system.
 *
 * Like the client seed, the rows in seed-data/ are already resolved: categories
 * taken from the old system's own Category table rather than guessed from
 * product names, pack sizes lifted out of names into `unit`, impossible stock
 * corrected and flagged. seed-data/curate-inventory.py regenerates them from a
 * GT_Data .mdb export and carries the reasoning for each decision.
 *
 *   pnpm seed:inventory            upsert items and services
 *   pnpm seed:inventory -- --check report what would change, write nothing
 *
 * Services the clinic created in this app are left alone: only rows carrying a
 * legacyId are touched.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertClinicDatabase } from "@/lib/clinic-guard";

type SeedItem = {
  legacyId: number;
  name: string;
  category: string | null;
  unit: string | null;
  currentStock: number;
  reorderLevel: number;
  barcode: string | null;
  salePrice: number | null;
  lastCost: number | null;
  notes: string | null;
  needsReview: boolean;
  reviewNote: string | null;
};

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

const DATA_DIR = join(import.meta.dirname, "seed-data");

function load<T>(file: string): T[] {
  return JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")) as T[];
}

const dec = (v: number | null) => (v === null ? null : v.toFixed(2));

async function main() {
  // Built from Mimo's export: refuses any other clinic's database.
  await assertClinicDatabase(prisma, { expected: "mimo" });
  const checkOnly = process.argv.includes("--check");
  const items = load<SeedItem>("inventory.json");
  const services = load<SeedService>("services.json");

  // inventory_items.barcode is UNIQUE. The curated codes do not collide with
  // each other (verified), but a staff member may already have scanned one of
  // them onto a different item in this app, and that scan is worth more than
  // the 2026 export. Drop ours rather than let a whole chunk fail on the
  // constraint, and say which ones so the conflict is visible.
  const wanted = items.map((i) => i.barcode).filter((b): b is string => !!b);
  if (wanted.length) {
    const taken = await prisma.$queryRaw<
      { barcode: string; legacy_id: number | null }[]
    >`
      SELECT barcode, legacy_id FROM inventory_items
      WHERE barcode = ANY(${wanted}::varchar[])`;
    const clash = new Map(taken.map((t) => [t.barcode, t.legacy_id]));
    let dropped = 0;
    for (const it of items) {
      if (!it.barcode) continue;
      const holder = clash.get(it.barcode);
      if (holder !== undefined && holder !== it.legacyId) {
        console.log(
          `  barcode ${it.barcode} is already on item ${holder}, ` +
            `not moving it to ${it.legacyId} (${it.name})`,
        );
        it.barcode = null;
        dropped++;
      }
    }
    if (dropped)
      console.log(`  ${dropped} barcodes left with their current item`);
  }

  console.log(
    `${items.length} inventory items and ${services.length} services to seed` +
      (checkOnly ? " (check only, nothing will be written)" : ""),
  );

  if (checkOnly) {
    const [existingItems, existingServices, clinicServices] = await Promise.all(
      [
        prisma.inventoryItem.count({ where: { legacyId: { not: null } } }),
        prisma.service.count({ where: { legacyId: { not: null } } }),
        prisma.service.count({ where: { legacyId: null } }),
      ],
    );
    console.log(
      `  already imported: ${existingItems} items, ` +
        `${existingServices} services`,
    );
    console.log(`  the clinic's own services (untouched): ${clinicServices}`);
    console.log(
      `  flagged for review: ` +
        `${items.filter((i) => i.needsReview).length} items, ` +
        `${services.filter((s) => s.needsReview).length} services`,
    );
    return;
  }

  // One multi-row INSERT ... ON CONFLICT per chunk, for the same reason as the
  // client seed: per-row upserts cost a round trip each and time out against a
  // remote database on latency alone.
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = items.slice(i, i + CHUNK);
    const values = batch.map(
      (it) => Prisma.sql`(
        ${it.legacyId}::int, ${it.name}::varchar, ${it.category}::varchar,
        ${it.unit}::varchar, ${it.currentStock.toFixed(2)}::numeric,
        ${it.reorderLevel}::int, ${it.barcode}::varchar,
        ${dec(it.salePrice)}::numeric,
        ${dec(it.lastCost)}::numeric, ${it.notes}::text,
        ${it.needsReview}::boolean, ${it.reviewNote}::text, now(), now())`,
    );
    // partner_id, supplier_id and expiry_date are left out on purpose: the old
    // system has no usable value for any of them (SupplierID is 0 on every
    // row), and overwriting a link staff made in this app would lose it.
    await prisma.$executeRaw`
      INSERT INTO inventory_items (
        legacy_id, name, category, unit, current_stock, reorder_level,
        barcode, sale_price, last_cost, notes, needs_review, review_note,
        created_at, updated_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (legacy_id) DO UPDATE SET
        name          = EXCLUDED.name,
        category      = EXCLUDED.category,
        unit          = EXCLUDED.unit,
        current_stock = EXCLUDED.current_stock,
        barcode       = COALESCE(inventory_items.barcode, EXCLUDED.barcode),
        sale_price    = EXCLUDED.sale_price,
        last_cost     = EXCLUDED.last_cost,
        notes         = EXCLUDED.notes,
        needs_review  = EXCLUDED.needs_review,
        review_note   = EXCLUDED.review_note,
        updated_at    = now()`;
    written += batch.length;
    process.stdout.write(`\r  items ${written}/${items.length}`);
  }
  console.log("");

  const svcValues = services.map(
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
    VALUES ${Prisma.join(svcValues)}
    ON CONFLICT (legacy_id) DO UPDATE SET
      name         = EXCLUDED.name,
      category     = EXCLUDED.category,
      price        = EXCLUDED.price,
      is_active    = EXCLUDED.is_active,
      description  = EXCLUDED.description,
      needs_review = EXCLUDED.needs_review,
      review_note  = EXCLUDED.review_note`;
  console.log(`  services ${services.length}/${services.length}`);

  // Reconcile. An earlier import stocked things that are not stock: "hair cut"
  // and "castration" were created as inventory items, and invoices were billed
  // against them. Those rows are now services, so the invoice lines are moved
  // onto the service before the redundant item is removed -- deleting first
  // would set item_id to null and lose the link to what was actually sold.
  const seededItemIds = new Set(items.map((i) => i.legacyId));
  const strayItems = await prisma.inventoryItem.findMany({
    where: { legacyId: { not: null }, deletedAt: null },
    select: {
      itemId: true,
      legacyId: true,
      _count: {
        select: { lineItems: true, transactions: true, orderLines: true },
      },
    },
  });
  const strays = strayItems.filter(
    (it) => !seededItemIds.has(it.legacyId as number),
  );

  const serviceByLegacy = new Map(
    (
      await prisma.service.findMany({
        where: { legacyId: { in: strays.map((s) => s.legacyId as number) } },
        select: { serviceId: true, legacyId: true },
      })
    ).map((s) => [s.legacyId as number, s.serviceId]),
  );

  let relinked = 0;
  const removable: number[] = [];
  const keepFlagged: number[] = [];

  let orphanRisk = 0;
  for (const it of strays) {
    const serviceId = serviceByLegacy.get(it.legacyId as number);

    // A line must reference either a service or an item; the table has a check
    // constraint saying so. Deleting an item whose lines have nowhere else to
    // point would set item_id to null and violate it, so those rows stay.
    if (it._count.lineItems > 0 && serviceId === undefined) {
      orphanRisk += 1;
      keepFlagged.push(it.itemId);
      continue;
    }

    if (serviceId !== undefined && it._count.lineItems > 0) {
      const moved = await prisma.invoiceLineItem.updateMany({
        where: { itemId: it.itemId },
        data: { itemId: null, serviceId },
      });
      relinked += moved.count;
    }

    // A purchase order or a stock movement cannot be moved onto a service --
    // a service has no stock to receive -- so those rows stay put and the item
    // is kept for a human to resolve.
    const pinned = it._count.transactions + it._count.orderLines > 0;
    (pinned ? keepFlagged : removable).push(it.itemId);
  }
  if (orphanRisk > 0) {
    console.log(
      `  kept ${orphanRisk} items that invoices reference and nothing replaces`,
    );
  }

  if (relinked > 0) {
    console.log(
      `  moved ${relinked} invoice lines onto the service they actually sold`,
    );
  }
  if (removable.length > 0) {
    await prisma.inventoryItem.deleteMany({
      where: { itemId: { in: removable } },
    });
    console.log(
      `  removed ${removable.length} items that are services, not stock`,
    );
  }
  if (keepFlagged.length > 0) {
    await prisma.inventoryItem.updateMany({
      where: { itemId: { in: keepFlagged } },
      data: {
        needsReview: true,
        // These carry a raw "Category 6" label from an older import, which
        // would otherwise appear as its own tab on the inventory page, and a
        // raw "3" in unit -- the UnitOfMeas foreign key from Access, which the
        // stock column would render as "0 3".
        category: "Other",
        unit: null,
        reviewNote:
          "The corrected product list treats this as a service rather than " +
          "stock, but it still has a purchase order or a stock movement " +
          "against it. Resolve those before removing the item.",
      },
    });
    console.log(
      `  flagged ${keepFlagged.length} items with purchase or stock history`,
    );
  }

  // Vaccines are deliberately in both tables: they are billed as a service and
  // also stocked and reordered. Reported rather than flagged -- it is the
  // intended arrangement, not something for a human to fix.
  const dualRole = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count
    FROM inventory_items i
    JOIN services s ON s.legacy_id = i.legacy_id
    WHERE i.legacy_id IS NOT NULL AND i.deleted_at IS NULL
      AND i.needs_review = FALSE`;
  const dual = Number(dualRole[0]?.count ?? 0);
  if (dual > 0) {
    console.log(
      `  ${dual} products are both a billable service and a stocked item ` +
        `(vaccines); this is intended`,
    );
  }

  const [flaggedItems, flaggedServices] = await Promise.all([
    prisma.inventoryItem.count({ where: { needsReview: true } }),
    prisma.service.count({ where: { needsReview: true } }),
  ]);
  console.log(
    `Done. ${flaggedItems} items and ${flaggedServices} services are flagged ` +
      `for review.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
