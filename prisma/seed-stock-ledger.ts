/**
 * Builds the stock ledger for the imported history.
 *
 * The legacy import brings invoices, invoice lines, purchase orders and
 * purchase order lines across as documents, but writes no stock movements. That
 * leaves COGS reading an empty table: the profitability section derives cost of
 * goods sold from Sold movements and nothing else, so an imported year of
 * trading reports a near-100% margin. This turns those documents into the
 * movements they imply.
 *
 *   pnpm seed:ledger -- --check   report what would be written, write nothing
 *   pnpm seed:ledger              write the movements
 *
 * RUNS LAST, after seed:inventory. Not part of legacy:import, and the ordering
 * is not cosmetic: seed:inventory rewrites current_stock from the curated JSON,
 * and the opening position below is back-solved from current_stock. Built any
 * earlier, every opening would be sized against the loader's own heuristic
 * stock and would stop footing the moment the curated seed landed.
 *
 * Cost is not estimated. The old Access system froze the purchase cost on every
 * sale line in CustInvoiceDetails.InitialPrice, which is exactly what
 * InventoryTransaction.unitCost means here, so each Sold movement carries the
 * cost that sale actually bore rather than the item's cost today.
 *
 * current_stock is never touched. Movements are inserted with raw SQL rather
 * than through applyStockMovement() precisely because that helper increments
 * the item's stock: replaying a year of history through it would strip roughly
 * 12,000 units off a shelf count that is already correct. The opening movement
 * is then sized so the ledger foots to that untouched figure.
 */
import { prisma } from "@/lib/prisma";
import { LEGACY_OPENING_BALANCE_DATE } from "@/constants/legacy-import";
import { assertClinicDatabase } from "@/lib/clinic-guard";

const CHECK = process.argv.includes("--check");
const FORCE = process.argv.includes("--force");

// Named on every row so the figures can be traced back to the exact source
// column once Access is read-only and nobody remembers where they came from.
const SOLD_NOTE =
  "Imported from the Access system. Cost frozen from " +
  "CustInvoiceDetails.InitialPrice, the purchase cost recorded against this " +
  "sale at the time it was made.";
const RECEIVED_NOTE =
  "Imported from the Access system. Cost from the purchase order line.";
const OPENING_NOTE =
  "Stock carried into this system. Back-solved so the ledger foots to the " +
  "counted stock: opening = counted stock - everything received + everything " +
  "sold across the imported period.";

// text -> numeric, for the staging tables, which land every column as text.
const num = (col: string, t: string) =>
  `nullif(btrim(${t}."${col}"),'')::numeric`;

async function one<T = Record<string, unknown>>(sql: string): Promise<T> {
  const rows = await prisma.$queryRawUnsafe<T[]>(sql);
  return rows[0] as T;
}

const n = (v: unknown): number => Number(v ?? 0);
const money = (v: unknown): string =>
  n(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

async function main() {
  // Built from Mimo's export: refuses any other clinic's database.
  await assertClinicDatabase(prisma, { expected: "mimo" });

  // ── Preconditions ────────────────────────────────────────────────────────
  const staging = await one<{ n: bigint }>(
    `SELECT count(*)::bigint AS n FROM information_schema.tables
     WHERE table_schema = 'staging' AND table_name = 'custinvoicedetails'`,
  );
  if (n(staging.n) === 0) {
    throw new Error(
      "staging.custinvoicedetails is missing. Run `pnpm legacy:import` first: " +
        "the frozen sale costs come from the Access export, not from this app.",
    );
  }

  const existing = await one<{ n: bigint }>(
    `SELECT count(*)::bigint AS n FROM inventory_transactions`,
  );
  if (n(existing.n) > 0 && !FORCE && !CHECK) {
    throw new Error(
      `inventory_transactions already holds ${n(existing.n)} rows. The opening ` +
        "position is back-solved from the whole ledger, so running over " +
        "existing movements would fold them into the opening and double-count " +
        "them. Run `pnpm legacy:reset -- --yes` and the full import sequence, " +
        "or pass --force if you know the table holds only a partial run.",
    );
  }

  // ── 1. Sales and customer returns ────────────────────────────────────────
  // One movement per product line. The sign of the invoice line is the whole
  // classification: a sale is a positive line and leaves stock (negative
  // movement), a return is a negative line and puts it back. Negating the line
  // quantity handles both, and the same negation makes the COGS sum in
  // getProfitSection net a return back out without a special case.
  //
  // Service lines are skipped: they have no item and no stock to move.
  //
  // A zero in InitialPrice is the old system never recording a cost, not a free
  // item, so it lands as NULL. Both read as zero cost in the COGS sum, which
  // filters nulls out, but only NULL is findable later as "we never knew this
  // one" rather than asserting the clinic paid nothing for it.
  const soldSelect = `
    SELECT
      l.item_id,
      CASE WHEN l.quantity < 0 THEN 'Returned' ELSE 'Sold' END AS type,
      -l.quantity AS quantity,
      nullif(${num("InitialPrice", "d")}, 0) AS unit_cost,
      l.unit_price AS sale_price,
      'invoice' AS reference_type,
      l.invoice_id AS reference_id,
      COALESCE(v.issued_at, v.created_at) AS performed_at,
      l.line_item_id
    FROM invoice_line_items l
    JOIN invoices v ON v.invoice_id = l.invoice_id
    JOIN staging.custinvoicedetails d
      ON d."CustInvoiceDetailID"::int = l.legacy_id
    WHERE l.item_id IS NOT NULL
      AND l.legacy_id IS NOT NULL
      AND l.quantity <> 0`;

  // ── 2. Deliveries ────────────────────────────────────────────────────────
  // Only what actually arrived. An order line that was never delivered moved no
  // stock, and 99 of them sit at zero received.
  //
  // A line whose cost the old system never recorded still moved stock, so it is
  // received at a null cost rather than dropped. Dropping it would not lose the
  // stock, it would misattribute it: the opening position is back-solved, so a
  // missing delivery silently reappears as stock the item is credited with
  // having started the year holding. The goods really did arrive on an order,
  // and the ledger should say so even where the price did not survive.
  const receivedSelect = `
    SELECT
      pl.item_id,
      'Received' AS type,
      pl.quantity_received AS quantity,
      pl.unit_cost,
      NULL::numeric AS sale_price,
      'purchase_order' AS reference_type,
      po.order_id AS reference_id,
      COALESCE(po.billed_on, po.received_on, po.ordered_on, po.created_at::date)::timestamptz
        AS performed_at,
      pl.line_id
    FROM purchase_order_lines pl
    JOIN purchase_orders po ON po.order_id = pl.order_id
    WHERE pl.quantity_received > 0
      AND po.deleted_at IS NULL`;

  if (CHECK) {
    await report(soldSelect, receivedSelect);
    return;
  }

  // Ordered, because transaction_id order is load-bearing downstream: the
  // return flow pairs a Sold movement to its invoice line positionally, per
  // item, taking them in transaction_id order against the lines in line order
  // (see listReturnable in lib/returns.ts). Inserting unordered would leave
  // that pairing to whatever order Postgres happened to emit rows in, so an
  // invoice holding the same item on two lines could offer the second line's
  // price against the first. Only one imported invoice does that today, but
  // the ordering costs nothing and makes the ledger reproducible rather than
  // incidentally correct.
  const insert = (select: string, note: string, order: string) => `
    INSERT INTO inventory_transactions
      (item_id, type, quantity, unit_cost, sale_price,
       reference_type, reference_id, performed_at, notes)
    SELECT item_id, type, quantity, unit_cost, sale_price,
           reference_type, reference_id, performed_at, ${quote(note)}
    FROM (${select}) s
    ORDER BY ${order}`;

  const soldWritten = await prisma.$executeRawUnsafe(
    insert(soldSelect, SOLD_NOTE, "reference_id, line_item_id"),
  );
  console.log(`  sales and returns   ${soldWritten}`);

  const recvWritten = await prisma.$executeRawUnsafe(
    insert(receivedSelect, RECEIVED_NOTE, "reference_id, line_id"),
  );
  console.log(`  deliveries          ${recvWritten}`);

  // ── 3. Opening position ──────────────────────────────────────────────────
  // Back-solved from the ledger just written rather than recomputed from the
  // source, so it foots by construction: whatever the two passes above did or
  // did not cover, the opening absorbs the difference and current_stock and the
  // ledger agree exactly.
  //
  // Valued at last_cost. It is the only cost available for stock that was on
  // the shelf before the imported window opens, and it never reaches COGS
  // anyway: only Sold and Returned movements do.
  const openWritten = await prisma.$executeRawUnsafe(`
    INSERT INTO inventory_transactions
      (item_id, type, quantity, unit_cost, reference_type, performed_at, notes)
    SELECT i.item_id,
           'Opening',
           i.current_stock - COALESCE(t.qty, 0),
           i.last_cost,
           'legacy-opening',
           TIMESTAMPTZ ${quote(LEGACY_OPENING_BALANCE_DATE)},
           ${quote(OPENING_NOTE)}
    FROM inventory_items i
    LEFT JOIN (
      SELECT item_id, sum(quantity) AS qty FROM inventory_transactions GROUP BY 1
    ) t ON t.item_id = i.item_id
    WHERE i.current_stock - COALESCE(t.qty, 0) <> 0`);
  console.log(`  opening positions   ${openWritten}`);

  // An item whose opening comes out negative was sold more than it was ever
  // bought, which is the old data being incomplete rather than a real position.
  // Flagged rather than zeroed, so a human decides.
  const flagged = await prisma.$executeRawUnsafe(`
    UPDATE inventory_items i SET
      needs_review = true,
      review_note = COALESCE(i.review_note || ' ', '') ||
        'The imported history sells more of this item than it ever purchases, ' ||
        'so it carries a negative opening stock position. The old system''s ' ||
        'purchase records for it are incomplete. Check the shelf and correct ' ||
        'the count.'
    FROM inventory_transactions t
    WHERE t.item_id = i.item_id AND t.type = 'Opening' AND t.quantity < 0`);
  if (flagged > 0) console.log(`  flagged negative    ${flagged}`);

  await verify();
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// ── Reporting ──────────────────────────────────────────────────────────────

async function report(soldSelect: string, receivedSelect: string) {
  console.log("check mode: nothing written\n");

  const sold = await one(`
    SELECT count(*) FILTER (WHERE type = 'Sold') AS sales,
           count(*) FILTER (WHERE type = 'Returned') AS returns,
           round(sum(-quantity * unit_cost) FILTER (WHERE type = 'Sold'), 2) AS cogs,
           round(sum(-quantity * sale_price) FILTER (WHERE type = 'Sold'), 2) AS revenue
    FROM (${soldSelect}) s`);
  console.log(`  sale movements      ${n(sold.sales)}`);
  console.log(`  return movements    ${n(sold.returns)}`);
  console.log(`  cost of those sales $${money(sold.cogs)}`);
  console.log(`  revenue on them     $${money(sold.revenue)}`);

  const skipped = await one(`
    SELECT count(*) AS n FROM invoice_line_items l
    JOIN staging.custinvoicedetails d ON d."CustInvoiceDetailID"::int = l.legacy_id
    WHERE l.item_id IS NOT NULL AND ${num("InitialPrice", "d")} = 0`);
  console.log(`  product lines with no recorded cost: ${n(skipped.n)}`);

  const recv = await one(`
    SELECT count(*) AS lines, round(sum(quantity * unit_cost), 2) AS value
    FROM (${receivedSelect}) r`);
  console.log(`\n  delivery movements  ${n(recv.lines)}`);
  console.log(`  value received      $${money(recv.value)}`);

  const open = await one(`
    WITH moved AS (
      SELECT item_id, sum(quantity) AS qty FROM (
        SELECT item_id, quantity FROM (${soldSelect}) a
        UNION ALL SELECT item_id, quantity FROM (${receivedSelect}) b
      ) u GROUP BY 1
    )
    SELECT count(*) FILTER (WHERE i.current_stock - COALESCE(m.qty,0) <> 0) AS rows,
           count(*) FILTER (WHERE i.current_stock - COALESCE(m.qty,0) > 0) AS positive,
           count(*) FILTER (WHERE i.current_stock - COALESCE(m.qty,0) = 0) AS zero,
           count(*) FILTER (WHERE i.current_stock - COALESCE(m.qty,0) < 0) AS negative,
           round(sum(i.current_stock - COALESCE(m.qty,0)), 2) AS units
    FROM inventory_items i LEFT JOIN moved m ON m.item_id = i.item_id`);
  console.log(`\n  opening rows        ${n(open.rows)}`);
  console.log(
    `  positive ${n(open.positive)}   already square ${n(open.zero)}   negative ${n(open.negative)}`,
  );
  console.log(`  units carried in    ${money(open.units)}`);
  console.log(
    `\n  ${n(open.negative)} items sell more than they buy and will be flagged for review.`,
  );
}

// Proves the two things that must be true afterwards, rather than trusting that
// the inserts did what they were meant to.
async function verify() {
  const foot = await one(`
    SELECT count(*) AS drifted, round(COALESCE(max(abs(d)), 0), 3) AS worst
    FROM (
      SELECT i.current_stock - COALESCE(sum(t.quantity), 0) AS d
      FROM inventory_items i
      LEFT JOIN inventory_transactions t ON t.item_id = i.item_id
      GROUP BY i.item_id, i.current_stock
    ) x WHERE abs(d) > 0.0005`);

  console.log("");
  if (n(foot.drifted) === 0) {
    console.log("  ledger foots to current_stock on every item");
  } else {
    console.log(
      `  WARNING: ${n(foot.drifted)} items do not foot, worst off by ${foot.worst}`,
    );
  }

  const cogs = await one(`
    SELECT round(sum(-quantity * unit_cost), 2) AS cogs
    FROM inventory_transactions
    WHERE type IN ('Sold', 'Returned') AND unit_cost IS NOT NULL
      AND partner_id IS NULL`);
  console.log(`  cost of goods sold now readable: $${money(cogs.cogs)}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
