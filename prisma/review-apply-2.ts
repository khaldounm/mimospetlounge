/**
 * Round two of the review worklist.
 *
 * `review-apply.ts` handled the 607 rows the clinic answered unambiguously.
 * The remaining 74 went back out as `open-questions.csv` and came back as
 * `review-answers-2.csv`. This turns those answers into SQL the same way:
 * read a file, write a file, never touch a database.
 *
 *   pnpm review:apply2    -> prisma/seed-data/review-apply-2.sql
 *
 * Run it only AFTER review-apply.sql has landed. It assumes round one's
 * deletes and merges are already in place.
 *
 * The clinic answered in TWO columns this time. "your earlier answer" (col 6)
 * was overwritten with a clarified answer rather than left as the record of
 * what they said before, and on 57 of 74 rows it carries MORE than the
 * "new decision" column: "0 stock delete item" against a bare "delete",
 * "0 stock, keep the item" against "set the sale price to 0". Reading only
 * the new column would lose the instruction, so both are read and col 6 wins
 * where they disagree.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SEED = join(process.cwd(), "prisma", "seed-data");
const IN = join(SEED, "review-answers-2.csv");
const OUT = join(SEED, "review-apply-2.sql");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const title = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const sql: string[] = [];
const tally = new Map<string, number>();
const count = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
const still: string[] = [];

function section(t: string) {
  sql.push("", `-- ${"=".repeat(72)}`, `-- ${t}`, `-- ${"=".repeat(72)}`);
}

/**
 * Take an item to zero stock and retire it.
 *
 * The ledger foots to current_stock on every one of the 3,409 live items, so
 * setting the column alone would break that identity for the items it touches
 * and drop their value out of the valuation with nothing recording where it
 * went. An "Adjusted" movement is the app's own name for a count correction,
 * which is exactly what a write-off to zero is.
 */
function writeOffAndDelete(legacyId: string, name: string) {
  sql.push(
    "",
    `-- ${name}`,
    `INSERT INTO inventory_transactions (item_id, type, quantity, unit_cost, reference_type, notes, performed_at)`,
    `  SELECT item_id, 'Adjusted', -current_stock, last_cost, 'review',`,
    `         'Written off to zero before retiring the item: clinic review ' || now()::date, now()`,
    `  FROM inventory_items WHERE legacy_id = ${legacyId} AND deleted_at IS NULL AND current_stock <> 0;`,
    `UPDATE inventory_items SET current_stock = 0, deleted_at = now(), needs_review = FALSE`,
    `  WHERE legacy_id = ${legacyId} AND deleted_at IS NULL;`,
  );
}

const rows = parseCsv(readFileSync(IN, "utf8")).slice(1);

section("Stock written off to zero, then retired");
for (const r of rows) {
  const [, record, legacyId, name, , earlier, why, , decision] = r;
  const a = `${earlier} ${decision}`.toLowerCase();

  if (why === "Delete would write off stock silently") {
    // "0 stock delete item"
    writeOffAndDelete(legacyId, name);
    count("write off and retire");
    continue;
  }

  if (why === "'0' on a barcode row is ambiguous") {
    // "delete item"
    sql.push(
      `UPDATE inventory_items SET deleted_at = now(), needs_review = FALSE WHERE legacy_id = ${legacyId} AND deleted_at IS NULL;`,
    );
    count("retire item");
    continue;
  }

  if (why === "'0' on a price row is ambiguous") {
    // "0 stock, keep the item" + "set the sale price to 0": the item stays on
    // the books at zero of everything, so the stock still needs a movement.
    sql.push(
      "",
      `-- ${name}: kept, zeroed`,
      `INSERT INTO inventory_transactions (item_id, type, quantity, unit_cost, reference_type, notes, performed_at)`,
      `  SELECT item_id, 'Adjusted', -current_stock, last_cost, 'review',`,
      `         'Count corrected to zero: clinic review ' || now()::date, now()`,
      `  FROM inventory_items WHERE legacy_id = ${legacyId} AND deleted_at IS NULL AND current_stock <> 0;`,
      `UPDATE inventory_items SET current_stock = 0, sale_price = 0, needs_review = FALSE, review_note = NULL`,
      `  WHERE legacy_id = ${legacyId} AND deleted_at IS NULL;`,
    );
    count("zero stock and price, keep");
    continue;
  }

  if (why === "Answer 'tests' is not an instruction") {
    // Every one of these nine already exists as a Service carrying the same
    // legacy id and the same name. So this is not a conversion: the service is
    // filed under a Tests category and the duplicate stock row is retired.
    sql.push(
      "",
      `-- ${name}`,
      `UPDATE services SET category = 'Tests', needs_review = FALSE, review_note = NULL WHERE legacy_id = ${legacyId};`,
      `UPDATE inventory_items SET deleted_at = now(), needs_review = FALSE WHERE legacy_id = ${legacyId} AND deleted_at IS NULL;`,
    );
    count("service to Tests, retire the stock twin");
    continue;
  }

  if (why === "Client balance, real money") {
    // Every one of these confirms the balance the account already carries, so
    // there is nothing to write. The flag comes off because it has been seen.
    sql.push(
      `UPDATE clients SET needs_review = FALSE, review_note = NULL WHERE legacy_id = ${legacyId};`,
    );
    count("balance confirmed, no money moved");
    continue;
  }

  if (why === "'separate' needs an allocation") {
    // Reversed on the second pass: "same person and pet, keep <name>".
    sql.push(
      `UPDATE clients SET needs_review = FALSE, review_note = NULL WHERE legacy_id = ${legacyId};`,
    );
    count("one client after all, flag cleared");
    continue;
  }

  if (
    why === "Answer names the other person, not this record" ||
    why === "Answer puts two names back into one field" ||
    why === "Uncategorised answer"
  ) {
    // The clinic gave a clean single name on this pass. Take the part before
    // any comma, which is where they put the qualifier ("rima malaeb,same person").
    const nm = title(earlier.split(",")[0].trim());
    const parts = nm.split(" ");
    sql.push(
      `UPDATE clients SET first_name = ${q(parts[0] ?? "")}, last_name = ${q(parts.slice(1).join(" "))},`,
      `  needs_review = FALSE, review_note = NULL WHERE legacy_id = ${legacyId};`,
    );
    count("rename client");
    continue;
  }

  if (why === "Unclear price answer") {
    // "no price": leave it priced as it is, the flag has served its purpose.
    sql.push(
      `UPDATE inventory_items SET needs_review = FALSE, review_note = NULL WHERE legacy_id = ${legacyId} AND deleted_at IS NULL;`,
    );
    count("left as priced, flag cleared");
    continue;
  }

  if (why === "No answer given") {
    // The old system held between 2 and 16 rival codes for each of these and
    // the clinic would not pick one, so the item is found by name instead.
    // The single imported code is removed rather than left standing: one of
    // sixteen is not a barcode, it is a coin toss that scans.
    //
    // The flag STAYS ON, deliberately. This is not an unfinished job, it is a
    // settled state the counter has to know about, and the badge renders as
    // "No barcode" rather than "Check" for exactly these rows.
    sql.push(
      `UPDATE inventory_items SET barcode = NULL, needs_review = TRUE,`,
      `  review_note = 'No barcode: the old system held several and none was chosen. Find this item by name.'`,
      `  WHERE legacy_id = ${legacyId} AND deleted_at IS NULL;`,
    );
    count("barcode removed, found by name");
    continue;
  }

  still.push(`${record} #${legacyId} ${name}: ${why}`);
}

writeFileSync(
  OUT,
  [
    "-- Generated by prisma/review-apply-2.ts. Do not edit by hand.",
    `-- Source: ${IN}`,
    "-- Run AFTER review-apply.sql.",
    "",
    "BEGIN;",
    ...sql,
    "",
    "COMMIT;",
    "",
  ].join("\n"),
);

console.log(`\nread ${rows.length} answered rows\n`);
console.log("WILL APPLY");
for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(v).padStart(4)}  ${k}`);
if (still.length) {
  console.log(`\nSTILL OPEN (${still.length})`);
  for (const s of still) console.log(`   ${s}`);
} else console.log("\nSTILL OPEN: none");
console.log(`\nwrote ${OUT}\n`);
