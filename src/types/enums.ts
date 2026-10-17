// String-literal unions mirroring the CHECK constraints in the database schema.
// The DB enforces these via CHECK; these types give the app compile-time safety
// and a single source of allowed values for UI dropdowns + Zod validation.

export const PATIENT_SEXES = ["Male", "Female", "Unknown"] as const;
export type PatientSex = (typeof PATIENT_SEXES)[number];

export const RECORD_TYPES = [
  "Consultation",
  "Vaccination",
  "Grooming",
  "Treatment",
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

// The inventory list's expiry filter. "soon" is within EXPIRING_SOON_DAYS and
// not yet past, matching the analytics card.
export const INVENTORY_EXPIRY_FILTERS = ["expired", "soon"] as const;
export type InventoryExpiryFilter = (typeof INVENTORY_EXPIRY_FILTERS)[number];

export const BOOKING_STATUSES = [
  "Scheduled",
  "Confirmed",
  "Checked In",
  "Completed",
  "Cancelled",
  "No Show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// Every type states what happened, and its direction follows from that. Only a
// few carry a sign (see SIGNED_TX_TYPES); the rest are a magnitude, so no
// caller has to remember which way to write the number.
export const INVENTORY_TX_TYPES = [
  "Received",
  "Used",
  "Sold",
  "Adjusted",
  "Expired",
  // A customer brought goods back. Also what a voided invoice writes, because
  // the stock effect is identical and calling it an adjustment made a reversal
  // indistinguishable from someone correcting a miscount.
  "Returned",
  // Goods went back to the supplier.
  "ReturnedToSupplier",
  // Written off as unsellable, including a return that came back damaged.
  "Damaged",
  // The position an item was carried into this system with. Written once by the
  // legacy import so the ledger foots to a stock count that predates it, and
  // never afterwards: nothing in the app can open a second time.
  "Opening",
] as const;
export type InventoryTxType = (typeof INVENTORY_TX_TYPES)[number];

// The types whose quantity carries a sign. Everything else is a magnitude whose
// direction the type already fixes.
//
// Adjusted is signed because a count correction is the only movement that can
// genuinely go either way. Returned and Damaged are signed because a document
// that wrote them can be voided, and a void has to undo each movement exactly:
// an invoice can hold lines in both directions at once (the customer brings the
// 20kg bag back and takes the 15kg one), and a returned item that was written
// off moved stock twice. Forcing a magnitude on these would push half of a
// cancelled exchange the wrong way and quietly corrupt stock.
export const SIGNED_TX_TYPES: readonly InventoryTxType[] = [
  "Adjusted",
  "Returned",
  "Damaged",
  // Signed because an opening can be negative: where the old system recorded
  // more sales than purchases for an item, the honest carried-in position is
  // below zero and saying so is what flags the gap.
  "Opening",
];

// What the manual stock dialog offers.
//
// Returned, ReturnedToSupplier and Damaged are deliberately absent. The first
// two carry a document link and a money side, and writing one as a bare stock
// poke would move the shelf without touching the invoice or the supplier
// balance. Damaged is absent for a second reason: it is signed, so a magnitude
// typed into a plain quantity box would ADD the write-off instead of taking it
// off. A write-off with no document behind it is what Expired is for.
export const MANUAL_TX_TYPES: readonly InventoryTxType[] = [
  "Received",
  "Used",
  "Sold",
  "Adjusted",
  "Expired",
];

// Lifecycle of a reorder sheet. Draft is the "future order" the low-stock
// basket fills; Placed means sent to the supplier; Partial means some of it has
// arrived and the rest is still expected; Received means fully settled, whether
// everything turned up or the order was closed short. Cancelled is terminal and
// never touches stock.
export const PURCHASE_ORDER_STATUSES = [
  "Draft",
  "Placed",
  "Partial",
  "Received",
  "Cancelled",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const INVOICE_STATUSES = [
  "Draft",
  "Issued",
  "Partial",
  "Paid",
  "Overdue",
  "Void",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// Currencies that can be tendered. USD is the ledger currency; LBP is display
// and cash only, always converted at the invoice's frozen rate.
export const CURRENCIES = ["USD", "LBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const PAYMENT_METHODS = [
  "Cash",
  "Card",
  "Bank Transfer",
  "Other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const NOTIFICATION_CHANNELS = ["WhatsApp", "SMS", "Email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = [
  "Pending",
  "Sent",
  "Delivered",
  "Failed",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

// Lifecycle states for a recall reminder. Open recalls surface in the
// Notifications tabs; Done / Dismissed are terminal and hidden. The time bucket
// (due / upcoming / overdue) is derived from the due date, not stored here.
export const REMINDER_STATUSES = ["Open", "Done", "Dismissed"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const AUDIT_ACTIONS = ["INSERT", "UPDATE", "DELETE"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Triage lifecycle for inbound website contact messages. New on arrival, Read
// once a staff member opens it, Archived when handled.
export const CONTACT_MESSAGE_STATUSES = ["New", "Read", "Archived"] as const;
export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUSES)[number];

// Where a partner accrual came from. Mirrors the partner_accruals_source CHECK.
export const ACCRUAL_SOURCES = ["service", "guarantee"] as const;
export type AccrualSource = (typeof ACCRUAL_SOURCES)[number];
