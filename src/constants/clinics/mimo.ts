import type { ClinicProfile } from "@/types/clinic";

export const MIMO: ClinicProfile = {
  id: "mimo",
  name: "Mimo's Pet Lounge",
  timezone: "Asia/Beirut",
  // "en-US" matches the 12-hour clock the reminders already send (see
  // lib/notifications.ts). The counter PC rendered 14:30 while other machines
  // rendered 02:30 PM off the identical deploy until this was pinned.
  locale: "en-US",
  // The wide lockup, not the square mark: an invoice header is a wide slot, and
  // the square one was being drawn into it at 170x52, squashing it flat.
  // Dimensions hold the source 1628x601 ratio.
  logo: { src: "/clinics/mimo/logo-wide.png", width: 170, height: 63 },
  logos: {
    onLight: "/clinics/mimo/logo.webp",
    onDark: "/clinics/mimo/logo-white.webp",
    nav: "/clinics/mimo/logo-wide-white.webp",
  },
  addressLines: [
    "Qabershmoun",
    "Basetine main road",
    "Aley, Mount-Lebanon",
    "Lebanon",
  ],
  phone: "Mobile: 81 949 367",
  email: "mimospetlounge@gmail.com",
  website: "",
  taxId: "",
  invoiceTerms:
    "Payment is due by the date shown above. Please reference the invoice number with your payment. Thank you for your business.",
  // A thermal roll printer sits at the counter; see utils/print-document.ts
  // for why the page has to be sized to the slip.
  receiptRollWidthMm: 72,
  modules: [
    "patients", // clients and patients
    "clinical",
    "bookings",
    "invoices", // also gates Services, which has no permission of its own
    "payments",
    "notifications",
    "users",
    "audit",
    "inventory",
    "orders", // purchase orders and suppliers
    "payables", // supplier balances, statements and payments
    "partners",
    "costs",
    "analytics",
    // Off: "messages", the website contact form. Mimo has no website form.
  ],
  backupPrefix: "mimos",
};
