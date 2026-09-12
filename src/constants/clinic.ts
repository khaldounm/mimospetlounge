// The clinic this deployment serves.
//
// One codebase is deployed once per clinic, each Vercel project with its own
// database and its own NEXT_PUBLIC_CLINIC_ID. The variable is NEXT_PUBLIC_
// because the profile is read in client components and in PDFs rendered in the
// browser; Next inlines it at build time, so every build carries exactly one
// identity and cannot be re-pointed at runtime.
//
// A missing or unknown id throws at module load, which fails the build. That is
// deliberate: a deployment that forgot to say who it is must not quietly come
// up wearing another clinic's name, logo and phone number.
import type { ClinicId, ClinicProfile } from "@/types/clinic";
import { MIMO } from "@/constants/clinics/mimo";
import { NADINE } from "@/constants/clinics/nadine";

export const CLINIC_PROFILES: Readonly<Record<ClinicId, ClinicProfile>> = {
  mimo: MIMO,
  nadine: NADINE,
};

function isClinicId(value: string): value is ClinicId {
  return Object.prototype.hasOwnProperty.call(CLINIC_PROFILES, value);
}

function resolveClinic(): ClinicProfile {
  const raw = process.env.NEXT_PUBLIC_CLINIC_ID ?? "";
  const id = raw.trim().toLowerCase();
  if (!isClinicId(id)) {
    const known = Object.keys(CLINIC_PROFILES).join(", ");
    throw new Error(
      `NEXT_PUBLIC_CLINIC_ID must be one of: ${known}. Got "${raw}". ` +
        "Set it in .env locally and in each Vercel project's environment.",
    );
  }
  return CLINIC_PROFILES[id];
}

// Seller (clinic) identity: printed on invoice PDFs, shown in the shell, and
// the source of the timezone and locale every date on screen is rendered in.
export const CLINIC: ClinicProfile = resolveClinic();

// Default payment terms / footer note printed at the bottom of the invoice.
export const INVOICE_TERMS = CLINIC.invoiceTerms;

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
