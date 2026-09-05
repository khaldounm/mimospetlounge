// Wipes the imported data so the migration can be re-run from scratch.
//
//   npx tsx src/lib/legacy-import/reset.ts --yes
//
// PRESERVED: services, users, roles, permissions, role_permissions.
// Everything else is clinic data that comes from the .mdb and is rebuilt by
// the loader, so it is safe to remove and expensive to keep half-migrated.
//
// Deletes in dependency order rather than using CASCADE, so a foreign key that
// is added later fails loudly here instead of silently dropping rows.

import { prisma } from "@/lib/prisma";

// Order matters: children before parents.
const WIPE_ORDER = [
  // The trail of everything the app did to the data this reset is about to
  // throw away: who edited which invoice, who voided what, who signed in. None
  // of it describes the database that comes out the other side, and a trail
  // that outlives its subject is worse than no trail, because it reads as
  // history of the new rows rather than of the old ones.
  "audit_log",
  "reminders",
  "clinical_records",
  "notifications",
  // The partner ledger, all three parts of it, and the partners themselves
  // further down. Every figure in here is frozen against an invoice, a line
  // item or a stock movement that this reset destroys, so they go together or
  // the balance is left wrong in one specific direction each: an accrual left
  // behind claims money owed for an invoice that no longer exists, a payout
  // left behind pays down earnings that no longer exist, and an attended day
  // left behind can be settled a SECOND time, because a day's settlement is not
  // a flag on the day, it is a 'guarantee' accrual (see settlePartnerDay in
  // lib/partner-days).
  "partner_accruals",
  "partner_attendance",
  "partner_payouts",
  "payments",
  // A grant names a client by id, and client ids do not survive the rebuild.
  // The offers behind them are the clinic's own and stay.
  "offer_grants",
  // The whole expense ledger, imported or not. The imported rows obviously go;
  // so do the ones the app raised for itself, because each of those mirrors a
  // hidden invoice line or a register draw from a day that is being rebuilt
  // from scratch, and so do any a staff member typed in, because on this
  // database they were typed in while testing. A running cost that survives a
  // rebuild is an expense with nothing behind it, which is the one shape of
  // wrong that reads as perfectly ordinary on the P&L.
  "running_costs",
  // A day's till count. It counts cash against the invoices and payments of a
  // day this reset is rebuilding from scratch, and the draw it records becomes
  // a running cost above, so it is deleted after those rather than left sitting
  // with the settings it resembles.
  "register_closings",
  "invoice_line_items",
  "invoices",
  "bookings",
  "inventory_batch_movements",
  "inventory_transactions",
  "inventory_batches",
  "inventory_barcodes",
  // A cost recipe names an inventory item by id, and those ids are handed out
  // fresh by the sequences this reset restarts: item 422 is a different product
  // after a rebuild than it was before one. A surviving recipe would therefore
  // still cost its service, just against whatever stock now holds the id, and
  // that is the kind of wrong that foots, reconciles and is never noticed. The
  // foreign key is RESTRICT so it cannot happen quietly, which is what stopped
  // this reset dead rather than letting it through.
  "service_cost_components",
  "purchase_order_lines",
  "purchase_orders",
  "supplier_payments",
  // Client, supplier AND partner opening balances. The first two come from the
  // .mdb (CustomerWholesale.BBack and Suppliers.BBack) and the transform
  // rebuilds them, so they are imported data like everything else here. Their
  // foreign keys are RESTRICT rather than CASCADE, which is what made this
  // omission stop the reset dead instead of quietly leaving last import's
  // balances behind: the loader inserts ON CONFLICT DO NOTHING, so a stale row
  // would have survived every future import untouched. A partner opening
  // balance is app-entered rather than imported and goes with its ledger.
  "opening_balances",
  "inventory_items",
  // Nothing rebuilds these: no table in the .mdb describes a partner, no seed
  // writes one. They are typed into the app, and on this database that means
  // typed in while testing, which is why they are cleared rather than carried
  // into a fresh dataset. The real ones get entered after the cutover, against
  // the data they will actually be paid on.
  "partners",
  "supplier_contacts",
  "suppliers",
  "patients",
  "clients",
] as const;

const PRESERVED = [
  "services",
  "users",
  "roles",
  "permissions",
  "role_permissions",
];

// Services are preserved, but the importer creates some of its own. Those carry
// a legacy_id and must be cleared too, otherwise a re-import leaves the old
// rows behind and stale classifications accumulate run after run.
//
// Note what that costs: every service in this database carries a legacy_id, so
// all of them are deleted here and re-inserted by seed:inventory as new rows.
// The columns that seed does not own go with them, which means a rebuild clears
// partner_id and the two rate overrides on every service, and takes the cost
// recipes hanging off them. Both halves of a partner-performed service, the
// partner and the terms, are entered after the cutover rather than carried
// through it.
const LEGACY_OWNED = ["services"] as const;

export async function reset() {
  const before = await counts();

  // opening_balances carries a BEFORE UPDATE OR DELETE trigger that refuses
  // both outright, because an opening balance is a statement of fact as at a
  // date and correcting one means adding a visible adjustment, never rewriting
  // history. That guard is aimed at the application, which must never quietly
  // restate a figure the clinic has already shown someone. A full reset is the
  // one operation entitled to remove them: it is discarding the whole imported
  // dataset, not editing a balance. So the trigger comes down for exactly the
  // length of that delete and goes straight back up.
  //
  // Both statements are DDL inside the transaction below, so a failure anywhere
  // in the wipe rolls the trigger back up with everything else. It cannot be
  // left disabled by a half-finished run.
  const drop = (t: string) => prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
  const guard = (action: "DISABLE" | "ENABLE") =>
    prisma.$executeRawUnsafe(
      `ALTER TABLE "opening_balances" ${action} TRIGGER "opening_balances_no_update"`,
    );

  // One transaction: either the database is fully cleared or untouched.
  await prisma.$transaction(
    WIPE_ORDER.flatMap((t) =>
      t === "opening_balances"
        ? [guard("DISABLE"), drop(t), guard("ENABLE")]
        : [drop(t)],
    ),
  );
  // Sequences restart so a re-import produces tidy ids rather than continuing
  // from wherever the previous attempt stopped.
  //
  // Columns come from pg_attribute keyed on the table's OID, NOT from
  // information_schema.columns filtered by table_schema. Six of the staging
  // tables share a name with a public one (payments, invoices, suppliers,
  // products among them), and a WHERE clause does not short-circuit: Postgres
  // is free to evaluate pg_get_serial_sequence() on a staging row before the
  // schema filter has excluded it, and that function raises rather than
  // returning NULL for a column the public table does not have. It fails on
  // "PaymentID", the staging spelling, which reads as nonsense until you know
  // the two tables collide. Resolving the OID once removes any chance of a
  // foreign schema's rows reaching the function at all, whatever plan the
  // planner picks.
  for (const t of WIPE_ORDER) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('public."${t}"', a.attname), 1, false)
       FROM pg_attribute a
       WHERE a.attrelid = 'public."${t}"'::regclass
         AND a.attnum > 0 AND NOT a.attisdropped
         AND pg_get_serial_sequence('public."${t}"', a.attname) IS NOT NULL`,
    );
  }

  for (const t of LEGACY_OWNED) {
    const removed = await prisma.$executeRawUnsafe(
      `DELETE FROM "${t}" WHERE "legacy_id" IS NOT NULL`,
    );
    if (removed > 0)
      console.log(`  ${t.padEnd(22)} removed ${removed} imported rows`);
  }

  const after = await counts();
  console.log("cleared:");
  for (const t of WIPE_ORDER) {
    if ((before[t] ?? 0) > 0)
      console.log(`  ${t.padEnd(22)} ${before[t]} -> ${after[t] ?? 0}`);
  }
  console.log("\npreserved:");
  for (const t of PRESERVED) console.log(`  ${t.padEnd(22)} ${after[t] ?? 0}`);
}

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of [...WIPE_ORDER, ...PRESERVED]) {
    const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "${t}"`,
    );
    out[t] = Number(r[0]?.n ?? 0);
  }
  return out;
}

if (process.argv[1]?.includes("reset")) {
  if (!process.argv.includes("--yes")) {
    console.error(
      "This deletes all imported clinic data. Re-run with --yes to confirm.",
    );
    process.exit(1);
  }
  reset().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
