import type { ClinicProfile } from "@/types/clinic";

export const NADINE: ClinicProfile = {
  id: "nadine",
  name: "Dr Nadine Said Veterinary Clinic",
  timezone: "Asia/Beirut",
  locale: "en-US",
  // Her one lockup is already wide (1280x389); 170x52 keeps that ratio.
  logo: { src: "/clinics/nadine/logo.png", width: 170, height: 52 },
  logos: {
    onLight: "/clinics/nadine/logo.webp",
    onDark: "/clinics/nadine/logo-white.webp",
    nav: "/clinics/nadine/logo-white.webp",
  },
  addressLines: [
    "Qornayel Main road",
    "Near Yehya Hilal Station",
    "Baabda, Mount-Lebanon",
    "Lebanon",
  ],
  phone: "Mobile: 70 121 556",
  email: "",
  website: "https://nadinesaidvetclinic.com",
  taxId: "",
  invoiceTerms:
    "Payment is due by the date shown above. Please reference the invoice number with your payment. Thank you for your business.",
  // No roll printer: receipts go to the default page printer, which is what
  // her deployment did before the clinics shared this code.
  receiptRollWidthMm: null,
  modules: [
    "patients",
    "clinical",
    "bookings",
    "invoices",
    "payments",
    "notifications",
    "users",
    "audit",
    "inventory",
    "orders",
    "payables",
    "partners",
    "costs",
    "analytics",
    "messages", // the contact form on nadinesaidvetclinic.com posts here
  ],
  backupPrefix: "nadine",
};
