/**
 * Turns the clinic's answered review worklist into SQL.
 *
 * `review-export.ts` sends 689 flagged records out as a CSV; this reads the
 * answered file back and writes the statements that act on it. It NEVER
 * touches a database: it reads a CSV and writes a .sql file, so the plan can
 * be read in full before anything is applied.
 *
 *   pnpm review:apply     -> prisma/seed-data/review-apply.sql
 *
 * Then, and only after reading it:
 *
 *   psql -d mimos_pet_lounge -v ON_ERROR_STOP=1 -f prisma/seed-data/review-apply.sql
 *
 * The file is one transaction. It either all lands or none of it does.
 *
 * Rows the clinic answered ambiguously are NOT in here. They go back out as a
 * second worklist; see the OPEN list this prints at the end.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SEED = join(process.cwd(), "prisma", "seed-data");
const IN = join(SEED, "review-answers.csv");
const OUT = join(SEED, "review-apply.sql");

// The clinic's answers came back through Excel, which appended two unnamed
// columns and left the answer in whichever one was convenient at the time:
// `decision` for some issue types, the two spare columns for others. Only one
// row in 681 carries text in more than one, and that row is a barcode plus a
// description rather than two rival answers. So "first non-empty of the three"
// recovers the intended answer without guessing.
const ANSWER_COLS = [7, 8, 9];

type Row = {
  issue: string;
  record: string;
  legacyId: string;
  name: string;
  detail: string;
  answer: string;
};

/** Minimal RFC 4180 reader. The file has quoted commas in almost every row. */
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

/**
 * Answers were typed in lower case. Names are stored as the clinic writes
 * them, so restore a title case that leaves the interior of a word alone:
 * "abu ltayf" -> "Abu Ltayf", but "3amid" and "O'Hara" survive intact.
 */
const title = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * Client names are stored split. Every multi-word surname in this data set
 * ("Wajih Khaddaj", "Abu Ltayf", "Zain Aldeen") sits in last_name, so the
 * first token is the given name and everything after it is the surname.
 */
function splitName(full: string): { first: string; last: string } {
  const parts = title(full).split(" ");
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

const sql: string[] = [];
const open: { row: Row; why: string }[] = [];
const tally = new Map<string, number>();
const count = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);

function section(title: string) {
  sql.push("", `-- ${"=".repeat(72)}`, `-- ${title}`, `-- ${"=".repeat(72)}`);
}

/**
 * Correct an item's count to a figure the clinic gave.
 *
 * The stock ledger foots to current_stock on every live item, so setting the
 * column on its own silently breaks that identity for the rows it touches.
 * A count correction is what "Adjusted" is for, and it is signed, so the
 * movement carries the difference and the column lands on the target.
 */
function setStock(legacyId: string, target: string) {
  sql.push(
    `INSERT INTO inventory_transactions (item_id, type, quantity, unit_cost, reference_type, notes, performed_at)`,
    `  SELECT item_id, 'Adjusted', ${target} - current_stock, last_cost, 'review',`,
    `         'Count corrected to ${target} from the clinic review', now()`,
    `  FROM inventory_items WHERE legacy_id = ${legacyId} AND deleted_at IS NULL AND current_stock <> ${target};`,
    `UPDATE inventory_items SET current_stock = ${target}, needs_review = FALSE, review_note = NULL`,
    `  WHERE legacy_id = ${legacyId} AND deleted_at IS NULL;`,
  );
}

const table = (record: string) =>
  record === "Client"
    ? "clients"
    : record === "Pet"
      ? "patients"
      : record === "Service"
        ? "services"
        : "inventory_items";

/**
 * review-export.ts writes the OWNER's legacy id on a pet row, because a pet's
 * own legacy id is derived (owner * 100 + n) and means nothing to the clinic.
 * So a pet is addressed through its owner and its review flag, never by
 * patients.legacy_id, which would silently match nothing.
 */
function where(record: string, legacyId: string): string {
  if (record === "Pet")
    return `client_id = (SELECT client_id FROM clients WHERE legacy_id = ${legacyId}) AND needs_review`;
  return `legacy_id = ${legacyId}`;
}

// Soft delete everywhere it exists. `services` has no deleted_at and is
// retired with is_active instead; that is the app's own convention, not a
// shortcut taken here.
function softDelete(record: string, legacyId: string) {
  const t = table(record);
  if (t === "services")
    sql.push(
      `UPDATE services SET is_active = FALSE, needs_review = FALSE WHERE ${where(record, legacyId)};`,
    );
  else
    sql.push(
      `UPDATE ${t} SET deleted_at = now(), needs_review = FALSE WHERE ${where(record, legacyId)} AND deleted_at IS NULL;`,
    );
}

const raw = parseCsv(readFileSync(IN, "utf8"));
const rows: Row[] = raw.slice(1).map((r) => ({
  issue: r[1] ?? "",
  record: r[2] ?? "",
  legacyId: r[3] ?? "",
  name: r[4] ?? "",
  detail: r[5] ?? "",
  answer: (
    ANSWER_COLS.map((i) => (r[i] ?? "").trim()).find(Boolean) ?? ""
  ).trim(),
}));

// Items that still show stock. Deleting one drops its value out of the
// valuation with nothing recording the write-off, because getInventorySnapshot
// counts only rows where deleted_at IS NULL. Those are held back for the
// clinic to confirm rather than written off on their behalf.
const STOCKED = new Set(
  (process.env.REVIEW_STOCKED ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Two rows whose answer contradicts the record it sits on.
const ODD: Record<string, string> = {
  "428": "Answer names the other person, not this record",
  "1008": "Answer puts two names back into one field",
};

section("Renames");
for (const r of rows) {
  const a = r.answer;
  const al = a.toLowerCase();
  if (!a) {
    open.push({ row: r, why: "No answer given" });
    continue;
  }
  if (STOCKED.has(r.legacyId) && r.record === "Stock item" && al === "cancel") {
    open.push({ row: r, why: "Delete would write off stock silently" });
    continue;
  }
  if (r.record === "Client" && ODD[r.legacyId]) {
    open.push({ row: r, why: ODD[r.legacyId] });
    continue;
  }

  if (r.issue === "Uncertain surname" || r.issue === "Conflicting name") {
    if (al === "cancel") {
      softDelete("Client", r.legacyId);
      count("delete client");
    } else {
      const { first, last } = splitName(a);
      sql.push(
        `UPDATE clients SET first_name = ${q(first)}, last_name = ${q(last)}, needs_review = FALSE, review_note = NULL WHERE legacy_id = ${r.legacyId};`,
      );
      count("rename client");
    }
    continue;
  }

  if (r.issue === "Pet has no name") {
    if (al === "skip") {
      // Left flagged on purpose: the name comes from the owner at the counter,
      // and clearing the badge would lose the prompt to ask.
      count("pet left for the front desk");
      continue;
    }
    if (al === "cancel") {
      softDelete("Pet", r.legacyId);
      count("delete pet");
      continue;
    }
    // Every answered pet row belongs to an owner with exactly one flagged pet,
    // which is what makes an owner-keyed update safe here. review-export.ts
    // writes the OWNER's legacy id on a pet row, so a client with two unnamed
    // pets would be ambiguous; none of the answered rows is.
    const names = a
      .split("/")
      .map((s) => s.replace(/\(.*?\)/g, "").trim())
      .filter(Boolean);
    if (names.length > 1) {
      sql.push(
        `-- ${r.name}: one record standing for ${names.length} pets`,
        `UPDATE patients SET name = ${q(title(names[0]))}, needs_review = FALSE, review_note = NULL`,
        `  WHERE client_id = (SELECT client_id FROM clients WHERE legacy_id = ${r.legacyId}) AND needs_review;`,
      );
      // Guarded so the whole file stays safe to run twice. Every other
      // statement here is naturally idempotent (a merge zeroes the loser it
      // just drained, a rename clears the flag it matched on); an unguarded
      // INSERT was the one thing that would duplicate a pet on a second run.
      for (const extra of names.slice(1))
        sql.push(
          `INSERT INTO patients (client_id, name, species, breed, created_at, updated_at)`,
          `  SELECT client_id, ${q(title(extra))}, p.species, p.breed, now(), now()`,
          `  FROM patients p JOIN clients c USING (client_id) WHERE c.legacy_id = ${r.legacyId}`,
          `    AND NOT EXISTS (SELECT 1 FROM patients x WHERE x.client_id = p.client_id`,
          `      AND lower(x.name) = lower(${q(title(extra))}) AND x.deleted_at IS NULL)`,
          `  LIMIT 1;`,
        );
      count("split pet into two");
      continue;
    }
    sql.push(
      `UPDATE patients SET name = ${q(title(a))}, needs_review = FALSE, review_note = NULL`,
      `  WHERE client_id = (SELECT client_id FROM clients WHERE legacy_id = ${r.legacyId}) AND needs_review;`,
    );
    count("rename pet");
    continue;
  }

  if (r.issue === "One pet or two?" || r.issue === "Shared phone (FYI)") {
    sql.push(
      `UPDATE ${table(r.record)} SET needs_review = FALSE, review_note = NULL WHERE ${where(r.record, r.legacyId)};`,
    );
    count("confirmed, flag cleared");
    continue;
  }

  if (r.issue === "Missing name" || r.issue === "Unclear name") {
    if (al === "cancel") {
      softDelete(r.record, r.legacyId);
      count(`delete ${r.record.toLowerCase()}`);
    } else if (al === "skip") count("left alone");
    else {
      const { first, last } = splitName(a);
      sql.push(
        r.record === "Client"
          ? `UPDATE clients SET first_name = ${q(first)}, last_name = ${q(last)}, needs_review = FALSE, review_note = NULL WHERE legacy_id = ${r.legacyId};`
          : `UPDATE ${table(r.record)} SET name = ${q(title(a))}, needs_review = FALSE, review_note = NULL WHERE legacy_id = ${r.legacyId};`,
      );
      count("rename");
    }
    continue;
  }

  if (r.issue === "Impossible stock") {
    setStock(r.legacyId, "0");
    count("set stock");
    continue;
  }

  if (r.issue === "No sale price") {
    if (al === "keep it") {
      sql.push(
        `UPDATE inventory_items SET needs_review = FALSE, review_note = NULL WHERE legacy_id = ${r.legacyId};`,
      );
      count("confirmed, flag cleared");
    } else if (al === "cancel") {
      softDelete("Stock item", r.legacyId);
      count("delete stock item");
    } else open.push({ row: r, why: "'0' on a price row is ambiguous" });
    continue;
  }

  if (r.issue === "Service held as stock") {
    if (al === "cancel") {
      softDelete("Stock item", r.legacyId);
      count("delete stock item");
    } else open.push({ row: r, why: "Answer 'tests' is not an instruction" });
    continue;
  }

  if (r.issue === "Possible duplicate") continue; // handled as clusters below

  // ---- the "Other" catch-all, split by what the row actually asked --------
  if (r.detail.includes("also covers")) {
    if (al === "separate")
      open.push({ row: r, why: "'separate' needs an allocation" });
    else {
      sql.push(
        `UPDATE clients SET needs_review = FALSE, review_note = NULL WHERE legacy_id = ${r.legacyId};`,
      );
      count("confirmed, flag cleared");
    }
    continue;
  }
  if (r.detail.includes("balance forward")) {
    open.push({ row: r, why: "Client balance, real money" });
    continue;
  }
  if (
    r.detail.includes("no scannable barcode") ||
    r.detail.includes("barcodes for this item")
  ) {
    if (al === "cancel") {
      softDelete("Stock item", r.legacyId);
      count("delete stock item");
    } else if (al === "keep it") {
      sql.push(
        `UPDATE inventory_items SET needs_review = FALSE, review_note = NULL WHERE legacy_id = ${r.legacyId};`,
      );
      count("confirmed, flag cleared");
    } else if (a === "0") {
      open.push({ row: r, why: "'0' on a barcode row is ambiguous" });
    } else {
      // Both real GTINs and the clinic's own shelf codes ("v2", "cage1") go to
      // inventory_items.barcode, which the scanner matches raw. inventory_barcodes
      // is GTIN-14 only and would mangle a short internal code.
      sql.push(
        `UPDATE inventory_items SET barcode = ${q(a)}, needs_review = FALSE, review_note = NULL WHERE legacy_id = ${r.legacyId};`,
      );
      count("set barcode");
    }
    continue;
  }
  if (r.detail.includes("sells more of this item")) {
    if (/^\d+$/.test(a)) {
      setStock(r.legacyId, a);
      count("set stock");
    } else if (al === "cancel") {
      softDelete("Stock item", r.legacyId);
      count("delete stock item");
    } else
      open.push({ row: r, why: "Non-numeric answer on a stock-count row" });
    continue;
  }
  if (
    r.detail.includes("No price was set") ||
    r.detail.includes("No price recorded")
  ) {
    if (al === "keep it") {
      sql.push(
        `UPDATE ${table(r.record)} SET needs_review = FALSE, review_note = NULL WHERE ${where(r.record, r.legacyId)};`,
      );
      count("confirmed, flag cleared");
    } else if (al === "cancel") {
      softDelete(r.record, r.legacyId);
      count(`delete ${r.record.toLowerCase()}`);
    } else open.push({ row: r, why: "Unclear price answer" });
    continue;
  }
  if (al === "cancel") {
    softDelete(r.record, r.legacyId);
    count(`delete ${r.record.toLowerCase()}`);
  } else if (al === "skip") count("left alone");
  else open.push({ row: r, why: "Uncategorised answer" });
}

// ---- duplicate clusters --------------------------------------------------
// The survivor was resolved by matching the clinic's free-text answer against
// the candidate names; merge-plan.json records which and why, so the choice is
// auditable rather than buried in a similarity score.
section("Duplicate merges");
type Plan = { ids: string[]; survivor: string; why: string };
const plan: Plan[] = JSON.parse(
  readFileSync(join(SEED, "review-merge-plan.json"), "utf8"),
);
for (const p of plan) {
  const losers = p.ids.filter((i) => i !== p.survivor);
  if (!losers.length) continue;
  sql.push(
    "",
    `-- keep #${p.survivor}, merge ${losers.map((l) => `#${l}`).join(", ")}  (${p.why})`,
    `WITH s AS (SELECT client_id FROM clients WHERE legacy_id = ${p.survivor}),`,
    `     l AS (SELECT client_id FROM clients WHERE legacy_id IN (${losers.join(", ")}))`,
    `UPDATE invoices SET client_id = (SELECT client_id FROM s) WHERE client_id IN (SELECT client_id FROM l);`,
    `WITH s AS (SELECT client_id FROM clients WHERE legacy_id = ${p.survivor}),`,
    `     l AS (SELECT client_id FROM clients WHERE legacy_id IN (${losers.join(", ")}))`,
    `UPDATE payments SET client_id = (SELECT client_id FROM s) WHERE client_id IN (SELECT client_id FROM l);`,
    `WITH s AS (SELECT client_id FROM clients WHERE legacy_id = ${p.survivor}),`,
    `     l AS (SELECT client_id FROM clients WHERE legacy_id IN (${losers.join(", ")}))`,
    `UPDATE patients SET client_id = (SELECT client_id FROM s) WHERE client_id IN (SELECT client_id FROM l);`,
    // The loser's balance is money the client still owes or is owed, so it has
    // to land on the survivor rather than disappear with the record.
    `UPDATE clients SET account_balance = account_balance + COALESCE((`,
    `    SELECT sum(account_balance) FROM clients WHERE legacy_id IN (${losers.join(", ")})), 0),`,
    `  needs_review = FALSE, review_note = NULL WHERE legacy_id = ${p.survivor};`,
    `UPDATE clients SET account_balance = 0, deleted_at = now(), needs_review = FALSE,`,
    `  review_note = 'Merged into client with legacy_id ${p.survivor} on ' || now()::date`,
    `  WHERE legacy_id IN (${losers.join(", ")}) AND deleted_at IS NULL;`,
  );
  count("merge cluster");
}

writeFileSync(
  OUT,
  [
    "-- Generated by prisma/review-apply.ts. Do not edit by hand.",
    `-- Source: ${IN}`,
    "-- One transaction: it all lands, or none of it does.",
    "",
    "BEGIN;",
    ...sql,
    "",
    "COMMIT;",
    "",
  ].join("\n"),
);

const applied = [...tally.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\nread ${rows.length} answered rows from ${IN}\n`);
console.log("WILL APPLY");
for (const [k, v] of applied) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`\nHELD BACK (${open.length}) - these go out as worklist two`);
const why = new Map<string, number>();
for (const o of open) why.set(o.why, (why.get(o.why) ?? 0) + 1);
for (const [k, v] of [...why.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`\nwrote ${OUT}`);
console.log("Read it, then:");
console.log(`  psql -d mimos_pet_lounge -v ON_ERROR_STOP=1 -f ${OUT}\n`);
