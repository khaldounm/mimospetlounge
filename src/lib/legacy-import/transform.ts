// Step 3: turn the staging tables into app rows.
//
// Idempotent by construction: every insert targets legacy_id and upserts, so
// running this again at cutover against a fresher backup is a delta, not a
// duplicate. Rows whose meaning had to be guessed carry needs_review + a
// review_note explaining what a human should check.

import { prisma } from "@/lib/prisma";
import {
  LEGACY_BALANCE_EPSILON,
  LEGACY_CATEGORY_NAMES,
  LEGACY_DISCOUNT_SERVICE_ID,
  LEGACY_EXPENSE_AMOUNT_NOTE,
  LEGACY_EXPENSE_CATEGORY,
  LEGACY_OPENING_BALANCE_DATE,
  LEGACY_OPENING_BALANCE_SOURCE,
  LEGACY_PACK_SIZE,
  LEGACY_SALE_CREATE_BACKFILL,
  LEGACY_SERVICE_EXCLUSIONS,
  LEGACY_SERVICE_PATTERNS,
  LEGACY_STRONG_SERVICE,
  LEGACY_TITLE_PREFIX,
  LEGACY_UNKNOWN_SERVICE_ID,
  LEGACY_WALKIN_CUSTOMER_ID,
  PET_NAME_SEPARATORS,
  PET_NON_NAMES,
} from "@/constants/legacy-import";
import { CLINIC } from "@/constants/clinic";
import { normalizeLegacyPhone } from "./phone";

type Row = Record<string, string | null>;
const s = (v: string | null | undefined) => (v ?? "").trim();
const num = (v: string | null | undefined) => {
  const n = Number(s(v));
  return Number.isFinite(n) ? n : 0;
};
// UnitPrice is float32 in Access, so values arrive as 34.166599. Money is
// Decimal(12,2) here, and the source's own totals are 2dp.
const money = (v: string | null | undefined) => Math.round(num(v) * 100) / 100;

/**
 * Access exports every date and time as "MM/DD/YY HH:MM:SS", including columns
 * that only carry one half of that. Returns the two halves separately so a
 * caller can take the day from one column and the time of day from another.
 */
export function stamp(v: string | null | undefined) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(s(v));
  if (!m) return null;
  const [, mo, d, y, h, mi, sec] = m;
  // Two-digit years. The clinic's data is 2026; the only other year in the file
  // is 99, which is Access's 1899 epoch for a time-only column.
  const year = Number(y) >= 90 ? 1900 + Number(y) : 2000 + Number(y);
  return { date: `${year}-${mo}-${d}`, time: `${h}:${mi}:${sec}` };
}

/**
 * A naive "YYYY-MM-DD HH:MM:SS" turned into an absolute instant in the clinic's
 * timezone.
 *
 * Necessary because these columns land in timestamptz. Handing Postgres a naive
 * string makes it guess using the session timezone, so the same import would
 * store different instants depending on which machine ran it. Beirut is also
 * +02 in winter and +03 in summer, so a fixed offset would be wrong for half
 * the year; the offset is resolved per timestamp instead.
 */
export function atClinicTime(local: string): string {
  const asUtc = new Date(`${local.replace(" ", "T")}Z`);
  if (Number.isNaN(asUtc.getTime())) throw new Error(`bad timestamp ${local}`);
  // Read the wall clock this instant shows in Beirut; the difference from the
  // input is the offset. Applied twice so a timestamp within an hour of a DST
  // change settles on the right side of it.
  let guess = asUtc;
  for (let pass = 0; pass < 2; pass++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: CLINIC.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(guess);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    const shown = Date.UTC(
      Number(get("year")),
      Number(get("month")) - 1,
      Number(get("day")),
      Number(get("hour")) % 24,
      Number(get("minute")),
      Number(get("second")),
    );
    guess = new Date(guess.getTime() - (shown - asUtc.getTime()));
  }
  return guess.toISOString();
}

/** Split a client name: first token is the first name, the rest is the surname. */
export function splitClientName(raw: string): {
  salutation: string | null;
  first: string;
  last: string;
} {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const title = collapsed.match(LEGACY_TITLE_PREFIX);
  const cleaned = title ? collapsed.slice(title[0].length) : collapsed;
  // Normalise "dr" and "DR." to a consistent "Dr." for display.
  const salutation = title
    ? title[1].charAt(0).toUpperCase() + title[1].slice(1).toLowerCase() + "."
    : null;
  const gap = cleaned.indexOf(" ");
  return gap === -1
    ? { salutation, first: cleaned, last: "" }
    : {
        salutation,
        first: cleaned.slice(0, gap),
        last: cleaned.slice(gap + 1),
      };
}

/**
 * Classify a legacy product as a clinic service, or null for retail stock.
 * See the three-pass explanation in @/constants/legacy-import.
 */
export function classifyService(name: string): string | null {
  if (LEGACY_SERVICE_EXCLUSIONS.test(name)) return null;
  for (const [category, pattern] of LEGACY_STRONG_SERVICE) {
    if (pattern.test(name)) return category;
  }
  // A pack size means it came off a shelf.
  if (LEGACY_PACK_SIZE.test(name)) return null;
  for (const [category, pattern] of LEGACY_SERVICE_PATTERNS) {
    if (pattern.test(name)) return category;
  }
  return null;
}

// Chunked parameterised upsert. Kept generic so each entity below reads as a
// mapping rather than as SQL plumbing.
async function upsert(
  table: string,
  cols: string[],
  rows: unknown[][],
  update: string[],
) {
  if (rows.length === 0) return;
  const wrong = rows.findIndex((r) => r.length !== cols.length);
  if (wrong !== -1) {
    throw new Error(
      `${table}: row ${wrong} has ${rows[wrong]?.length} values for ${cols.length} columns`,
    );
  }
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = slice.map((r) => {
      const ph = r.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(",")})`;
    });
    const setter = update.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");
    const bad = params.findIndex((v) => v === undefined);
    if (bad !== -1) {
      throw new Error(
        `${table}: undefined parameter at position ${bad} (column "${cols[bad % cols.length]}")`,
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")})
       VALUES ${tuples.join(",")}
       ON CONFLICT ("legacy_id") DO UPDATE SET ${setter}`,
      ...params,
    );
  }
}

export async function transform() {
  const q = <T = Row>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
  const report: string[] = [];

  // ── Clients ────────────────────────────────────────────────────────────
  const custs = await q(`SELECT * FROM staging.customerwholesale`);
  const clientRows: unknown[][] = [];
  for (const c of custs) {
    const id = num(c.CustomerWSID);
    const raw = s(c.CustWholeSaleName);
    // The walk-in counter account is not a person, but 2,398 invoices point at
    // it and Invoice.client_id is NOT NULL, so it becomes one labelled row.
    if (id === LEGACY_WALKIN_CUSTOMER_ID) {
      clientRows.push([
        id,
        null,
        "Walk-in",
        "",
        null,
        null,
        money(c.WSAccount),
        false,
        "Counter sales from the old system. Not a real client.",
        "Walk-in",
      ]);
      continue;
    }
    if (!raw) continue; // 14 empty shells: no name, no phone, no pets
    const parsed = splitClientName(raw);
    // The old system had its own title field; prefer it when it was filled in.
    const salutation = s(c.BName) || parsed.salutation;
    const { first, last } = parsed;
    const primary = normalizeLegacyPhone(s(c.PhoneNumber));
    const secondary = normalizeLegacyPhone(s(c.FaxNumber));
    // The old "fax" box held a second contact number. Either box may be the only
    // usable one, and a few cells hold two numbers at once.
    const phone = primary.phone ?? secondary.phone;
    const phone2 = primary.phone
      ? (secondary.phone ?? primary.extra)
      : secondary.extra;
    const notes: string[] = [];
    let review: string | null = null;
    if (/^(1|tes+t+|xxx+)$/i.test(raw))
      review = `Looks like a test record ("${raw}").`;
    else review = primary.problem ?? secondary.problem;
    if (s(c.Insured) && s(c.Insured) !== "No")
      notes.push(`Insurance: ${s(c.Insured)}`);
    clientRows.push([
      id,
      salutation ? salutation.slice(0, 20) : null,
      first,
      last,
      phone,
      phone2,
      // The old system's running balance, which carries years this file does
      // not contain, so it is taken as-is rather than recomputed.
      money(c.WSAccount),
      review !== null,
      review,
      notes.join("\n") || null,
    ]);
  }
  await upsert(
    "clients",
    [
      "legacy_id",
      "salutation",
      "first_name",
      "last_name",
      "phone",
      "phone2",
      "account_balance",
      "needs_review",
      "review_note",
      "notes",
    ],
    clientRows,
    [
      "salutation",
      "first_name",
      "last_name",
      "phone",
      "phone2",
      "account_balance",
    ],
  );
  report.push(`clients        ${clientRows.length}`);

  const clientId = new Map<number, number>();
  for (const r of await q<{ legacy_id: number; client_id: number }>(
    `SELECT legacy_id, client_id FROM clients WHERE legacy_id IS NOT NULL`,
  ))
    clientId.set(Number(r.legacy_id), Number(r.client_id));

  // Stripping an embedded title ("Mr.Ramzi Merhi" -> "Ramzi Merhi") can make a
  // record collide with an existing one. Usually that means the clinic entered
  // the same person twice, but not always: the phone numbers sometimes differ.
  // Flag both sides and let a human decide rather than merging automatically.
  const dupes = await prisma.$executeRawUnsafe(`
    UPDATE "clients" c SET "needs_review" = true, "review_note" =
      'Another client has this exact name. Check whether they are the same person before using either record.'
    FROM (SELECT lower(first_name) f, lower(last_name) l
          FROM "clients" WHERE legacy_id IS NOT NULL
          GROUP BY 1,2 HAVING count(*) > 1) d
    WHERE lower(c.first_name) = d.f AND lower(c.last_name) = d.l
      AND c.legacy_id IS NOT NULL AND c."review_note" IS NULL`);
  report.push(
    `duplicates     ${dupes} clients share a name with another client`,
  );

  // ── Patients (pet names typed into the client notes box) ───────────────
  const petRows: unknown[][] = [];
  let flaggedPets = 0;
  for (const c of custs) {
    const id = num(c.CustomerWSID);
    const owner = clientId.get(id);
    const rawNotes = s(c.Notes);
    if (!owner || !rawNotes || id === LEGACY_WALKIN_CUSTOMER_ID) continue;
    const parts = rawNotes
      .split(PET_NAME_SEPARATORS)
      .map((p) => p.trim())
      .filter(Boolean);
    // Newline is the one separator staff used consistently. Anything else in a
    // multi-pet entry is a guess at where one name ends and the next begins.
    const ambiguous = parts.length > 1 && !/[\n\r]/.test(rawNotes);
    parts.forEach((part, idx) => {
      const isDescription = PET_NON_NAMES.has(part.toLowerCase());
      let review: string | null = null;
      if (isDescription)
        review = `Owner record said "${part}" where a pet name should be.`;
      else if (ambiguous)
        review = `Split from "${rawNotes.replace(/\s+/g, " ")}". Confirm the names.`;
      if (review) flaggedPets++;
      petRows.push([
        id * 100 + idx,
        owner,
        isDescription ? "Unnamed pet" : part.slice(0, 100),
        isDescription ? part.toLowerCase() : null,
        review !== null,
        review,
        `Imported from the old system: "${rawNotes.replace(/\s+/g, " ")}"`,
      ]);
    });
  }
  await upsert(
    "patients",
    [
      "legacy_id",
      "client_id",
      "name",
      "species",
      "needs_review",
      "review_note",
      "notes",
    ],
    petRows,
    ["client_id", "name"],
  );
  report.push(`patients       ${petRows.length} (${flaggedPets} flagged)`);

  // ── Products: split into clinic services and retail stock ──────────────
  // Items the clinic actually traded in: sold to a client, or bought from a
  // supplier. The other ~2,250 products are vendor catalogue padding.
  const traded = new Set(
    (
      await q<{ ProductID: string }>(
        `SELECT DISTINCT "ProductID" FROM staging.custinvoicedetails
         UNION SELECT DISTINCT "ProductID" FROM staging.invoice_details`,
      )
    ).map((r: { ProductID: string }) => s(r.ProductID)),
  );
  // Products bought from a supplier need an inventory row so stock can be
  // tracked, even when they are also billed as a service.
  const purchased = new Set(
    (
      await q<{ ProductID: string }>(
        `SELECT DISTINCT "ProductID" FROM staging.invoice_details`,
      )
    ).map((r: { ProductID: string }) => s(r.ProductID)),
  );
  const prods = await q(`SELECT * FROM staging.products`);
  const svcRows: unknown[][] = [],
    invRows: unknown[][] = [];
  const isService = new Map<number, boolean>();
  for (const p of prods) {
    const pid = num(p.ProductID);
    if (!traded.has(s(p.ProductID))) continue;
    const name = s(p.ProductName) || `Product ${pid}`;
    const category = classifyService(name);
    const price = money(p.UnitPrice);
    const review = price === 0 ? "No price recorded in the old system." : null;
    const catId = s(p.CategoryID);
    const stockCategory =
      catId && catId !== "0"
        ? (LEGACY_CATEGORY_NAMES[catId] ?? `Category ${catId}`)
        : null;
    if (category) {
      isService.set(pid, true);
      svcRows.push([
        pid,
        name.slice(0, 255),
        category,
        price,
        review !== null,
        review,
      ]);
      // A vaccine is both: stock the clinic buys and counts, and a service it
      // charges for (the handling fee). It therefore gets an inventory row as
      // well, so purchases and stock levels have somewhere to land. Sales still
      // bill against the service.
      if (purchased.has(s(p.ProductID))) {
        invRows.push([
          pid,
          name.slice(0, 255),
          stockCategory ?? category,
          s(p.Unit) || null,
          price || null,
          money(p.LastInvPrice) || null,
          review !== null,
          review,
        ]);
      }
    } else {
      isService.set(pid, false);
      invRows.push([
        pid,
        name.slice(0, 255),
        // The old catalogue numbered its categories and shipped no names, so
        // the number is carried across for the clinic to rename.
        stockCategory,
        s(p.Unit) || null,
        price || null,
        money(p.LastInvPrice) || null,
        review !== null,
        review,
      ]);
    }
  }
  // invoice_line_items requires every line to point at a service or an item.
  // Two sentinels give the lines that have no product of their own somewhere to
  // attach: the invoice-level discount, and any product missing from the file.
  svcRows.push([
    LEGACY_DISCOUNT_SERVICE_ID,
    "Discount",
    "Adjustment",
    0,
    false,
    null,
  ]);
  svcRows.push([
    LEGACY_UNKNOWN_SERVICE_ID,
    "Unknown legacy product",
    "Adjustment",
    0,
    true,
    "Invoice line referenced a product that is not in the old system's product list.",
  ]);
  await upsert(
    "services",
    ["legacy_id", "name", "category", "price", "needs_review", "review_note"],
    svcRows,
    ["name", "category", "price"],
  );
  await upsert(
    "inventory_items",
    [
      "legacy_id",
      "name",
      "category",
      "unit",
      "sale_price",
      "last_cost",
      "needs_review",
      "review_note",
    ],
    invRows,
    ["name", "category", "unit", "sale_price", "last_cost"],
  );
  report.push(`services       ${svcRows.length}`);
  report.push(`inventory      ${invRows.length}`);

  // ── Suppliers ──────────────────────────────────────────────────────────
  const sups = await q(`SELECT * FROM staging.suppliers`);
  // Contact details are deliberately not imported. PhoneNumber, FaxNumber and
  // Address are empty on all 25 supplier rows, so the old mapping only ever
  // wrote nulls, and because "phone" was in the conflict-update list every
  // re-run blanked whatever staff had typed in the app. Supplier people now
  // live in supplier_contacts, which this import does not touch at all, so a
  // re-run at cutover cannot reach them.
  await upsert(
    "suppliers",
    ["legacy_id", "name", "account_balance", "needs_review", "review_note"],
    sups.map((x: Row) => [
      num(x.SupplierID),
      // One supplier row has no name but does carry a balance, so it gets a
      // placeholder rather than being dropped along with the money it owes.
      (s(x.SupplierName) || `Supplier ${num(x.SupplierID)}`).slice(0, 255),
      // The old system's supplier Account column: what the clinic still owes.
      money(x.Account),
      false,
      null,
    ]),
    ["name", "account_balance"],
  );
  report.push(`suppliers      ${sups.length}`);

  // ── Supplier opening balances ──────────────────────────────────────────
  // Suppliers.BBack is the balance brought forward from the years before this
  // file. It is NOT extra money owed: Account already contains it
  // (Account = BBack + purchases - payments, exact on 21 of 25 suppliers), so
  // account_balance above is already right and must not be touched here. This
  // row exists so a statement can show where the figure started instead of
  // opening on an unexplained gap.
  const openingRows = sups
    .map((x: Row) => ({ legacyId: num(x.SupplierID), amount: money(x.BBack) }))
    .filter((r) => Math.abs(r.amount) >= LEGACY_BALANCE_EPSILON);

  if (openingRows.length) {
    const params: unknown[] = [];
    const tuples = openingRows.map((r) => {
      params.push(
        r.legacyId,
        r.amount,
        LEGACY_OPENING_BALANCE_DATE,
        LEGACY_OPENING_BALANCE_SOURCE,
        String(r.legacyId),
      );
      const n = params.length;
      return `((SELECT supplier_id FROM suppliers WHERE legacy_id = $${n - 4}),
                $${n - 3}::numeric, $${n - 2}::date, $${n - 1}, $${n})`;
    });
    // DO NOTHING, not DO UPDATE: the row is immutable and a second import must
    // never restate a figure the clinic has already shown someone.
    await prisma.$executeRawUnsafe(
      `INSERT INTO opening_balances
         (supplier_id, amount, as_of_date, source, source_ref)
       VALUES ${tuples.join(",")}
       ON CONFLICT (supplier_id, as_of_date) DO NOTHING`,
      ...params,
    );
  }
  report.push(`sup. opening   ${openingRows.length}`);

  // ── Invoices ───────────────────────────────────────────────────────────
  const invoices = await q(`SELECT * FROM staging.custinvoices`);
  const invRowsOut: unknown[][] = [];
  for (const i of invoices) {
    const owner = clientId.get(num(i.CustomerWSID));
    if (!owner) continue; // 6 invoices point at a client id that does not exist

    // When the invoice was written. CustInvoiceDate carries the day at
    // midnight and a separate Time column carries the time of day, so taking
    // the date alone put all 7,765 invoices at 00:00 and left everything
    // billed on the same day in arbitrary order.
    const day = stamp(i.CustInvoiceDate);
    const clock = stamp(i.Time);
    const issuedAt = day
      ? atClinicTime(`${day.date} ${clock ? clock.time : "00:00:00"}`)
      : null;

    // When the row was created in the old system. Trustworthy except for the
    // bulk backfill stamp, which is not a creation time at all; those fall
    // back to the invoice's own moment. So does anything claiming to predate
    // the invoice it belongs to.
    const sale = stamp(i.SaleCreateDate);
    const saleAt =
      sale && s(i.SaleCreateDate) !== LEGACY_SALE_CREATE_BACKFILL
        ? atClinicTime(`${sale.date} ${sale.time}`)
        : null;
    const createdAt =
      saleAt && issuedAt && saleAt >= issuedAt ? saleAt : issuedAt;

    // The rate the clinic billed this invoice at. USD is the ledger currency
    // here, and this is what its lira figures were computed with, so it is
    // frozen onto the invoice exactly as issuing one today does.
    const rate = num(i.DollarRate);

    invRowsOut.push([
      num(i.CustInvoiceID),
      owner,
      "Paid",
      money(i.AmountInv),
      money(i.AmountInv),
      issuedAt,
      createdAt,
      rate > 0 ? rate : null,
      false,
      null,
    ]);
  }
  await upsert(
    "invoices",
    [
      "legacy_id",
      "client_id",
      "status",
      "subtotal",
      "total",
      "issued_at",
      "created_at",
      "fx_rate",
      "needs_review",
      "review_note",
    ],
    invRowsOut,
    ["client_id", "subtotal", "total", "issued_at", "created_at", "fx_rate"],
  );
  report.push(`invoices       ${invRowsOut.length}`);

  const invoiceId = new Map<number, number>();
  for (const r of await q<{ legacy_id: number; invoice_id: number }>(
    `SELECT legacy_id, invoice_id FROM invoices WHERE legacy_id IS NOT NULL`,
  ))
    invoiceId.set(Number(r.legacy_id), Number(r.invoice_id));

  const svcId = new Map<number, number>(),
    itemId = new Map<number, number>();
  for (const r of await q<{ legacy_id: number; service_id: number }>(
    `SELECT legacy_id, service_id FROM services WHERE legacy_id IS NOT NULL`,
  ))
    svcId.set(Number(r.legacy_id), Number(r.service_id));
  for (const r of await q<{ legacy_id: number; item_id: number }>(
    `SELECT legacy_id, item_id FROM inventory_items WHERE legacy_id IS NOT NULL`,
  ))
    itemId.set(Number(r.legacy_id), Number(r.item_id));

  // ── Line items ─────────────────────────────────────────────────────────
  const details = await q(`SELECT * FROM staging.custinvoicedetails`);
  const prodName = new Map<number, string>(
    prods.map((p: Row) => [num(p.ProductID), s(p.ProductName)]),
  );
  const lineRows: unknown[][] = [];
  for (const d of details) {
    const inv = invoiceId.get(num(d.CustInvoiceID));
    if (!inv) continue;
    const pid = num(d.ProductID);
    const svc = isService.get(pid) === true ? (svcId.get(pid) ?? null) : null;
    const item =
      isService.get(pid) === false ? (itemId.get(pid) ?? null) : null;
    const unresolved = svc === null && item === null;
    lineRows.push([
      num(d.CustInvoiceDetailID),
      inv,
      unresolved ? (svcId.get(LEGACY_UNKNOWN_SERVICE_ID) ?? null) : svc,
      item,
      (prodName.get(pid) || `Product ${pid}`).slice(0, 255),
      num(d.Quantity),
      money(d.UnitPrice),
      unresolved,
      unresolved
        ? `Product ${pid} was not found in the old system's product list.`
        : null,
    ]);
  }
  // The old system stored an invoice-level discount as a flat amount. line_total
  // is a generated column here, so the discount becomes its own negative line:
  // the lines still sum to the invoice total and it stays visible when printed.
  let discountLines = 0;
  for (const i of invoices) {
    const disc = money(i.DiscountInv);
    const inv = invoiceId.get(num(i.CustInvoiceID));
    if (!inv || disc <= 0) continue;
    discountLines++;
    lineRows.push([
      -num(i.CustInvoiceID),
      inv,
      svcId.get(LEGACY_DISCOUNT_SERVICE_ID) ?? null,
      null,
      "Discount",
      1,
      -disc,
      false,
      null,
    ]);
  }
  await upsert(
    "invoice_line_items",
    [
      "legacy_id",
      "invoice_id",
      "service_id",
      "item_id",
      "description",
      "quantity",
      "unit_price",
      "needs_review",
      "review_note",
    ],
    lineRows,
    ["invoice_id", "description", "quantity", "unit_price"],
  );
  report.push(
    `line items     ${lineRows.length} (${discountLines} discount lines)`,
  );

  // ── Payments ───────────────────────────────────────────────────────────
  const pays = await q(`SELECT * FROM staging.payments`);
  const payRows: unknown[][] = [];
  // Payments belong to the client's account, exactly as the old system had it:
  // its Payments table carried both a CustomerID and an InvNo, and clients
  // routinely settled several visits at once. The invoice link is kept when it
  // resolves, so an invoice still shows what was paid against it, while the
  // account balance is what really says whether a client owes anything.
  //
  // The file also holds refunds (negative) and zero-value rows. A zero payment
  // says nothing and is skipped. A refund is imported AS a negative payment,
  // which is the whole of what it is: money handed back across the counter.
  //
  // It used to be skipped and its invoice flagged instead, on the reasoning
  // that a payment ought to be positive. That reasoning was about the app's own
  // entry form, not about the ledger: the payments CHECK constraint is
  // `amount <> 0`, not `amount > 0`, and every figure built on payments is a
  // sum, so a refund belongs in each of them as the outflow it was. Dropping it
  // left the client having paid more than they did. On this file that
  // overstated what 27 accounts had settled, by 1,078.31 in total, and it was
  // the single largest reason a statement would not tie back to its own
  // documents: it accounted for 21 of the 40 accounts that did not.
  let refunds = 0;
  let zeroPays = 0;
  let unlinked = 0;
  for (const p of pays) {
    const owner = clientId.get(num(p.CustomerID));
    if (!owner) continue;
    const inv = invoiceId.get(num(p.InvNo)) ?? null;
    if (!inv) unlinked++;
    const amount = money(p.PaymentAmount);
    if (amount === 0) {
      zeroPays++;
      continue;
    }
    const refund = amount < 0;
    if (refund) refunds++;
    // What was physically handed over, and in what. The old system split every
    // payment into a Dollar and an LL column: 6,331 are dollars only, 2 are
    // lira only and 1 is both. `amount` stays the USD equivalent that settles
    // the invoice either way.
    const dollars = money(p.Dollar);
    const lira = money(p.LL);
    const rate = num(p.DollarRate);
    const liraOnly = lira !== 0 && dollars === 0;

    // A payment taken in both currencies cannot be split into two rows here:
    // legacy_id is unique per payment, which is what makes this import a delta
    // rather than a duplicate. It is imported at its USD value and flagged, so
    // the one row a human needs to look at is findable.
    const mixed = lira !== 0 && dollars !== 0;

    // The moment of payment: PaymentDate carries the day, Time the time of day,
    // exactly as on invoices.
    const payDay = stamp(p.PaymentDate);
    const payClock = stamp(p.Time);
    const paidAt = payDay
      ? atClinicTime(`${payDay.date} ${payClock ? payClock.time : "00:00:00"}`)
      : null;

    // Both flags land on the payment row itself. The refund note used to be
    // written onto the invoice, which was the only place it could go while the
    // payment was being dropped; now that the row exists, the note belongs on
    // it rather than on a document that is otherwise unremarkable.
    const review: string[] = [];
    if (mixed)
      review.push(
        `Taken in both currencies: ${dollars.toFixed(2)} USD and ${lira.toFixed(0)} LBP at ${rate}. Imported at its dollar value; confirm how it should be recorded.`,
      );
    if (refund)
      review.push(
        `The old system recorded this as a refund of ${Math.abs(amount).toFixed(2)}. It is imported as a negative payment, so it reduces what this client has paid. Confirm the money was handed back.`,
      );

    payRows.push([
      num(p.PaymentID),
      owner,
      inv,
      amount,
      liraOnly ? "LBP" : "USD",
      liraOnly ? lira : amount,
      liraOnly && rate > 0 ? rate : null,
      paidAt,
      review.length > 0,
      review.join("\n\n") || null,
    ]);
  }
  await upsert(
    "payments",
    [
      "legacy_id",
      "client_id",
      "invoice_id",
      "amount",
      "currency",
      "amount_original",
      "fx_rate",
      "paid_at",
      "needs_review",
      "review_note",
    ],
    payRows,
    [
      "client_id",
      "invoice_id",
      "amount",
      "currency",
      "amount_original",
      "fx_rate",
      "paid_at",
      // Refreshed on re-import, unlike most tables here, because the flag is
      // derived from the source row rather than set by a later step. Left out,
      // a payment that has been imported once keeps whatever flag it had and
      // the mixed-currency note never appears.
      "needs_review",
      "review_note",
    ],
  );
  report.push(
    `payments       ${payRows.length} (${unlinked} on account only, ${refunds} refunds imported as negative, ${zeroPays} zero-value skipped)`,
  );

  // ── Purchases ──────────────────────────────────────────────────────────
  // Supplier accounts read as zero with no orders until this exists: the old
  // system kept purchases in its own Invoices / Invoice Details pair, entirely
  // separate from the customer invoices.
  const supplierId = new Map<number, number>();
  for (const r of await q<{ legacy_id: number; supplier_id: number }>(
    `SELECT legacy_id, supplier_id FROM suppliers WHERE legacy_id IS NOT NULL`,
  ))
    supplierId.set(Number(r.legacy_id), Number(r.supplier_id));

  const purchases = await q(`SELECT * FROM staging.invoices`);
  const poRows: unknown[][] = [];
  for (const p of purchases) {
    poRows.push([
      num(p.InvoiceID),
      supplierId.get(num(p.SupplierID)) ?? null,
      "Received",
      s(p.SupInvoiceNo).slice(0, 100) || null,
      s(p.InvoiceDate) || null,
      s(p.InvoiceDate) || null,
      // A received order must carry a billed date; these are supplier invoices,
      // so the invoice date is exactly that.
      s(p.InvoiceDate) || null,
      // The discount column must be non-negative here; the old file has a few
      // negative values, which are corrections rather than discounts.
      Math.max(0, money(p.InvDiscount)) || null,
    ]);
  }
  await upsert(
    "purchase_orders",
    [
      "legacy_id",
      "supplier_id",
      "status",
      "reference",
      "ordered_on",
      "received_on",
      "billed_on",
      "discount_amount",
    ],
    poRows,
    [
      "supplier_id",
      "reference",
      "ordered_on",
      "received_on",
      "billed_on",
      "discount_amount",
    ],
  );
  report.push(`purchase orders ${poRows.length}`);

  const orderId = new Map<number, number>();
  for (const r of await q<{ legacy_id: number; order_id: number }>(
    `SELECT legacy_id, order_id FROM purchase_orders WHERE legacy_id IS NOT NULL`,
  ))
    orderId.set(Number(r.legacy_id), Number(r.order_id));

  const purchaseLines = await q(`SELECT * FROM staging.invoice_details`);
  const polRows: unknown[][] = [];
  // Which supplier last supplied each item, used to fill in the item's supplier.
  const itemSupplier = new Map<number, number>();
  let returnedLines = 0;
  const poSupplier = new Map<number, number>(
    purchases.map((p: Row) => [num(p.InvoiceID), num(p.SupplierID)]),
  );
  for (const d of purchaseLines) {
    const order = orderId.get(num(d.InvoiceID));
    const item = itemId.get(num(d.ProductID));
    // Purchase lines require an inventory item; services are not stocked.
    if (!order || !item) continue;
    // A negative quantity is stock returned to the supplier. These are imported
    // as negative lines, not dropped: dropping them silently inflated what the
    // clinic appeared to owe, because a return that never lands never reduces
    // the balance. Counted separately so the run still reports them.
    //
    // Zero is still meaningless and is the only quantity skipped.
    const qty = num(d.Quantity);
    if (qty === 0) continue;
    if (qty < 0) returnedLines++;
    polRows.push([
      num(d.InvoiceDetailID),
      order,
      item,
      qty,
      qty,
      // Cost stays positive even on a return; the sign is carried by qty above.
      Math.max(0, money(d.Price)) || null,
    ]);
    const sup = supplierId.get(poSupplier.get(num(d.InvoiceID)) ?? -1);
    if (sup) itemSupplier.set(item, sup);
  }
  await upsert(
    "purchase_order_lines",
    [
      "legacy_id",
      "order_id",
      "item_id",
      "quantity_ordered",
      "quantity_received",
      "unit_cost",
    ],
    polRows,
    [
      "order_id",
      "item_id",
      "quantity_ordered",
      "quantity_received",
      "unit_cost",
    ],
  );
  report.push(
    `purchase lines  ${polRows.length} (${returnedLines} supplier returns)`,
  );

  // The product table never recorded a supplier (SupplierID is 0 on every row),
  // so an item's supplier is inferred from who the clinic actually bought it from.
  for (const [item, sup] of itemSupplier) {
    await prisma.$executeRawUnsafe(
      `UPDATE "inventory_items" SET "supplier_id" = $2 WHERE "item_id" = $1`,
      item,
      sup,
    );
  }
  report.push(
    `item suppliers  ${itemSupplier.size} items linked to a supplier`,
  );

  // Supplier payments. Without these the app shows the clinic owing the entire
  // purchase history, because every order imports as received and billed.
  const supPays = await q(`SELECT * FROM staging.suppayments`);
  const supPayRows: unknown[][] = [];
  for (const sp of supPays) {
    const sup = supplierId.get(num(sp.SupplierID));
    const amount = money(sp.PaymentAmount);
    if (!sup || amount <= 0 || !s(sp.PaymentDate)) continue;
    supPayRows.push([
      num(sp.PaymentID),
      sup,
      amount,
      s(sp.PaymentDate),
      s(sp.CheckNumber).slice(0, 100) || null,
    ]);
  }
  await upsert(
    "supplier_payments",
    ["legacy_id", "supplier_id", "amount", "paid_on", "reference"],
    supPayRows,
    ["supplier_id", "amount", "paid_on", "reference"],
  );
  report.push(`supplier pays   ${supPayRows.length}`);

  // ── Running costs ──────────────────────────────────────────────────────
  // The operating-expense ledger. Everything lands in one category; the
  // reasoning is on LEGACY_EXPENSE_CATEGORY, and the short version is that the
  // old system's expense types describe departments as often as cost kinds and
  // cannot be trusted even where they look right.
  const expTypes = new Map<string, string>();
  for (const t of await q(`SELECT * FROM staging.extype`)) {
    const name = s(t.ExpenseType);
    if (name) expTypes.set(String(num(t.ID)), name);
  }

  const expenses = await q(`SELECT * FROM staging.exdetails`);
  const costRows: unknown[][] = [];
  let zeroCosts = 0;
  for (const e of expenses) {
    // ExpAmount is the USD figure and already resolves the currency split; see
    // LEGACY_EXPENSE_AMOUNT_NOTE. Dollar and LL are the two tenders behind it
    // and must never be summed on their own.
    const amount = money(e.ExpAmount);
    // A zero-amount row is not a cost. Two exist, both with no type and no
    // description, and importing them would put empty rows in the cost list
    // for the clinic to wonder about.
    if (amount === 0) {
      zeroCosts += 1;
      continue;
    }
    const when = stamp(e.ExpDate);
    if (!when) continue;

    const legacyType = expTypes.get(String(num(e.Expense))) ?? null;
    // description is NOT NULL and is what staff actually read in the cost list.
    // Most rows carry a hand-typed note; where they do not, the old expense
    // type is the only thing left that says anything at all.
    const description =
      s(e.Details).slice(0, 200) || legacyType || "Legacy expense";

    costRows.push([
      num(e.ID),
      LEGACY_EXPENSE_CATEGORY,
      description,
      amount,
      when.date,
      // The legacy type is kept here rather than dropped: it is the only handle
      // on which part of the business spent the money, and re-filing these by
      // hand later is impossible without it.
      `${LEGACY_EXPENSE_AMOUNT_NOTE} #${num(e.ID)}. ` +
        (legacyType
          ? `Old expense type: ${legacyType}.`
          : "No expense type recorded."),
    ]);
  }
  await upsert(
    "running_costs",
    ["legacy_id", "category", "description", "amount", "incurred_on", "notes"],
    costRows,
    ["category", "description", "amount", "incurred_on", "notes"],
  );
  report.push(
    `running costs   ${costRows.length}` +
      (zeroCosts > 0 ? ` (${zeroCosts} zero-amount rows skipped)` : ""),
  );

  // ── Reconciliation ─────────────────────────────────────────────────────
  // The source stored prices as float32, so a handful of invoices do not sum
  // exactly once rounded to 2dp. The invoice total is taken from the source and
  // is authoritative; these few are flagged so the drift is visible rather than
  // quietly wrong on a printed invoice.
  const drift = await prisma.$executeRawUnsafe(`
    UPDATE "invoices" i SET "needs_review" = true, "review_note" =
      'Line items do not add up to the invoice total, by ' ||
      to_char(abs(i.total - s.ls), 'FM990.00') ||
      '. Caused by rounding in the old system. The total shown is the one it recorded.'
    FROM (SELECT li."invoice_id", SUM(li."line_total") ls
          FROM "invoice_line_items" li GROUP BY 1) s
    WHERE s."invoice_id" = i."invoice_id"
      AND i."legacy_id" IS NOT NULL
      AND abs(i.total - s.ls) > 0.005`);
  report.push(`reconciliation ${drift} invoices flagged for rounding drift`);

  const totals = await q<{ label: string; value: string }>(`
    SELECT 'source invoiced' label, to_char(SUM("AmountInv"::numeric),'FM999999990.00') value FROM staging.custinvoices
    UNION ALL SELECT 'imported total', to_char(SUM(total),'FM999999990.00') FROM "invoices" WHERE legacy_id IS NOT NULL`);
  console.log("\nreconciliation:");
  for (const t of totals) console.log(`  ${t.label.padEnd(16)} ${t.value}`);

  console.log("\nimported:");
  for (const line of report) console.log("  " + line);
}
