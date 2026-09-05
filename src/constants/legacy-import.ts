// Configuration for the one-off migration from the clinic's old Microsoft Access
// system (GT_Data<YY>.mdb) into this app. See src/lib/legacy-import/.
//
// The .mdb holds real client PII, so every intermediate file is written to a
// scratch directory OUTSIDE the repo. Never point LEGACY_WORK_DIR inside it.

// Source tables that carry real data. The file has ~170 tables; the rest are
// vendor scaffolding (temp tables, report caches, "Paste Errors", Table1).
export const LEGACY_TABLES = [
  "CustomerWholesale",
  "Products",
  "CustInvoices",
  "CustInvoiceDetails",
  "Payments",
  "Invoices",
  "Invoice Details",
  "Suppliers",
  "SupPayments",
  // The operating-expense ledger and its type lookup. 488 rows of rent,
  // salaries, fuel and sundries that nothing else in the file carries: without
  // them the analytics show a year of trading with almost no operating costs
  // and a profit figure well over double the truth.
  "ExDetails",
  "ExType",
] as const;

export type LegacyTable = (typeof LEGACY_TABLES)[number];

// Postgres-safe staging table name for each source table.
export function stagingTableName(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export const STAGING_SCHEMA = "staging";

// The walk-in counter account. 2,398 invoices sit on it. It is not a person and
// must not become a Client row.
export const LEGACY_WALKIN_CUSTOMER_ID = 1;

// Titles typed into the name field with no separating space ("Dr.Rana Merhej").
// The trailing \. is load-bearing: without it this also eats the real client
// name "Engrid Saad".
export const LEGACY_TITLE_PREFIX = /^(dr|mr|mrs|miss|eng|sheikh|messrs)\.\s*/i;

// Pet names were typed into the client "notes" box with no house style.
export const PET_NAME_SEPARATORS = /[\n\r/&,]|\s+-\s+/;

// Words that appear where a pet name should be. These describe the animal
// instead of naming it, so the pet is imported unnamed and flagged.
export const PET_NON_NAMES = new Set([
  "cat",
  "cats",
  "dog",
  "dogs",
  "kitten",
  "kittens",
  "puppy",
  "puppies",
  "bird",
  "birds",
  "rabbit",
  "turtle",
  "hamster",
  "big cats",
  "grey",
  "bichon",
  "persian",
  "shirazi",
  "maltese",
  "husky",
  "poodle",
]);

// Classifying the old product list into clinic services versus retail stock is
// done in three passes, because a single keyword list gets it badly wrong:
// "snap cat chicken pate 400g" is food, not a SNAP test, and "crispy crunch
// dental cat 60g" is a chew, not dental surgery.

// 1. Things only ever done to an animal. These win outright, even when the name
//    carries a weight, because that weight is the animal's ("castration female
//    dog 10-20kg") rather than a pack size.
// Always retail regardless of what else matches: a travel kennel is not kennel
// cough, and a brush is not a grooming appointment.
export const LEGACY_SERVICE_EXCLUSIONS =
  /kennel|carrier|cage|brush|slicker|comb|powder|shampoo|towel|bone\b|treat/i;

export const LEGACY_STRONG_SERVICE: ReadonlyArray<[string, RegExp]> = [
  ["Surgery", /castrat|spay|neuter|surger|operation|caesar|suture/i],
  ["Consultation", /\bvisit\b|consult|checkup|check up/i],
  ["Diagnostics", /\bx-?ray\b|\becho\b|ultrasound/i],
  ["Grooming", /\bshower\b|nail trim|clipping/i],
];

// 2. A pack size means it is something sold off a shelf: 400g, 1.5kg, 750ml,
//    6.2cm. Checked only after the rules above, so real procedures survive.
export const LEGACY_PACK_SIZE = /\d+\s?(?:g|kg|mg|ml|l|cm|mm)\b/i;

// 3. Remaining clinical vocabulary. Diagnostics is tested before Vaccination so
//    that "rabies test" is a test rather than a vaccination.
export const LEGACY_SERVICE_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  [
    "Diagnostics",
    /\btest\b|titer|snap(?!\s)|fiv|felv|panleukopenia|calici|babesia|\bfip\b|cbc|certificate/i,
  ],
  [
    "Vaccination",
    /rabies|chppi|chhppil|dhpp|tricat|crp|nobivac|puppy dp|lepto/i,
  ],
  ["Parasite control", /deworm|ivermec/i],
];

export const LEGACY_DISCOUNT_SERVICE_ID = -1;
export const LEGACY_UNKNOWN_SERVICE_ID = -2;

// The old product catalogue numbered its categories but shipped no lookup table
// of names, so the numbers come across as-is for the clinic to rename. Anything
// not listed here keeps its number.
export const LEGACY_CATEGORY_NAMES: Record<string, string> = {};

// ── Opening balances ─────────────────────────────────────────────────────
// The date the imported opening balances are stated as at. The GT_Data26 file's
// own activity runs 2026-01-03 to 2026-08-17, so anything carried forward was
// already true before it opens, and this is the latest date that is provably
// true of all of it.
//
// It is NOT a year end and must not be described as one anywhere staff can
// read: an account can be opened with a balance on any date, and plenty of
// clinics never close their balances on 1 January.
export const LEGACY_OPENING_BALANCE_DATE = "2026-01-01";

// Named on every opening balance row so the figure can be traced to the exact
// column it came from once Access is read-only and nobody remembers.
export const LEGACY_OPENING_BALANCE_SOURCE =
  "GT_Data Access system, Suppliers.BBack";
export const LEGACY_OPENING_BALANCE_SOURCE_CLIENT =
  "GT_Data Access system, CustomerWholesale.BBack";

// The old file keeps credit notes in a table of their own, CreditNote, whose
// ids start again at 1 and so collide with CustInvoiceID. A credit note that
// becomes an invoice here is given legacy_id = this base + its CnID, which
// keeps the column unique and keeps the seed idempotent: a rebuild updates the
// same six rows rather than adding six more. The base is far above the highest
// CustInvoiceID in the file (about 20,400 as at the 2026-09-05 export) and the
// gap is deliberate, so the two never meet however long Access ran.
export const LEGACY_CREDIT_NOTE_ID_BASE = 900_000;

// The same trick for a settlement: a charge posted to close an account whose
// documents and agreed balance disagree for a reason nothing in the old file
// records. Keyed on the CLIENT's legacy id rather than a document id, because
// there is at most one per account, which is what makes a rebuild update the
// same row instead of stacking a second settlement on top.
export const LEGACY_SETTLEMENT_ID_BASE = 950_000;

// ── Running costs ────────────────────────────────────────────────────────
// Every imported expense lands in one category rather than being sorted into
// the app's own. The old system's ExType is a mix of two axes: "Salary" and
// "Rent" are cost kinds, but "vet Expenses", "Grooming Expenese" and "pet shop
// expenese" are departments, and their contents are mixed (an x-ray sits beside
// syringes). Worse, the type field is not even reliable for the kinds: all 11
// rent payments are filed under "pet shop expenese" and "Salary", and the
// "Rent" type has zero rows, so mapping by type would report a clinic that pays
// no rent. The detail that would settle it is free-text transliterated Arabic
// on only 255 of 488 rows.
//
// So: one bucket, correctly dated, nothing invented. The period totals and the
// trend are exactly right, which is what the profit figure needs, and staff can
// re-file any row in the app.
export const LEGACY_EXPENSE_CATEGORY = "Legacy";

// ExDetails.ExpAmount is the USD figure and already resolves the currency:
// verified as Dollar + LL/DollarRate on all 488 rows, the clinic having paid
// some expenses in cash LBP at 90,000. Never sum Dollar and LL directly.
export const LEGACY_EXPENSE_AMOUNT_NOTE =
  "Imported from the Access system, ExDetails";

// Below this, the old system's balance columns are floating-point residue like
// -5.4e-06 rather than money. Anything smaller is treated as zero.
export const LEGACY_BALANCE_EPSILON = 0.01;

// The old system's SaleCreateDate column was added partway through the year and
// backfilled: 2,271 of 7,771 invoices carry this one identical stamp, including
// every invoice from January to March. It is a real creation time only for rows
// written after it, so anything equal to it is treated as absent.
export const LEGACY_SALE_CREATE_BACKFILL = "03/23/26 13:35:40";
