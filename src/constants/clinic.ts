// Seller (clinic) identity printed on invoice PDFs.
export const CLINIC = {
  name: "Mimo's Pet Lounge",
  // IANA timezone for the clinic. Used to render dates/times (e.g. appointment
  // reminders) in local time regardless of where the server runs (Vercel = UTC).
  timezone: "Asia/Beirut",
  // Display locale for dates and times. Pinned rather than left to the
  // runtime default, which resolves to each machine's own OS/browser locale:
  // the counter PC rendered 14:30 while other machines rendered 02:30 PM off
  // the identical deploy. "en-US" matches the 12-hour clock the reminders
  // already send (see lib/notifications.ts).
  locale: "en-US",
  // Logo lives in /public. The wide lockup, not the square mark: an invoice
  // header is a wide slot, and the square one was being drawn into it at
  // 170x52, squashing it flat. Dimensions hold the source 1628x601 ratio.
  //
  // PNG rather than the .webp beside it because the PDF renderer only decodes
  // PNG and JPEG.
  logo: { src: "/mimos-logo-wide.png", width: 170, height: 63 },
  // One line per array entry; blank entries are skipped.
  addressLines: [
    "Qabershmoun",
    "Basetine main road",
    "Aley, Mount-Lebanon",
    "Lebanon",
  ],
  phone: "Mobile: 81 949 367",
  email: "mimospetlounge@gmail.com",
  // Blank so it is not printed. Every consumer already skips empty entries, so
  // this keeps the field (and its three call sites) intact rather than deleting
  // the line and leaving the code referencing something that is gone.
  website: "",
  // Tax / business registration number (e.g. EIN, VAT, ABN).
  taxId: "",
} as const;

// ISO 4217 currency code + symbol used on invoices. USD is the ledger
// currency: every stored amount, balance and total is in it.
export const CURRENCY = {
  code: "USD",
  symbol: "$",
} as const;

// Shown alongside USD so a customer paying in lira can read the invoice, and
// tendered at the counter. Never stored as a total; always derived from a USD
// amount and a rate. LBP has no circulating minor unit, so it is whole numbers
// only.
export const SECONDARY_CURRENCY = {
  code: "LBP",
  symbol: "LL",
} as const;

// Smallest note in circulation. Change owed in lira is rounded to a multiple of
// this, because anything finer cannot physically be handed back.
export const LBP_CASH_INCREMENT = 5_000;

// Starting point only, seeded into the settings table by the migration that
// added it. The live value is Admin-editable; see @/lib/settings.
export const DEFAULT_FX_USD_LBP = 89_500;

// Default payment terms / footer note printed at the bottom of the invoice.
export const INVOICE_TERMS =
  "Payment is due by the date shown above. Please reference the invoice number with your payment. Thank you for your business.";
