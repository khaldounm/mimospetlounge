// One deployment serves one clinic. Which one is decided at build time by
// NEXT_PUBLIC_CLINIC_ID, and everything that differs between clinics lives in
// the profile it selects (see @/constants/clinics). Anything not in this shape
// is shared code and must behave identically for every clinic.

export type ClinicId = "mimo" | "nadine";

// A raster logo for the PDF renderer, which only decodes PNG and JPEG. Width
// and height are the slot it is drawn into, in PDF points, and should keep the
// source file's aspect ratio or the lockup comes out squashed.
export interface PdfLogo {
  src: string;
  width: number;
  height: number;
}

// The same logo for the browser. Three variants because it sits on three
// different backgrounds: the login card and app bar follow the colour mode,
// while the nav drawer is a dark fill in both modes.
export interface UiLogos {
  onLight: string;
  onDark: string;
  nav: string;
}

export interface ClinicProfile {
  id: ClinicId;
  name: string;
  // IANA timezone. Dates and times render in it regardless of where the server
  // runs (Vercel = UTC).
  timezone: string;
  // Display locale for dates and times, pinned rather than left to each
  // machine's own OS/browser default.
  locale: string;
  logo: PdfLogo;
  logos: UiLogos;
  // One line per entry; blank entries are skipped by every consumer.
  addressLines: readonly string[];
  phone: string;
  email: string;
  website: string;
  // Tax / business registration number. Blank is not printed.
  taxId: string;
  // Payment terms printed at the bottom of every invoice.
  invoiceTerms: string;
  // Width of the counter's roll printer, or null when the clinic prints
  // receipts on an ordinary page printer.
  receiptRollWidthMm: number | null;
  // Product modules this clinic's deployment exposes. A whitelist: anything
  // missing is denied everywhere (nav, pages, API). FEATURES in the environment
  // replaces it wholesale for demos; see @/constants/features.
  modules: readonly string[];
  // Filename prefix of database dumps, local and nightly, so two clinics'
  // backups can share a folder without being confused for one another.
  backupPrefix: string;
}
