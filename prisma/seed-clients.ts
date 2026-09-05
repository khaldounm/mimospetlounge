/**
 * Seeds the curated client and patient records from the legacy Access system.
 *
 * The rows in seed-data/ are already resolved: names split, salutations lifted
 * into their own column, breeds separated from pet names, duplicates flagged.
 * Nothing is inferred at run time, so a seed always produces the same database.
 * The decisions and the reasoning behind them live in seed-data/curate.py,
 * which regenerates the JSON from a GT_Data .mdb export.
 *
 *   pnpm seed:clients            upsert clients and patients
 *   pnpm seed:clients -- --check report what would change, write nothing
 *
 * Runs after legacy:import, or on its own: both key on legacyId, so the two
 * can be re-run in any order without duplicating rows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  LEGACY_CREDIT_NOTE_ID_BASE,
  LEGACY_SETTLEMENT_ID_BASE,
  LEGACY_OPENING_BALANCE_DATE as OPENING_BALANCE_DATE,
  LEGACY_OPENING_BALANCE_SOURCE_CLIENT as OPENING_BALANCE_SOURCE,
} from "@/constants/legacy-import";
import { atClinicTime } from "@/lib/legacy-import/transform";

type SeedClient = {
  legacyId: number;
  salutation: string | null;
  firstName: string;
  lastName: string;
  accountBalance: number;
  // What the client owed before this file's own history begins, when the old
  // system's arithmetic proves it is still outstanding. Null when there was
  // none, or when the figure could not be trusted; see curate.py.
  openingBalance: number | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  notes: string | null;
  needsReview: boolean;
  reviewNote: string | null;
};

// A balance the clinic settled by hand, overriding the imported figure.
// See the block that applies these, below.
type BalanceCorrection = {
  legacyId: number;
  clientId: number;
  name: string;
  balance: number;
  reason: string;
  // A balance the old file carried in CustomerWholesale.BBack that curation
  // held back. Held back correctly in almost every case, because the old
  // running total usually already agrees with the documents without it; these
  // are the exceptions the clinic confirmed.
  openingBalance?: number;
  // The old system's CreditNote row behind this correction, where there is one.
  // Posted as a document so the client reads "Credit note" on their statement
  // instead of an adjustment with no explanation.
  creditNote?: {
    legacyId: number;
    date: string;
    amount: number;
    purpose: string | null;
  };
  // A charge posted to close an account the clinic has agreed is square, where
  // the documents say otherwise and nothing in the old file explains why.
  settlement?: { date: string; amount: number; description: string };
};

type SeedPatient = {
  legacyId: number;
  clientLegacyId: number;
  name: string;
  species: string | null;
  breed: string | null;
  sex: string | null;
  notes: string | null;
  needsReview: boolean;
  reviewNote: string | null;
};

const DATA_DIR = join(import.meta.dirname, "seed-data");

function load<T>(file: string): T[] {
  return JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")) as T[];
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const clients = load<SeedClient>("clients.json");
  const patients = load<SeedPatient>("patients.json");
  const corrections = load<BalanceCorrection>("balance-corrections.json");

  console.log(
    `${clients.length} clients and ${patients.length} patients to seed` +
      (checkOnly ? " (check only, nothing will be written)" : ""),
  );

  if (checkOnly) {
    const existing = await prisma.client.count({
      where: { legacyId: { not: null } },
    });
    const flagged = clients.filter((c) => c.needsReview).length;
    const petsFlagged = patients.filter((p) => p.needsReview).length;
    console.log(`  already imported: ${existing} clients`);
    console.log(
      `  flagged for review: ${flagged} clients, ${petsFlagged} pets`,
    );
    return;
  }

  // Upsert on legacyId so re-running is the cutover delta rather than a
  // duplicate import.
  //
  // One multi-row INSERT ... ON CONFLICT per chunk rather than a transaction of
  // per-row upserts. Prisma's upsert costs a round trip each, which is fine on
  // localhost and far too slow against Supabase: 200 rows took over the 5s
  // interactive-transaction limit on latency alone. This is one round trip per
  // chunk, so the remote run is a handful of statements instead of ~3,300.
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < clients.length; i += CHUNK) {
    const batch = clients.slice(i, i + CHUNK);
    const values = batch.map(
      (c) => Prisma.sql`(
        ${c.legacyId}::int, ${c.salutation}::varchar, ${c.firstName}::varchar,
        ${c.lastName}::varchar, ${c.accountBalance.toFixed(2)}::numeric,
        ${c.phone}::varchar, ${c.phone2}::varchar, ${c.email}::citext,
        ${c.notes}::text, ${c.needsReview}::boolean, ${c.reviewNote}::text,
        now(), now())`,
    );
    // deletedAt is deliberately absent from the update list: if staff archived
    // a client after an earlier import, re-seeding must not resurrect them.
    await prisma.$executeRaw`
      INSERT INTO clients (
        legacy_id, salutation, first_name, last_name, account_balance,
        phone, phone2, email, notes, needs_review, review_note,
        created_at, updated_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (legacy_id) DO UPDATE SET
        salutation      = EXCLUDED.salutation,
        first_name      = EXCLUDED.first_name,
        last_name       = EXCLUDED.last_name,
        account_balance = EXCLUDED.account_balance,
        phone           = EXCLUDED.phone,
        phone2          = EXCLUDED.phone2,
        email           = EXCLUDED.email,
        notes           = EXCLUDED.notes,
        needs_review    = EXCLUDED.needs_review,
        review_note     = EXCLUDED.review_note,
        updated_at      = now()`;
    written += batch.length;
    process.stdout.write(`\r  clients ${written}/${clients.length}`);
  }
  console.log("");

  const clientIdByLegacy = new Map<number, number>(
    (
      await prisma.client.findMany({
        where: { legacyId: { not: null } },
        select: { clientId: true, legacyId: true },
      })
    ).map((c) => [c.legacyId as number, c.clientId]),
  );

  // Balances the clinic settled by hand, written OVER the imported figure.
  //
  // The old system's WSAccount is not a computed ledger. It is a field Access
  // updated on some paths and not others, so on a handful of accounts it
  // disagrees with Access's own documents: a payment taken on the day of the
  // export never reached it, an unpaid charge was skipped, or a credit note was
  // counted that never touched an invoice. Each of these was put to the clinic
  // and the figure here is the one they gave back.
  //
  // It lives in its own hand-written file rather than in clients.json because
  // curate.py regenerates that from the .mdb and would overwrite it on the next
  // refresh. This is the only balance in the database that is neither imported
  // nor derived, so it is kept where a human can read the reason next to the
  // number.
  //
  // The statement still works its own closing figure out of the documents and
  // states any difference on its own row. That is deliberate: where a credit
  // note or a waiver never became a document, the gap is real, and a client is
  // entitled to see that it exists rather than have it folded silently into the
  // total.
  if (corrections.length) {
    const unknown = corrections.filter(
      (c) => !clientIdByLegacy.has(c.legacyId),
    );
    if (unknown.length)
      throw new Error(
        `balance-corrections.json names ${unknown.length} client(s) this import does not have: ` +
          unknown.map((c) => `${c.name} (legacy ${c.legacyId})`).join(", "),
      );
    const values = corrections.map(
      (c) => Prisma.sql`(${c.legacyId}::int, ${c.balance.toFixed(2)}::numeric)`,
    );
    await prisma.$executeRaw`
      UPDATE clients c
         SET account_balance = v.column2, updated_at = now()
        FROM (VALUES ${Prisma.join(values)}) AS v
       WHERE c.legacy_id = v.column1`;
    console.log(`  balance corrections ${corrections.length}`);
    for (const c of corrections)
      console.log(`    ${c.name.padEnd(22)} ${c.balance.toFixed(2)}`);
  }

  // The credit notes behind some of those corrections, posted as documents.
  //
  // Access keeps these in a CreditNote table that it counts into the client's
  // balance but never posts against an invoice, so nothing in the imported
  // documents explains them. Only the ones the clinic confirmed are here: of
  // the 17 in the file, the other 11 already went through as ordinary documents
  // and posting those again would double-count them.
  //
  // Shape: a negative invoice with NO line items, which is exactly what a
  // credit note is, and what lets a statement tell it apart from a return
  // (goods back, lines say which). It carries no stock movement and no payment,
  // so the ledger and the till are untouched; analytics correctly reads it as
  // revenue given back.
  //
  // account_balance is NOT adjusted here. It was set absolutely a few lines
  // above, from the figure the clinic gave, so posting this document explains
  // the balance rather than moving it.
  //
  // The delete below matters as much as the insert. Taking a credit note back
  // out of the file has to take it out of the database too, and on a database
  // that is NOT being rebuilt from scratch nothing else would: an upsert only
  // ever adds. It is scoped to the reserved legacy_id range, so it can only
  // ever reach rows this block wrote.
  const withNotes = corrections.filter((c) => c.creditNote);
  const withSettlement = corrections.filter((c) => c.settlement);
  const keep = [
    ...withNotes.map(
      (c) => LEGACY_CREDIT_NOTE_ID_BASE + c.creditNote!.legacyId,
    ),
    ...withSettlement.map((c) => LEGACY_SETTLEMENT_ID_BASE + c.legacyId),
  ];
  const stale = await prisma.$executeRaw`
    DELETE FROM invoices
     WHERE legacy_id >= ${LEGACY_CREDIT_NOTE_ID_BASE}
       AND NOT (legacy_id = ANY (${keep}::int[]))`;
  if (stale > 0) console.log(`  credit notes withdrawn ${stale}`);
  if (withNotes.length) {
    const values = withNotes.map((c) => {
      const n = c.creditNote!;
      const at = atClinicTime(`${n.date} 12:00:00`);
      return Prisma.sql`(
        ${LEGACY_CREDIT_NOTE_ID_BASE + n.legacyId}::int,
        ${clientIdByLegacy.get(c.legacyId)!}::int,
        'Paid'::varchar,
        ${(-n.amount).toFixed(2)}::numeric,
        ${(-n.amount).toFixed(2)}::numeric,
        ${at}::timestamptz, ${at}::timestamptz)`;
    });
    await prisma.$executeRaw`
      INSERT INTO invoices
        (legacy_id, client_id, status, subtotal, total, issued_at, created_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (legacy_id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        subtotal  = EXCLUDED.subtotal,
        total     = EXCLUDED.total,
        issued_at = EXCLUDED.issued_at,
        updated_at = now()`;
    console.log(`  credit notes ${withNotes.length}`);
    for (const c of withNotes)
      console.log(
        `    ${c.name.padEnd(22)} ${(-c.creditNote!.amount).toFixed(2)}  ${c.creditNote!.date}`,
      );
  }

  // Opening balances. Written as immutable dated rows rather than folded into
  // account_balance, which ALREADY contains them: the old system's WSAccount is
  // BBack + invoiced - paid, so adding them again would bill the client twice.
  // They exist so a statement shows where the figure started.
  const opening: { legacyId: number; openingBalance: number }[] = [
    ...clients
      .filter((c) => c.openingBalance !== null)
      .map((c) => ({
        legacyId: c.legacyId,
        openingBalance: c.openingBalance!,
      })),
    // Plus the few the clinic put back by hand. They insert on the same date
    // and carry the same source as the rest, because they came from the same
    // column: nothing about the row should say it arrived by a different route.
    ...corrections
      .filter((c) => c.openingBalance != null)
      .map((c) => ({
        legacyId: c.legacyId,
        openingBalance: c.openingBalance!,
      })),
  ];
  if (opening.length) {
    const values = opening.map(
      (c) => Prisma.sql`(
        ${clientIdByLegacy.get(c.legacyId) ?? null}::int,
        ${c.openingBalance.toFixed(2)}::numeric,
        ${OPENING_BALANCE_DATE}::date,
        ${OPENING_BALANCE_SOURCE}::varchar,
        ${String(c.legacyId)}::varchar)`,
    );
    // DO NOTHING because the row is immutable: a re-run must never restate a
    // figure the clinic has already put in front of someone.
    await prisma.$executeRaw`
      INSERT INTO opening_balances
        (client_id, amount, as_of_date, source, source_ref)
      SELECT * FROM (VALUES ${Prisma.join(values)}) AS v
      WHERE v.column1 IS NOT NULL
      ON CONFLICT (client_id, as_of_date) DO NOTHING`;
    console.log(`  opening balances ${opening.length}`);
  }

  // Settlements: the mirror image of a credit note, and posted the same way.
  //
  // A charge with nothing itemised behind it, which is what closing an agreed
  // position IS. It cannot be mistaken for a sale, in the reader's eye or in
  // this code, because a hidden line never reaches an invoice total: a positive
  // total with no visible lines can only be an adjustment to the account.
  //
  // Like the credit notes, this does not move account_balance. That was already
  // set from the figure the clinic gave; this document explains it.
  if (withSettlement.length) {
    const values = withSettlement.map((c) => {
      const t = c.settlement!;
      const at = atClinicTime(`${t.date} 12:00:00`);
      return Prisma.sql`(
        ${LEGACY_SETTLEMENT_ID_BASE + c.legacyId}::int,
        ${clientIdByLegacy.get(c.legacyId)!}::int,
        'Paid'::varchar,
        ${t.amount.toFixed(2)}::numeric,
        ${t.amount.toFixed(2)}::numeric,
        ${at}::timestamptz, ${at}::timestamptz)`;
    });
    await prisma.$executeRaw`
      INSERT INTO invoices
        (legacy_id, client_id, status, subtotal, total, issued_at, created_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (legacy_id) DO UPDATE SET
        client_id  = EXCLUDED.client_id,
        subtotal   = EXCLUDED.subtotal,
        total      = EXCLUDED.total,
        issued_at  = EXCLUDED.issued_at,
        updated_at = now()`;
    console.log(`  settlements ${withSettlement.length}`);
    for (const c of withSettlement)
      console.log(
        `    ${c.name.padEnd(22)} ${c.settlement!.amount.toFixed(2)}  ${c.settlement!.date}  ${c.settlement!.description}`,
      );
  }

  let petsWritten = 0;
  let orphaned = 0;
  for (let i = 0; i < patients.length; i += CHUNK) {
    const batch = patients.slice(i, i + CHUNK);
    const resolved = batch.flatMap((p) => {
      const clientId = clientIdByLegacy.get(p.clientLegacyId);
      if (clientId === undefined) {
        orphaned += 1;
        return [];
      }
      const { clientLegacyId, ...rest } = p;
      void clientLegacyId;
      return [{ ...rest, clientId }];
    });
    if (resolved.length > 0) {
      const values = resolved.map(
        (p) => Prisma.sql`(
          ${p.legacyId}::int, ${p.clientId}::int, ${p.name}::varchar,
          ${p.species}::varchar, ${p.breed}::varchar, ${p.sex}::varchar,
          ${p.notes}::text, ${p.needsReview}::boolean, ${p.reviewNote}::text,
          now(), now())`,
      );
      await prisma.$executeRaw`
        INSERT INTO patients (
          legacy_id, client_id, name, species, breed, sex, notes,
          needs_review, review_note, created_at, updated_at)
        VALUES ${Prisma.join(values)}
        ON CONFLICT (legacy_id) DO UPDATE SET
          client_id    = EXCLUDED.client_id,
          name         = EXCLUDED.name,
          species      = EXCLUDED.species,
          breed        = EXCLUDED.breed,
          sex          = EXCLUDED.sex,
          notes        = EXCLUDED.notes,
          needs_review = EXCLUDED.needs_review,
          review_note  = EXCLUDED.review_note,
          updated_at   = now()`;
    }
    petsWritten += resolved.length;
    process.stdout.write(`\r  patients ${petsWritten}/${patients.length}`);
  }
  console.log("");

  if (orphaned > 0) {
    console.warn(
      `  ${orphaned} patients had no matching client and were skipped`,
    );
  }

  // Reconcile. An earlier import invented pets that this curation does not
  // produce -- splitting a "<breed> - <name>" entry into two animals, for
  // instance. Upserting alone leaves those behind, so remove the ones nothing
  // references and flag the rest instead of deleting history.
  const seededPetIds = new Set(patients.map((p) => p.legacyId));
  const strays = await prisma.patient.findMany({
    where: { legacyId: { not: null }, deletedAt: null },
    select: {
      patientId: true,
      legacyId: true,
      name: true,
      _count: {
        select: { clinicalRecords: true, bookings: true, reminders: true },
      },
    },
  });

  const removable: number[] = [];
  const keepFlagged: number[] = [];
  for (const p of strays) {
    if (seededPetIds.has(p.legacyId as number)) continue;
    const referenced =
      p._count.clinicalRecords + p._count.bookings + p._count.reminders > 0;
    (referenced ? keepFlagged : removable).push(p.patientId);
  }

  if (removable.length > 0) {
    await prisma.patient.deleteMany({
      where: { patientId: { in: removable } },
    });
    console.log(
      `  removed ${removable.length} pets a previous import invented`,
    );
  }
  if (keepFlagged.length > 0) {
    await prisma.patient.updateMany({
      where: { patientId: { in: keepFlagged } },
      data: {
        needsReview: true,
        reviewNote:
          "A previous import created this pet and the corrected data no longer " +
          "lists it, but it already has visits or bookings. Check whether it is " +
          "a real animal before removing it.",
      },
    });
    console.log(
      `  flagged ${keepFlagged.length} leftover pets that already have history`,
    );
  }

  const flagged = await prisma.client.count({ where: { needsReview: true } });
  const petsFlagged = await prisma.patient.count({
    where: { needsReview: true },
  });
  console.log(
    `Done. ${flagged} clients and ${petsFlagged} pets are flagged for review.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
