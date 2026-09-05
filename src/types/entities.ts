// Serializable DTOs passed from server components to client components and
// returned by the JSON API. Dates are ISO strings (or YYYY-MM-DD for date-only
// columns) so they survive JSON / RSC serialization without surprises.
import type {
  BookingStatus,
  ContactMessageStatus,
  InventoryTxType,
  InvoiceStatus,
  NotificationChannel,
  NotificationStatus,
  PaymentMethod,
  PurchaseOrderStatus,
  RecordType,
} from "./enums";
import type { SupplierSettlementKind } from "@/constants/supplier";
import type { OfferDiscountMode } from "@/constants/offers";

export interface ClientDTO {
  clientId: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  patientCount?: number;
  // Present only on the detail view, which is the one place the money is shown.
  // Positive means the client owes the clinic.
  accountBalance?: string;
  // What they owed before the new system took over, and the date that was true
  // as at. Already included in accountBalance, never added to it.
  openingBalance?: OpeningBalanceDTO | null;
  // Set by the legacy .mdb import when a value needs a human to confirm it.
  needsReview: boolean;
  reviewNote: string | null;
}

// The balance an account was opened with. Immutable, and shown so an account
// that starts partway through its own history still reconciles.
export interface OpeningBalanceDTO {
  amount: string;
  asOfDate: string;
  source: string;
}

export interface PatientDTO {
  patientId: number;
  clientId: number;
  name: string;
  species: string | null;
  breed: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  isNeutered: boolean;
  microchipId: string | null;
  notes: string | null;
  clientName?: string;
  // Set by the legacy .mdb import when a value needs a human to confirm it.
  needsReview: boolean;
  reviewNote: string | null;
}

export interface BookingDTO {
  bookingId: number;
  patientId: number;
  patientName: string;
  clientId: number;
  clientName: string;
  staffId: number | null;
  staffName: string | null;
  typeId: number | null;
  typeName: string | null;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  notes: string | null;
}

export interface StaffOption {
  userId: number;
  label: string;
}

export interface BookingTypeOption {
  typeId: number;
  name: string;
  durationMinutes: number;
}

export interface PatientOption {
  patientId: number;
  label: string;
}

export interface ClinicalRecordDTO {
  recordId: number;
  recordType: RecordType;
  subcategory: string | null;
  title: string;
  notes: string | null;
  details: Record<string, unknown> | null;
  // Vitals at the visit, as strings like every other Decimal in a DTO. Null
  // when nothing was taken, which is most groomings and boosters.
  temperature: string | null; // degrees Celsius
  weight: string | null; // kilograms
  performedAt: string;
  nextDueDate: string | null;
  performerName: string | null;
}

// A patient's complete clinical history plus the owner details, assembled for
// the shareable medical record PDF. Built once server-side (see
// @/lib/medical-record) so the download and the WhatsApp attachment are the
// same document.
export interface MedicalRecordDTO {
  patient: PatientDTO;
  clientName: string;
  clientPhone: string | null;
  records: ClinicalRecordDTO[];
  /** ISO timestamp the document was produced, printed in the footer. */
  generatedAt: string;
}

// Lightweight option used in the Add Record dialog to populate the
// subcategory dropdown from the services table (source of truth for procedures).
export interface ServicePickerOption {
  serviceId: number;
  name: string;
  category: string | null;
}

// Decimal columns are serialized as strings to avoid float rounding and to keep
// RSC payloads made of plain values only.
export interface InventoryItemDTO {
  itemId: number;
  name: string;
  category: string | null;
  barcode: string | null;
  unit: string | null;
  currentStock: number;
  reorderLevel: number;
  salePrice: string | null;
  lastCost: string | null;
  // Consignment: the sourcing partner (null = clinic-owned) and the agreed
  // profit-share %, which falls back to the partner default when unset.
  partnerId: number | null;
  partnerName: string | null;
  partnerCostPct: string | null; // per-item override, null = use partner default
  partnerProfitPct: string | null; // per-item override, null = use partner default
  // Purchasing: the company this item is usually reordered from. Advisory only
  // and independent of the partner fields.
  supplierId: number | null;
  supplierName: string | null;
  // For a tracked item this is the soonest expiry still on the shelf, taken
  // from its batches. For everything else it is the item's own date.
  expiryDate: string | null;
  // Perishable: captures a lot and expiry at delivery and picks
  // first-expiring-first on sale.
  tracksExpiry: boolean;
  // Loose selling: how a broken-open pack is asked for and priced. All three
  // are set together or all null, and null means the item is only sold whole.
  looseUnit: string | null;
  loosePerUnit: string | null;
  loosePrice: string | null;
  notes: string | null;
  isLowStock: boolean;
  isExpired: boolean;
  // Set by the legacy .mdb import when a value needs a human to confirm it.
  needsReview: boolean;
  reviewNote: string | null;
}

export interface InventoryTransactionDTO {
  transactionId: number;
  itemId: number;
  type: InventoryTxType;
  quantity: number;
  unitCost: string | null;
  // Frozen on a Sold movement (and its void reversal), null on every other type.
  salePrice: string | null;
  referenceType: string | null;
  referenceId: number | null;
  notes: string | null;
  performedAt: string;
  performerName: string | null;
}

export interface ServiceDTO {
  serviceId: number;
  name: string;
  category: string | null;
  price: string;
  isActive: boolean;
  description: string | null;
  // The partner who performs it and their agreed cut. All four are null for a
  // caller without partners:read, not just for a service nobody partners on:
  // the rates state the clinic's margin, so they are stripped in the mapper the
  // way item cost is. See canSeePartnerDeal.
  partnerId: number | null;
  partnerName: string | null;
  partnerCostPct: string | null; // per-service override, null = partner default
  partnerProfitPct: string | null; // per-service override, null = partner default
  // What performing it costs the clinic, and what that figure is made of. Both
  // null (not empty, not zero) for a caller without orders:read: an itemised
  // cost discloses exactly what an item's lastCost does, so it takes the same
  // gate. See canSeeCost.
  costComponents: ServiceCostComponentDTO[] | null;
  costTotal: string | null;
}

// One ingredient of a service's cost. Either an item line (itemId, quantity) or
// a flat line (label, amount), never both, matching the DB CHECK.
export interface ServiceCostComponentDTO {
  componentId: number;
  itemId: number | null;
  itemName: string | null;
  quantity: string | null;
  label: string | null;
  amount: string | null;
  // The money this row contributes, resolved server-side: an item line is
  // quantity x the item's current lastCost, so it moves when stock re-prices.
  lineCost: string;
}

// One day in a partner's month: whether they were here, what their work earned,
// and what the guarantee adds on top.
export interface PartnerDayDTO {
  date: string; // YYYY-MM-DD
  attended: boolean;
  earned: string; // service accruals that day
  minimum: string | null; // null when the partner is on no guarantee
  // What settling adds, or what it added if the day is already settled. Frozen
  // once settled, so it stops tracking later corrections.
  topUp: string;
  settled: boolean;
}

export interface InvoiceLineItemDTO {
  lineItemId: number;
  invoiceId: number;
  serviceId: number | null;
  itemId: number | null;
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  // Set when the line was sold loose. What the customer asked for ("2" and
  // "kg"), for display only: quantity above is still packs and is what moved
  // the stock.
  looseQty: string | null;
  looseUnit: string | null;
  // Consumed by the clinic during the visit rather than sold: gloves, pads, a
  // syringe. Left out of the subtotal and off every printed copy. Its cost
  // reaches analytics as a running cost when the invoice is issued.
  isHidden: boolean;
}

// One line of an issued invoice, seen from the counter that is about to take
// some of it back. quantityReturnable is what is left after everything already
// claimed against this line, so the same tin cannot come back twice.
export interface ReturnableLineDTO {
  lineItemId: number;
  description: string;
  itemId: number | null;
  serviceId: number | null;
  unitPrice: string;
  quantitySold: string;
  quantityReturned: string;
  quantityReturnable: string;
  // Set when the sale was loose, so the dialog can label the quantity in the
  // units the customer bought in.
  looseUnit: string | null;
  // Perishables have to go back into a dated lot. These are the lot the sale
  // drew from, offered as the default so taking a return is a confirmation
  // rather than a lookup.
  tracksExpiry: boolean;
  suggestedLotNumber: string | null;
  suggestedExpiryDate: string | null;
}

export interface ReturnableInvoiceDTO {
  invoiceId: number;
  number: string;
  clientId: number | null;
  clientName: string;
  status: InvoiceStatus;
  issuedAt: string | null;
  lines: ReturnableLineDTO[];
}

export interface PaymentDTO {
  paymentId: number;
  invoiceId: number | null;
  // Always the USD equivalent, which is what settles the invoice.
  amount: string;
  // What was physically handed over and in which currency. For a USD payment
  // these are the same figure and fxRate is null.
  currency: string;
  amountOriginal: string;
  fxRate: string | null;
  method: PaymentMethod | null;
  reference: string | null;
  paidAt: string;
  notes: string | null;
}

// Full invoice with its lines + payments, for the detail view.
export interface InvoiceDTO {
  invoiceId: number;
  number: string;
  // Null on a walk-in: an anonymous counter sale belongs to no account.
  clientId: number | null;
  // "Walk-in" when there is no client, so callers never have to special-case
  // the display name.
  clientName: string;
  clientPhone: string | null;
  isWalkIn: boolean;
  bookingId: number | null;
  status: InvoiceStatus;
  subtotal: string;
  discountPct: string;
  // A discount typed as money instead of a percentage. Only one of the two is
  // ever non-zero.
  discountAmount: string;
  // What the discount came to in money, whichever way it was typed. Derived, so
  // no caller has to work it back out of a percentage.
  discountValue: string;
  taxPct: string;
  taxAmount: string;
  // Signed nudge applied after tax to land the total on a round figure.
  adjustment: string;
  total: string;
  amountPaid: string;
  balance: string;
  // What the client owes across their WHOLE account, not just this invoice.
  // Carried on the DTO so the printed copies and the WhatsApp message can show
  // it without each one going back to the database for it. Null on a walk-in,
  // which has no account.
  clientBalance: string | null;
  issuedAt: string | null;
  dueDate: string | null;
  // LBP per 1 USD, frozen when the invoice was issued. Null on a draft, which
  // uses the current rate until it is issued.
  fxRate: string | null;
  // Set while a vet is still working on this invoice. Reception can see it and
  // issuing over it takes an explicit override.
  vetHoldAt: string | null;
  attendingVetId: number | null;
  attendingVetName: string | null;
  notes: string | null;
  createdAt: string;
  isOverdue: boolean;
  lineItems: InvoiceLineItemDTO[];
  payments: PaymentDTO[];
  // Set by the legacy .mdb import when a value needs a human to confirm it.
  needsReview: boolean;
  reviewNote: string | null;
}

// ── Notifications ─────────────────────────────────────────
export interface NotificationTemplateDTO {
  templateId: number;
  name: string;
  channel: NotificationChannel | null;
  triggerEvent: string | null;
  body: string;
  isActive: boolean;
}

export interface NotificationDTO {
  notificationId: number;
  clientId: number;
  clientName: string;
  patientId: number | null;
  patientName: string | null;
  bookingId: number | null;
  templateId: number | null;
  templateName: string | null;
  channel: NotificationChannel | null;
  recipient: string;
  body: string;
  status: NotificationStatus;
  retryCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

// One row of the audit trail. auditId is a BigInt in the DB, serialized as a
// string so it survives JSON.
export interface AuditLogDTO {
  auditId: string;
  userId: number | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: number;
  changes: unknown;
  createdAt: string;
}

// A staff/user account. Never carries the password hash. `canManageUsers`
// flags whether the user's role grants users:write (i.e. is an admin), used to
// surface lockout guard rails in the UI.
export interface UserDTO {
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  roleId: number;
  roleName: string;
  isActive: boolean;
  canManageUsers: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// A selectable role for the user form's role picker.
export interface RoleOption {
  roleId: number;
  name: string;
}

// One row of the permission matrix: a module, and the catalogue permissions that
// stand for reading and writing it. Either can be null, because not every module
// has both halves (payments is write only, the audit log is read only).
export interface PermissionMatrixRow {
  module: string;
  label: string;
  hint?: string;
  readPermission: string | null;
  writePermission: string | null;
}

// The whole matrix in one payload: the columns, the rows, and which permissions
// each role currently holds. Grants are keyed by roleId as a string, because a
// JSON object cannot have numeric keys.
export interface PermissionMatrixDTO {
  roles: RoleOption[];
  rows: PermissionMatrixRow[];
  grants: Record<string, string[]>;
}

// An upcoming booking within the reminder window, with the status of its
// reminder notification (if one has been created from the reminder template).
export interface UpcomingBookingDTO {
  bookingId: number;
  clientId: number;
  clientName: string;
  patientName: string;
  startsAt: string;
  bookingStatus: BookingStatus;
  reminderStatus: NotificationStatus | null;
  reminderNotificationId: number | null;
  // The booking's free-text note. Carried so the Upcoming tab can read a
  // SENDAT marker out of it (see parseSendAtNote) and show the send time the
  // note asks for next to the Send button.
  notes: string | null;
}

// A past booking that was never completed (still Scheduled / Confirmed, or a
// No Show). Surfaced in the Missed tab so staff can send a follow-up message.
export interface MissedBookingDTO {
  bookingId: number;
  clientId: number;
  clientName: string;
  patientId: number;
  patientName: string;
  startsAt: string;
  bookingStatus: BookingStatus;
}

// An open recall reminder (Vaccination or Grooming) whose due date is
// approaching or already past. Surfaced in the Vaccinations / Grooming tabs so
// staff can send a recall message, snooze, or dismiss it. One row per patient
// per type (their active recall, materialised in the reminders table).
export interface DueRecordDTO {
  reminderId: number;
  recordType: RecordType;
  title: string; // vaccine name / "Full groom", etc.
  patientId: number;
  patientName: string;
  clientId: number;
  clientName: string;
  nextDueDate: string; // "YYYY-MM-DD"
  isOverdue: boolean;
  followUpSentAt: string | null; // ISO timestamp, null if no follow-up sent yet
}

// ── Analytics ─────────────────────────────────────────────
// Aggregate figures for the dashboard. Money values are plain numbers (already
// rounded to 2dp) rather than the string-Decimal convention used elsewhere,
// because they feed charts and KPI cards, not authoritative records.

export interface NamedCount {
  label: string;
  count: number;
}

export interface NamedValue {
  label: string;
  value: number;
}

// A closed date range, both bounds inclusive, each as "YYYY-MM-DD". Drives the
// time-boxable analytics sections.
export interface AnalyticsRange {
  from: string;
  to: string;
}

export interface RevenueAnalytics {
  periodCollected: number; // payments received within the range
  periodInvoiced: number; // value issued within the range
  outstandingTotal: number; // unpaid balance across open invoices, as of today
  avgInvoiceValue: number; // mean total of invoices issued within the range
  voidRate: number; // voided / issued within the range, as a percentage
  aging: {
    current: number; // not yet due
    d1to30: number;
    d31to60: number;
    d61plus: number;
  };
  trend: { label: string; collected: number; outstanding: number }[]; // bucketed by issue date over the range
  byService: NamedValue[]; // top services by billed revenue within the range
}

// One client on the top or lapsed list. Both lists carry the same fields so a
// download reads the same whichever it came from; each table on screen shows
// only the columns its own question needs.
export interface ClientActivityRow {
  clientId: number;
  name: string;
  phone: string | null;
  email: string | null;
  invoices: number; // invoices issued to them inside the range
  billed: number; // billed to them inside the range
  lifetimeBilled: number; // billed to them ever, up to the range end
  accountBalance: number; // positive means they owe the clinic
  // "YYYY-MM-DD" of their last invoice or booking as at the range end, or null
  // for a client who has never been billed and never had an appointment.
  lastActivity: string | null;
}

export interface ClientsAnalytics {
  totalActive: number; // clients on file now, a snapshot rather than a period
  newInPeriod: number; // clients added inside the range
  lapsed: number; // active clients with no invoice and no booking in the range
  totalPatients: number;
  avgPatientsPerClient: number;
  newTrend: NamedCount[]; // new clients per bucket across the range
  speciesMix: NamedCount[]; // patient species distribution
  // Null, rather than empty, for a reader who may see the analytics module but
  // not client records. The counts above are aggregates and stay visible; these
  // name people, so they follow patients:read.
  topClients: ClientActivityRow[] | null; // highest billed in the range
  lapsedClients: ClientActivityRow[] | null; // most recently seen first
  tradingCount: number; // how many clients were billed anything in the range
}

export interface InventoryAnalytics {
  totalItems: number; // count of active inventory items
  // What the CLINIC paid for the stock on the shelf: every item at cost, less
  // any part of it a partner fronted and takes back on the sale. A partner deal
  // does not on its own mean the stock was the partner's money, and at this
  // clinic's 0% cost rate none of it is: the clinic buys the stock and the
  // partner takes a cut of the margin.
  stockCost: number;
  // How much of the shelf sits under a partner deal, and where the shelf's
  // margin would land. These state the clinic's markup outright, so they are
  // null (not zero) for a caller without orders:read, the same gate an item's
  // lastCost takes everywhere else. See canSeeCost.
  //
  // Three of them hold this identity, which is what the card shows:
  //
  //   stockCost + clinicProfit + partnerShare === retailValue
  //
  // consignedCost is not one of them, only a footnote saying how much of the
  // cost line is stock a partner earns on.
  consignedCost: number | null; // stock under a partner deal, at cost
  clinicProfit: number | null; // margin the clinic would keep on the lot
  // The whole payout owed to partners were the consigned stock to sell, and how
  // much of it is their outlay returning rather than earnings. At a 0% cost
  // rate the second is zero and the payout is pure profit share; at 100% it is
  // the outlay coming back with the profit split on top.
  partnerShare: number | null;
  partnerShareCostPart: number | null;
  retailValue: number | null; // the whole shelf at its sale price
  // Items on the shelf with no cost, and none with no sale price, on file. The
  // figures above treat a missing one as zero rather than guessing, so these
  // say how much of the shelf the card is quiet about.
  itemsMissingCost: number | null;
  itemsMissingPrice: number | null;
  lowStockCount: number;
  outOfStockCount: number;
  expiringSoonCount: number; // within 30 days
  lowStockItems: {
    itemId: number;
    name: string;
    currentStock: number;
    reorderLevel: number;
    unit: string | null;
  }[];
  outOfStockItems: {
    itemId: number;
    name: string;
    unit: string | null;
  }[];
}

export interface BookingsAnalytics {
  periodCount: number; // bookings within the range
  noShowRate: number; // within the range, percentage
  cancellationRate: number; // within the range, percentage
  completedRate: number; // within the range, percentage
  volumeTrend: NamedCount[]; // bookings bucketed over the range
  statusMix: NamedCount[]; // booking status distribution within the range
  byWeekday: NamedCount[]; // bookings per weekday within the range
}

export interface ProfitAnalytics {
  periodRevenue: number; // payments collected within the range
  periodCogs: number; // cost the clinic itself funded on items sold in the range
  // Everything partners EARNED in the range, all three ways: their cut of stock
  // sold, of services they performed, and any guaranteed day topped up. Not what
  // was paid out to them. Settling a partner moves cash against a balance this
  // already charged, so payouts are deliberately not read here.
  periodPartnerCost: number;
  periodCosts: number; // running (operating) costs incurred within the range
  periodProfit: number; // revenue minus COGS minus partner earnings minus operating costs
  // Value of stock that left without being sold, over the range. Reported for
  // visibility and deliberately NOT subtracted from periodProfit: consumables
  // are expensed through running costs, so charging them here as well would
  // count the same stock twice.
  periodClinicUse: number; // stock consumed in the clinic (Used movements)
  periodWriteOffs: number; // stock binned (Expired movements)
  // Bucketed over the range: collected revenue, COGS, partner earnings, operating
  // costs, net profit.
  trend: {
    label: string;
    revenue: number;
    cogs: number;
    partnerCost: number;
    costs: number;
    profit: number;
  }[];
  byCategory: NamedValue[]; // costs split by category (incl. COGS + partner earnings) within the range
}

// Cash out to suppliers. Deliberately separate from ProfitAnalytics and never
// folded into it: the clinic recognises stock cost as COGS when the item sells,
// so buying stock moves cash without touching profit. Adding purchases to the
// profit figure would count the same stock twice.
export interface PurchasesAnalytics {
  periodBilled: number; // orders that became Received within the range
  periodPaid: number; // payments dated within the range
  periodOrderCount: number; // orders that became Received within the range
  // As of now, not range-scoped. A balance is a position, not a flow.
  owedNow: number; // sum of positive supplier balances
  // The two figures behind owedNow, each reported whole rather than as a share
  // of it. owedOpening is the balances the accounts were opened with, which do
  // not age and are never allocated against later payments; owedThisYear is
  // what trading since has left outstanding on its own. They do NOT sum to
  // owedNow: owedNow nets the two together per supplier first, so an account
  // that has overpaid this year absorbs its own opening balance instead of
  // adding to the total.
  owedOpening: number;
  owedThisYear: number;
  creditNow: number; // sum of negative balances, as a positive figure
  inProgressNow: number; // value of orders placed but not yet fully delivered
  trend: { label: string; billed: number; paid: number }[];
  bySupplier: NamedValue[]; // top suppliers by amount billed within the range
}

// ── Category performance (period over period) ────────────────
//
// Billed, never collected. A payment settles an invoice, not a line, so there
// is no honest way to attribute cash to a category; these figures are line
// totals on invoices issued within the window. That is why they will not tie to
// the Collected KPI in the revenue section.
export interface CategoryTrendRow {
  label: string;
  current: number; // billed within the selected range
  prior: number; // billed within the comparison window
  delta: number; // current - prior
  // Growth as a percentage, or null when the prior window billed nothing (or
  // net-negative) and there is no base to grow from. Null is not zero: it means
  // there is no meaningful percentage, and the UI says so instead of printing
  // one.
  percent: number | null;
}

// A business line (products, vet, grooming) with its constituent categories.
export interface CategoryTrendGroup extends CategoryTrendRow {
  key: string;
  rows: CategoryTrendRow[];
}

export interface CategoryComparison {
  priorRange: AnalyticsRange; // the window `prior` was measured over
  total: CategoryTrendRow; // every group combined
  groups: CategoryTrendGroup[];
}

// Both comparisons are computed together so the toggle needs no refetch and the
// two views can never disagree about the current period.
export interface CategoriesAnalytics {
  mom: CategoryComparison; // against the same dates one month earlier
  yoy: CategoryComparison; // against the same dates one year earlier
}

// ── Per-item performance ──────────────────────────────────
//
// How one stock item actually traded over a window, read off the invoice lines
// rather than off stock movements: a line is what the customer was charged, and
// it is the only place a return carries the money back as well as the units.
//
// Sold and returned are kept as separate positive figures instead of one net
// number, because "sold 40, gave 12 back" and "sold 28" are the same net and
// very different items. A return line carries a negative quantity (see
// InvoiceLineItem.returnedFromLineId), so the split is simply the sign.
//
// Billed, never collected: a payment settles an invoice, not a line, so cash
// cannot be attributed to an item. Same rule as the category section.
export interface ItemPerformanceRow {
  itemId: number;
  name: string;
  category: string | null;
  unit: string | null;
  barcode: string | null;
  unitsSold: number; // units on positive lines, in stocking units
  unitsReturned: number; // units given back, as a positive figure
  netUnits: number; // unitsSold - unitsReturned
  grossRevenue: number; // billed on positive lines
  refunded: number; // credited back on return lines, as a positive figure
  netRevenue: number; // grossRevenue - refunded
  saleLines: number; // positive lines, i.e. how many times it was sold
  returnLines: number;
  // Returned units as a percentage of units sold, or null when nothing sold in
  // the window and there is no base to divide by.
  returnRate: number | null;
}

// One item's row plus everything the detail view adds: where it stands now, and
// how it traded across the window.
export interface ItemPerformanceDetail extends ItemPerformanceRow {
  currentStock: number;
  salePrice: number | null;
  invoiceCount: number; // distinct invoices it appeared on
  clientCount: number; // distinct clients who bought it
  lastSoldAt: string | null; // issue date of the most recent sale in the window
  avgUnitPrice: number | null; // netRevenue / netUnits, null when netUnits is 0
  trend: { label: string; sold: number; returned: number; revenue: number }[];
}

// A predictive-search hit for the item picker. Deliberately thin: the search
// runs on every keystroke, and the performance figures only get computed once
// an item is actually chosen.
export interface ItemSearchResult {
  itemId: number;
  name: string;
  category: string | null;
  barcode: string | null;
  unit: string | null;
}

// The leaderboard card inside the Inventory section. A specific item is looked
// up on demand through its own endpoint, so opening Inventory never pays for a
// search nobody asked for.
export interface ItemsAnalytics {
  topSold: ItemPerformanceRow[];
}

// ── Running costs (operating expenses) ────────────────────
export interface RunningCostDTO {
  costId: number;
  category: string;
  description: string; // the specific item/line, e.g. "Electricity"
  amount: string; // money as a string (Decimal convention)
  incurredOn: string; // "YYYY-MM-DD"
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
}

// One calendar month that has running costs logged, for the period rail above
// the list. Totals come from the same grouped query that finds the months, so
// the rail can show what each month cost without a second pass.
export interface CostMonthDTO {
  year: number;
  month: number; // 0-11, matching Date's month index
  total: string; // money as a string (Decimal convention)
  count: number;
}

// ── Partners (outsourced / consignment inventory) ─────────
// A partner fronts the cost of certain inventory items; on sale the clinic owes
// them their cost back plus a share of the profit. Stats (earned/paid/balance)
// are optional so the same DTO serves both the list (with stats) and pickers.
// A company the clinic buys stock from. Distinct from a partner: the clinic
// pays a supplier and owns the goods outright, with no profit share.
// What the clinic owes a supplier and what it has settled. Kept apart because
// the clinic buys both on the spot and on credit, so neither figure can be
// derived from the other.
//
// An order counts as invoiced once it reaches Received, meaning fully delivered
// or closed short. Orders still in Draft, Placed or Partial are shown as in
// progress and are deliberately not counted as owed: the supplier has not
// finished delivering, so there is no bill yet.
export interface SupplierMoneyDTO {
  // The balance the account was opened with. "0.00" when there was none.
  openingBalance: string;
  // The date that balance was struck, which is not necessarily a year end:
  // an account can be opened with a balance on any date. Null when there is
  // no opening balance to date.
  openingBalanceAsOf: string | null;
  invoiced: string; // total of Received orders
  paid: string; // cash paid to the supplier
  // Settled by credit note rather than cash: goods sent back, a billing error,
  // a rebate. Reduces the balance exactly as a payment does, and is reported
  // apart from it because no money moved.
  credited: string;
  balance: string; // opening plus invoiced minus everything settled
  inProgress: string; // value of Draft / Placed / Partial orders, not yet owed
  orderCount: number; // Received orders
  openOrderCount: number; // Draft / Placed / Partial
}

// One named person at a supplier. The clinic splits its dealings by product
// line, so a company typically has a food rep, a medication rep and whoever
// settles the account, each with their own number.
export interface SupplierContactDTO {
  contactId: number;
  supplierId: number;
  name: string;
  role: string | null; // free label: "Sales rep", "Accounts"
  categories: string[]; // from INVENTORY_CATEGORIES; empty means general
  phone: string | null;
  email: string | null;
  notes: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface SupplierDTO {
  supplierId: number;
  name: string;
  contacts: SupplierContactDTO[];
  // Flattened from the primary contact so the list and the detail header can
  // show one line without walking the array. Null when there are no contacts.
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  itemCount?: number; // inventory items whose usual supplier is this one
  money?: SupplierMoneyDTO;
  createdAt: string;
  // Set by the legacy .mdb import when a value needs a human to confirm it.
  needsReview: boolean;
  reviewNote: string | null;
}

// ---- Supplier statement (accounts payable) ----

// One source document on a supplier's statement, with the account balance as it
// stood immediately after it. Every figure on the statement traces to one of
// these, which is what makes the report auditable.
export interface StatementLineDTO {
  // "opening" is the balance the account was opened with. It is a charge-side
  // row dated whenever that balance was struck, and appears only when the
  // period being viewed reaches back that far.
  kind: "order" | "payment" | "opening";
  date: string;
  reference: string;
  description: string;
  charge: string; // "0.00" on a payment row
  payment: string; // "0.00" on a charge row
  balance: string; // running account balance after this row
  href: string | null;
}

export interface StatementSupplierDTO {
  supplierId: number;
  supplierName: string;
  openingBalance: string;
  billed: string;
  paid: string; // cash out in the period
  // Settled by credit note in the period. Comes off the balance exactly as a
  // payment does, and is reported apart from it because no money moved.
  credited: string;
  closingBalance: string;
  // False if the running balance across the lines does not land on the closing
  // figure, which would mean a document is missing. Surfaced, never hidden.
  ties: boolean;
  // Closing balance split by how long it has been outstanding, keyed by the ids
  // in AGING_BUCKETS. Sums back to closingBalance.
  aging: Record<string, string>;
  lines: StatementLineDTO[];
}

export interface StatementTotalsDTO {
  openingBalance: string;
  billed: string;
  paid: string;
  credited: string;
  closingBalance: string;
  ties: boolean;
  aging: Record<string, string>;
  supplierCount: number;
}

export interface StatementDTO {
  clinicName: string;
  currency: string;
  range: AnalyticsRange;
  asAt: string; // the last day of the period, which balances are stated as at
  generatedAt: string;
  suppliers: StatementSupplierDTO[];
  totals: StatementTotalsDTO;
}

export interface SupplierPaymentDTO {
  paymentId: number;
  supplierId: number;
  // The order this settled, when it was one specific bill rather than a lump
  // sum against the account.
  orderId: number | null;
  orderReference: string | null;
  amount: string;
  paidOn: string;
  // Cash out, or a credit note the supplier issued. See
  // SUPPLIER_SETTLEMENT_KINDS.
  kind: SupplierSettlementKind;
  method: string | null;
  reference: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface PurchaseOrderLineDTO {
  lineId: number;
  orderId: number;
  itemId: number;
  itemName: string;
  unit: string | null;
  // The item's inventory category, matched against a supplier contact's
  // categories so sending an order can preselect the rep who handles it.
  category: string | null;
  currentStock: number;
  reorderLevel: number;
  quantityOrdered: string;
  quantityReceived: string;
  quantityOutstanding: string; // ordered minus received, 0 once the line is complete
  unitCost: string | null;
  lineTotal: string; // quantityOrdered * unitCost, 0 when no cost is set yet
  // Set when the line was keyed in loose units ("200 kg" rather than 10 bags).
  // Display only: quantityOrdered above is still the stocking unit.
  looseQty: string | null;
  looseUnit: string | null;
  // Whether this item wants a lot and expiry captured when it is received.
  tracksExpiry: boolean;
  // Matched against a scanned carton so the scan fills the right line.
  barcode: string | null;
  notes: string | null;
}

// A reorder sheet. supplierId is null for the "No supplier" bucket, which
// collects items that have no usual supplier yet and cannot be placed until one
// is assigned.
// One delivered line of a purchase order, seen from the stockroom that is about
// to send some of it back. Mirrors ReturnableLineDTO on the sales side.
export interface ReturnableDeliveryLineDTO {
  lineId: number;
  itemId: number;
  itemName: string;
  unit: string | null;
  unitCost: string | null;
  quantityReceived: string;
  quantityReturned: string;
  quantityReturnable: string;
}

export interface ReturnableOrderDTO {
  orderId: number;
  supplierId: number | null;
  supplierName: string | null;
  status: PurchaseOrderStatus;
  reference: string | null;
  receivedOn: string | null;
  lines: ReturnableDeliveryLineDTO[];
}

export interface PurchaseOrderDTO {
  orderId: number;
  supplierId: number | null;
  supplierName: string | null;
  // The shelf this sheet is for, from INVENTORY_CATEGORIES. Null on an order
  // created by hand that covers no single product line, and on every order that
  // predates the split. See PurchaseOrder.category.
  category: string | null;
  status: PurchaseOrderStatus;
  reference: string | null;
  orderedOn: string | null;
  receivedOn: string | null;
  discountAmount: string | null;
  shippingAmount: string | null;
  taxRate: string | null;
  taxAmount: string | null;
  notes: string | null;
  lineCount: number;
  // True once at least one line has been delivered but something is still
  // outstanding, which is what puts the order in Partial.
  hasOutstanding: boolean;
  subtotal: string; // sum of the line totals
  taxableBase: string; // subtotal - discount + shipping, what VAT is charged on
  total: string; // taxable base plus tax
  createdByName: string | null;
  createdAt: string;
  lines?: PurchaseOrderLineDTO[];
}

// One delivered bill as the payment and credit pickers need it: enough to name
// it, date it, and cap an allocation at what the bill is worth. Deliberately not
// a PurchaseOrderDTO: the pickers offer every delivered order a supplier ever
// sent, and carrying the full document for each was most of what the supplier
// page weighed.
export interface PayableOrderOption {
  orderId: number;
  reference: string | null;
  receivedOn: string | null;
  total: string;
}

// The money side of a consignment relationship, split so the clinic can tell
// revenue, capital and profit apart rather than seeing one blended number.
//
// The sales figures are scoped to a date range. The balance figures are not:
// what is owed is a running total, and slicing it by month would be meaningless.
export interface PartnerMoneyDTO {
  // What the account was already owed before this database saw any of it, and
  // the date that figure was true as at. Same convention as the client and
  // supplier balances: it is part of what is owed, never added on top of it.
  openingBalance: string;
  openingBalanceAsOf: string | null;
  // --- range-scoped: what their stock did over the selected period ---
  revenue: string; // what customers paid for their items
  costOfSales: string; // their capital in the items that sold, returning to them
  grossProfit: string; // revenue minus cost of sales
  partnerShare: string; // their cut of the profit only, excluding capital back
  clinicShare: string; // what the clinic kept (can be negative on a below-cost sale)
  accrued: string; // costOfSales + partnerShare, the total owed for the period
  unitsSold: string;
  paidInRange: string; // payouts recorded in the period
  // --- position as at the range's end date ---
  // A balance is a point in time, not a span, so these are cumulative up to and
  // including the last day of the range. With a range ending today they equal
  // the all-time figures; with a past range they are the position as it stood.
  // Everything earned up to that date: consigned sales PLUS services performed
  // PLUS days the guarantee topped up. This is the figure `balance` is built
  // from, so it is the one that has to be complete.
  earnedToDate: string;
  // The two non-stock streams, broken out. Range-scoped and cumulative, matching
  // the pattern above. Kept separate from revenue/grossProfit/partnerShare,
  // which describe consigned STOCK only and would stop adding up if services
  // were folded into them.
  serviceEarned: string;
  guaranteeEarned: string;
  serviceEarnedToDate: string;
  guaranteeEarnedToDate: string;
  accrualEarnedInRange: string; // services + guarantee over the range
  paidToDate: string;
  balance: string; // earnedToDate minus paidToDate, the amount owed at that point
  // The balance split into its two halves, which always sum back to it. Payouts
  // are treated as settling capital before profit, so a part-paid partner reads
  // as "your money is back, what is left is your cut".
  capitalOwed: string;
  profitOwed: string;
  profitShareToDate: string; // their cut earned up to that date, paid or not
  capitalDeployed: string; // their money in play then: in stock + recovered
  capitalOnShelf: string; // their money still sitting in unsold stock at that date
  capitalRecoveredToDate: string; // capital freed up by sales, paid out or still owed
  sellThroughPct: string; // share of their capital that had come back through sales
}

export interface PartnerDTO {
  partnerId: number;
  name: string;
  phone: string | null;
  // The two halves of the deal, each a percentage as a string. Cost is what
  // share of the item's cost returns to the partner (100 = their outlay back,
  // above 100 = an agreed uplift); profit is their cut of the sale's upside.
  defaultCostPct: string; // e.g. "100.00"
  defaultProfitPct: string; // e.g. "20.00"
  // The floor for a day they attended. Null means no guarantee.
  dailyMinimum: string | null;
  notes: string | null;
  isActive: boolean;
  itemCount?: number; // consigned items sourced from this partner
  money?: PartnerMoneyDTO;
  createdAt: string;
}

// One of a partner's items, and how it performed over the selected range. Shows
// the clinic which of a partner's lines actually earn and which sit still.
export interface PartnerItemPerformanceDTO {
  itemId: number;
  itemName: string;
  unit: string | null;
  currentStock: number;
  capitalOnShelf: string;
  unitsSold: string;
  revenue: string;
  costOfSales: string;
  grossProfit: string;
  partnerShare: string;
  clinicShare: string;
}

export interface PartnerPayoutDTO {
  payoutId: number;
  partnerId: number;
  amount: string;
  paidOn: string; // "YYYY-MM-DD"
  method: string | null;
  reference: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
}

// One consigned sale (or its void reversal) contributing to a partner's balance.
export interface PartnerEarningDTO {
  transactionId: number;
  performedAt: string;
  type: InventoryTxType;
  itemName: string;
  quantity: string;
  payable: string; // amount owed for this line (negative on a void reversal)
  invoiceNumber: string | null;
}

// ── Website contact messages ──────────────────────────────
// An inbound enquiry submitted through the public marketing site's contact
// form. These are leads, not yet linked to a client record.
export interface ContactMessageDTO {
  messageId: number;
  name: string;
  email: string;
  phone: string | null;
  petName: string | null;
  petType: string | null;
  message: string;
  status: ContactMessageStatus;
  createdAt: string;
}

// Lighter row for the invoices list.
export interface InvoiceListItemDTO {
  invoiceId: number;
  number: string;
  clientName: string;
  status: InvoiceStatus;
  total: string;
  amountPaid: string;
  balance: string;
  issuedAt: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  // True only while a draft is held, so the counter can see which drafts a vet
  // is still adding to without opening each one.
  onVetHold: boolean;
}

// ---- register close ----

// One currency's cash movement through the drawer for a single day. Amounts are
// in that currency, not converted: the drawer is counted in the notes it holds.
export interface RegisterCurrencyLine {
  currency: string;
  taken: string;
  refunded: string;
  net: string;
}

// Money taken that day that never reached the drawer, shown so the staff can
// tell a card day from a short drawer.
export interface RegisterNonCashLine {
  method: string;
  amountUsd: string;
  count: number;
}

export interface RegisterDayDTO {
  date: string;
  // LBP per 1 USD, for reading the two currencies as one figure.
  fxRate: number;
  currencies: RegisterCurrencyLine[];
  nonCash: RegisterNonCashLine[];
  // Payments with no method recorded, counted as cash above. Surfaced so a
  // drawer that does not balance can be traced back to them.
  unspecifiedCount: number;
  unspecifiedUsd: string;
  // The count already filed for this day, if the day has been closed. Null on
  // one nobody has counted yet.
  closing: RegisterClosingDTO | null;
}

// One handful of cash out of the till. Stored as a running cost, so it lands in
// analytics under its own category alongside every other operating cost.
export interface RegisterPayoutDTO {
  costId: number;
  category: string;
  description: string;
  amount: string;
  currency: string;
}

// A day that has been counted and filed. Every figure here is frozen at the
// moment of closing, including the ones the app worked out: a payment corrected
// next week must not turn a day that balanced into a day that did not.
export interface RegisterClosingDTO {
  closingId: number;
  date: string;
  fxRate: number;
  openingUsd: string;
  openingLbp: string;
  takenUsd: string;
  takenLbp: string;
  refundedUsd: string;
  refundedLbp: string;
  paidOutUsd: string;
  paidOutLbp: string;
  expectedUsd: string;
  expectedLbp: string;
  countedUsd: string;
  countedLbp: string;
  // Both drawers together in USD. Positive is over, negative is short.
  varianceUsd: string;
  notes: string | null;
  closedByName: string | null;
  closedAt: string;
  payouts: RegisterPayoutDTO[];
}

// ---- Client statement (accounts receivable) ----

// One item off an invoice, shown only in the detailed statement. Priced as the
// customer was charged, so the figures add up to the invoice line above them.
export interface ClientStatementItemDTO {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  // What the customer actually asked for on a loose line ("2 kg"), when the
  // stocking quantity above would read as a fraction of a pack.
  looseLabel: string | null;
}

export interface ClientStatementLineDTO {
  // "opening" is the balance the account was opened with, a charge-side row
  // dated whenever that balance was struck.
  kind: "opening" | "invoice" | "payment";
  date: string;
  reference: string;
  description: string;
  charge: string; // "0.00" on a payment row
  payment: string; // "0.00" on a charge row
  balance: string; // running account balance after this row
  href: string | null;
  // Payment rows only: how it was settled, and the invoice it was applied to.
  method: string | null;
  appliedTo: string | null;
  // Invoice rows only. Empty in the summary view, which never fetches them.
  items: ClientStatementItemDTO[];
}

export interface ClientStatementDTO {
  clinicName: string;
  currency: string;
  clientId: number;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  range: AnalyticsRange;
  asAt: string; // the last day of the period, which balances are stated as at
  generatedAt: string;
  // What the account stood at the moment the period began: the balance carried
  // in from the old system plus everything billed and paid before `from`.
  broughtForward: string;
  invoiced: string;
  paid: string;
  // broughtForward + invoiced - paid, derived from the lines below.
  closingBalance: string;
  // The figure stored on the client row, which is what the counter collects.
  accountBalance: string;
  // False when the documents on file do not account for the whole balance,
  // which the old system's carried-forward figures make possible. Surfaced,
  // never hidden, and never quietly papered over.
  ties: boolean;
  // closingBalance - accountBalance when they disagree, else "0.00".
  unreconciled: string;
  // The immutable dated row the account was opened with, when it has one. It is
  // ALREADY inside accountBalance and is never added to it.
  openingEntry: { amount: string; asOfDate: string } | null;
  lines: ClientStatementLineDTO[];
}

// ---- Offers ----

// A deal in the catalogue. Money arrives as strings, the string-Decimal
// convention every other DTO follows.
export interface OfferDTO {
  offerId: number;
  name: string;
  discountMode: OfferDiscountMode;
  discountPct: string;
  discountAmount: string;
  notes: string | null;
  /** "YYYY-MM-DD", or null for an offer that runs until it is archived. */
  expiresOn: string | null;
  archived: boolean;
  /** False once expiresOn has passed, or once archived. */
  grantable: boolean;
  /** Live grants outstanding, and grants already spent on an invoice. */
  liveCount: number;
  redeemedCount: number;
}

// One client holding one offer. Carries the offer's terms so a banner or a
// chip can be drawn without a second lookup.
export interface OfferGrantDTO {
  grantId: number;
  offerId: number;
  offerName: string;
  discountMode: OfferDiscountMode;
  discountPct: string;
  discountAmount: string;
  expiresOn: string | null;
  clientId: number;
  clientName: string;
  grantedAt: string;
  grantedByName: string | null;
  /** Set once the grant has been spent. */
  redeemedInvoiceId: number | null;
  redeemedInvoiceNumber: string | null;
  redeemedAt: string | null;
  /** Past its offer's expiry date: still on file, no longer redeemable. */
  expired: boolean;
}

// What a bulk grant did. Clients who already held the offer are reported rather
// than counted as granted, so clicking twice reads as "nothing new" instead of
// as a second discount.
export interface OfferGrantResultDTO {
  granted: number;
  alreadyHeld: number;
  offerName: string;
}
