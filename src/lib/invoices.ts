import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  componentCost,
  serviceCostTotal,
  toCostComponentDTO,
  type CostComponentRow,
} from "@/lib/services";
import { ApiError } from "@/lib/api";
import { applyStockMovementTx, isStockCheckViolation } from "@/lib/inventory";
import { looseConfigOf, looseLine, minLooseQuantity } from "@/utils/inventory";
import { computePartnerPayable, effectiveRates } from "@/lib/partners";
import { toDateOnly } from "@/utils/format";
import { CLINIC_USE_COST_CATEGORY } from "@/constants/running-cost";
import { clinicToday } from "@/lib/register";
import {
  absorbRoundingOvershoot,
  buildTenderLegs,
  type Tender,
} from "@/lib/payments";
import { INVOICE_STATUSES, SIGNED_TX_TYPES } from "@/types/enums";
import type {
  InvoiceDTO,
  InvoiceLineItemDTO,
  InvoiceListItemDTO,
  PaymentDTO,
  ServiceDTO,
} from "@/types/entities";
import type {
  InventoryTxType,
  InvoiceStatus,
  PaymentMethod,
} from "@/types/enums";
import { CURRENCY } from "@/constants/clinic";

// What an invoice with no client is called everywhere it is shown.
export const WALK_IN_NAME = "Walk-in";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const HUNDRED = D(100);

// Human-facing invoice number. The DB has no separate number column, so the
// immutable invoice_id is the canonical number, zero-padded for display.
export function formatInvoiceNumber(invoiceId: number): string {
  return `INV-${String(invoiceId).padStart(5, "0")}`;
}

// ---- Row shapes ----

type ServiceRow = {
  serviceId: number;
  name: string;
  category: string | null;
  price: Prisma.Decimal;
  isActive: boolean;
  description: string | null;
  partnerId: number | null;
  partnerCostPct: Prisma.Decimal | null;
  partnerProfitPct: Prisma.Decimal | null;
  // Both optional so a caller that only needs id/name/price (the invoice line
  // picker) can skip the joins rather than pay for figures it discards.
  partner?: { name: string } | null;
  costComponents?: CostComponentRow[];
};

// Which of a service's figures this caller is allowed to receive. An object
// rather than two positional booleans: they are both booleans, they gate
// different things, and at a call site `false, true` says nothing.
export interface ServiceVisibility {
  deal: boolean; // partners:read  (who performs it and their cut)
  cost: boolean; // orders:read    (what performing it costs the clinic)
}

type LineItemRow = {
  lineItemId: number;
  invoiceId: number;
  serviceId: number | null;
  itemId: number | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  looseQty: Prisma.Decimal | null;
  looseUnit: string | null;
  isHidden: boolean;
};

type PaymentRow = {
  paymentId: number;
  // Null when the payment sits on the client's account without being applied
  // to a specific invoice.
  invoiceId: number | null;
  amount: Prisma.Decimal;
  currency: string;
  amountOriginal: Prisma.Decimal;
  fxRate: Prisma.Decimal | null;
  method: string | null;
  reference: string | null;
  paidAt: Date;
  notes: string | null;
};

type InvoiceRow = {
  needsReview: boolean;
  reviewNote: string | null;
  invoiceId: number;
  clientId: number | null;
  bookingId: number | null;
  status: string;
  subtotal: Prisma.Decimal;
  discountPct: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxPct: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  adjustment: Prisma.Decimal;
  total: Prisma.Decimal;
  issuedAt: Date | null;
  dueDate: Date | null;
  fxRate: Prisma.Decimal | null;
  vetHoldAt: Date | null;
  attendingVetId: number | null;
  notes: string | null;
  createdAt: Date;
  client: {
    firstName: string;
    lastName: string;
    phone: string | null;
    accountBalance: Prisma.Decimal;
  } | null;
  attendingVet: { firstName: string; lastName: string } | null;
  lineItems: LineItemRow[];
  payments: PaymentRow[];
};

type InvoiceListRow = {
  invoiceId: number;
  status: string;
  total: Prisma.Decimal;
  issuedAt: Date | null;
  dueDate: Date | null;
  vetHoldAt: Date | null;
  client: { firstName: string; lastName: string } | null;
  payments: { amount: Prisma.Decimal }[];
};

// Includes that produce the rows above.
export const invoiceInclude = {
  // accountBalance rides along so the printed copies and the WhatsApp message
  // can show what the client owes overall. It is one column on a row already
  // being joined, so it costs nothing extra.
  client: {
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      accountBalance: true,
    },
  },
  attendingVet: { select: { firstName: true, lastName: true } },
  lineItems: { orderBy: { lineItemId: "asc" } },
  payments: { orderBy: { paidAt: "asc" } },
} as const;

export const invoiceListInclude = {
  client: { select: { firstName: true, lastName: true } },
  payments: { select: { amount: true } },
} as const;

// ---- Money math ----

export interface InvoiceMoneyShape {
  // A percentage off, the original and still the default mode.
  discountPct: Prisma.Decimal;
  // A discount typed as money instead. Only one of the two is ever non-zero,
  // enforced by invoices_one_discount_mode.
  discountAmount: Prisma.Decimal;
  taxPct: Prisma.Decimal;
  // A signed nudge applied after tax, to land the invoice on a round figure.
  adjustment: Prisma.Decimal;
}

export interface InvoiceTotals {
  subtotal: Prisma.Decimal;
  // What the discount actually came to in money, whichever way it was typed.
  // Derived rather than stored: the printed copy needs the figure, and working
  // it back out of a percentage at every call site is how they drift apart.
  discountValue: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
}

// Compute the frozen money snapshot from line totals + the invoice's discount,
// tax and adjustment. All values rounded to 2 dp.
//
// lineTotals must already exclude hidden lines: a hidden line is consumed by
// the clinic, not sold, so it never reaches the subtotal. See issueInvoice.
export function computeTotals(
  lineTotals: Prisma.Decimal[],
  money: InvoiceMoneyShape,
): InvoiceTotals {
  const subtotal = lineTotals
    .reduce((sum, lt) => sum.plus(lt), D(0))
    .toDecimalPlaces(2);

  // Percentage and flat amount are two ways of saying the same thing, so they
  // collapse to one figure here and everything downstream reads that.
  //
  // The flat amount is clamped to what there is to discount. A document whose
  // returns outweigh its sales has a NEGATIVE subtotal, and an unclamped "$10
  // off" on one would hand the customer ten dollars more back than they paid.
  const discountValue = money.discountAmount.isZero()
    ? subtotal.times(money.discountPct).dividedBy(HUNDRED).toDecimalPlaces(2)
    : Prisma.Decimal.min(
        money.discountAmount,
        Prisma.Decimal.max(subtotal, D(0)),
      ).toDecimalPlaces(2);

  const taxable = subtotal.minus(discountValue);
  const taxAmount = taxable
    .times(money.taxPct)
    .dividedBy(HUNDRED)
    .toDecimalPlaces(2);
  // The adjustment lands last, after tax, because it exists to make the figure
  // the customer actually pays a round one.
  const total = taxable
    .plus(taxAmount)
    .plus(money.adjustment)
    .toDecimalPlaces(2);

  return { subtotal, discountValue, taxAmount, total };
}

// One discount typed two ways. Setting either mode clears the other, so a row
// can never carry both and leave whoever reads it guessing which one applied.
// The zod schema already refuses two non-zero values; this is what makes
// SWITCHING mode work, since the dialog sends only the mode it is in.
export function discountPatch(data: {
  discountPct?: number;
  discountAmount?: number;
}): { discountPct?: number; discountAmount?: number } {
  if (data.discountAmount !== undefined && data.discountAmount > 0) {
    return { discountAmount: data.discountAmount, discountPct: 0 };
  }
  if (data.discountPct !== undefined && data.discountPct > 0) {
    return { discountPct: data.discountPct, discountAmount: 0 };
  }
  // Nothing to switch to: clear only what was actually sent, so an update that
  // never mentions the discount leaves it alone.
  return {
    ...(data.discountPct !== undefined
      ? { discountPct: data.discountPct }
      : {}),
    ...(data.discountAmount !== undefined
      ? { discountAmount: data.discountAmount }
      : {}),
  };
}

function sumPaid(payments: { amount: Prisma.Decimal }[]): Prisma.Decimal {
  return payments
    .reduce((sum, p) => sum.plus(p.amount), D(0))
    .toDecimalPlaces(2);
}

function isOverdue(
  status: string,
  dueDate: Date | null,
  balance: Prisma.Decimal,
): boolean {
  if (status !== "Issued" && status !== "Partial") return false;
  if (!dueDate || balance.lte(0)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dueDate.getTime() < today.getTime();
}

// A hold only means anything on a draft. Issuing does not clear vet_hold_at, so
// the column outlives the hold and reading it raw would leave every overridden
// invoice flagged "still being worked on" forever. The status check is what
// makes the flag true only while it can still change the outcome.
function onVetHold(status: string, vetHoldAt: Date | null): boolean {
  return status === "Draft" && vetHoldAt != null;
}

// ---- DTO mappers ----

// `visible` is required rather than defaulted for the same reason the cost flag
// is on toInventoryItemDTO: an optional gate leaks the day someone adds a call
// site and forgets it, a required one makes the compiler name every caller.
export function toServiceDTO(
  s: ServiceRow,
  visible: ServiceVisibility,
): ServiceDTO {
  const components = s.costComponents ?? [];
  return {
    serviceId: s.serviceId,
    name: s.name,
    category: s.category,
    price: s.price.toFixed(2),
    isActive: s.isActive,
    description: s.description,
    partnerId: visible.deal ? s.partnerId : null,
    partnerName: visible.deal ? (s.partner?.name ?? null) : null,
    partnerCostPct: visible.deal
      ? (s.partnerCostPct?.toString() ?? null)
      : null,
    partnerProfitPct: visible.deal
      ? (s.partnerProfitPct?.toString() ?? null)
      : null,
    costComponents: visible.cost ? components.map(toCostComponentDTO) : null,
    costTotal: visible.cost ? serviceCostTotal(components).toFixed(2) : null,
  };
}

export function toLineItemDTO(l: LineItemRow): InvoiceLineItemDTO {
  return {
    lineItemId: l.lineItemId,
    invoiceId: l.invoiceId,
    serviceId: l.serviceId,
    itemId: l.itemId,
    description: l.description,
    quantity: l.quantity.toString(),
    unitPrice: l.unitPrice.toFixed(2),
    lineTotal: l.lineTotal.toFixed(2),
    looseQty: l.looseQty ? l.looseQty.toString() : null,
    looseUnit: l.looseUnit,
    isHidden: l.isHidden,
  };
}

export function toPaymentDTO(p: PaymentRow): PaymentDTO {
  return {
    paymentId: p.paymentId,
    invoiceId: p.invoiceId,
    amount: p.amount.toFixed(2),
    currency: p.currency,
    amountOriginal: p.amountOriginal.toFixed(2),
    fxRate: p.fxRate ? p.fxRate.toString() : null,
    method: (p.method as PaymentMethod | null) ?? null,
    reference: p.reference,
    paidAt: p.paidAt.toISOString(),
    notes: p.notes,
  };
}

export function toInvoiceDTO(i: InvoiceRow): InvoiceDTO {
  const amountPaid = sumPaid(i.payments);
  const balance = i.total.minus(amountPaid).toDecimalPlaces(2);
  // What the discount came to in money. Recomputed from the frozen subtotal
  // rather than stored, so it always agrees with the total on the same row.
  const discountValue = i.discountAmount.isZero()
    ? i.subtotal.times(i.discountPct).dividedBy(HUNDRED).toDecimalPlaces(2)
    : Prisma.Decimal.min(
        i.discountAmount,
        Prisma.Decimal.max(i.subtotal, D(0)),
      ).toDecimalPlaces(2);
  return {
    invoiceId: i.invoiceId,
    number: formatInvoiceNumber(i.invoiceId),
    clientId: i.clientId,
    // An invoice with no client is a walk-in. Named here rather than at every
    // call site so the PDF, the receipt and the list all say the same thing.
    clientName: i.client
      ? `${i.client.firstName} ${i.client.lastName}`
      : WALK_IN_NAME,
    clientPhone: i.client?.phone ?? null,
    isWalkIn: i.clientId == null,
    bookingId: i.bookingId,
    status: i.status as InvoiceStatus,
    subtotal: i.subtotal.toFixed(2),
    discountPct: i.discountPct.toString(),
    discountAmount: i.discountAmount.toFixed(2),
    discountValue: discountValue.toFixed(2),
    taxPct: i.taxPct.toString(),
    taxAmount: i.taxAmount.toFixed(2),
    adjustment: i.adjustment.toFixed(2),
    total: i.total.toFixed(2),
    amountPaid: amountPaid.toFixed(2),
    balance: balance.toFixed(2),
    clientBalance: i.client ? i.client.accountBalance.toFixed(2) : null,
    issuedAt: i.issuedAt ? i.issuedAt.toISOString() : null,
    dueDate: toDateOnly(i.dueDate),
    fxRate: i.fxRate ? i.fxRate.toString() : null,
    vetHoldAt: i.vetHoldAt ? i.vetHoldAt.toISOString() : null,
    attendingVetId: i.attendingVetId,
    attendingVetName: i.attendingVet
      ? `${i.attendingVet.firstName} ${i.attendingVet.lastName}`
      : null,
    notes: i.notes,
    createdAt: i.createdAt.toISOString(),
    needsReview: i.needsReview,
    reviewNote: i.reviewNote,
    isOverdue: isOverdue(i.status, i.dueDate, balance),
    lineItems: i.lineItems.map(toLineItemDTO),
    payments: i.payments.map(toPaymentDTO),
  };
}

// ---- Invoice list (paged) ----

/**
 * One page of the invoice list.
 *
 * Written as raw SQL rather than a Prisma query for one reason: the amount paid
 * has to be summed by the database. Including `payments` pulled every payment
 * row into Node just to add it up, which on the imported data meant shipping
 * thousands of rows to render twenty-five.
 */
export interface InvoiceListPage {
  invoices: InvoiceListItemDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InvoiceListQuery {
  q?: string;
  status?: string;
  clientId?: number;
  page?: number;
  pageSize?: number;
}

type ListRow = {
  invoice_id: number;
  status: string;
  total: Prisma.Decimal;
  amount_paid: Prisma.Decimal;
  issued_at: Date | null;
  due_date: Date | null;
  vet_hold_at: Date | null;
  // Null on a walk-in, which has no client row to join to.
  first_name: string | null;
  last_name: string | null;
  total_count: bigint;
};

export const INVOICE_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function listInvoices(
  query: InvoiceListQuery = {},
): Promise<InvoiceListPage> {
  const pageSize = Math.min(query.pageSize ?? INVOICE_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = Math.max(query.page ?? 1, 1);
  const offset = (page - 1) * pageSize;

  const status =
    query.status &&
    (INVOICE_STATUSES as readonly string[]).includes(query.status)
      ? query.status
      : null;
  const clientId =
    query.clientId && Number.isInteger(query.clientId) ? query.clientId : null;
  // Matches an invoice number typed with or without its padding ("42", "INV-0042")
  // as well as the client's name.
  const search = query.q?.trim() ? `%${query.q.trim().toLowerCase()}%` : null;
  const searchId = query.q?.trim().replace(/\D/g, "");

  const rows = await prisma.$queryRaw<ListRow[]>`
    SELECT i.invoice_id, i.status, i.total, i.issued_at, i.due_date,
           i.vet_hold_at,
           c.first_name, c.last_name,
           COALESCE(p.paid, 0) AS amount_paid,
           COUNT(*) OVER () AS total_count
    FROM invoices i
    -- LEFT JOIN, not JOIN: a walk-in invoice has no client row, and an inner
    -- join would silently drop every anonymous sale out of the list.
    LEFT JOIN clients c ON c.client_id = i.client_id
    LEFT JOIN LATERAL (
      SELECT SUM(amount) AS paid FROM payments WHERE invoice_id = i.invoice_id
    ) p ON TRUE
    WHERE (${status}::text IS NULL OR i.status = ${status})
      AND (${clientId}::int IS NULL OR i.client_id = ${clientId})
      AND (
        ${search}::text IS NULL
        OR lower(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))
             LIKE ${search}
        OR (${searchId || null}::text IS NOT NULL
            AND i.invoice_id::text = ${searchId || null})
      )
    ORDER BY i.created_at DESC, i.invoice_id DESC
    LIMIT ${pageSize} OFFSET ${offset}`;

  return {
    invoices: rows.map((r) => {
      const paid = D(r.amount_paid).toDecimalPlaces(2);
      const total = D(r.total);
      const balance = total.minus(paid).toDecimalPlaces(2);
      return {
        invoiceId: r.invoice_id,
        number: formatInvoiceNumber(r.invoice_id),
        clientName:
          r.first_name == null && r.last_name == null
            ? WALK_IN_NAME
            : `${r.first_name} ${r.last_name}`,
        status: r.status as InvoiceStatus,
        total: total.toFixed(2),
        amountPaid: paid.toFixed(2),
        balance: balance.toFixed(2),
        issuedAt: r.issued_at ? r.issued_at.toISOString() : null,
        dueDate: toDateOnly(r.due_date),
        isOverdue: isOverdue(r.status, r.due_date, balance),
        onVetHold: onVetHold(r.status, r.vet_hold_at),
      };
    }),
    total: rows.length > 0 ? Number(rows[0]!.total_count) : 0,
    page,
    pageSize,
  };
}

export function toInvoiceListItemDTO(i: InvoiceListRow): InvoiceListItemDTO {
  const amountPaid = sumPaid(i.payments);
  const balance = i.total.minus(amountPaid).toDecimalPlaces(2);
  return {
    invoiceId: i.invoiceId,
    number: formatInvoiceNumber(i.invoiceId),
    clientName: i.client
      ? `${i.client.firstName} ${i.client.lastName}`
      : WALK_IN_NAME,
    status: i.status as InvoiceStatus,
    total: i.total.toFixed(2),
    amountPaid: amountPaid.toFixed(2),
    balance: balance.toFixed(2),
    issuedAt: i.issuedAt ? i.issuedAt.toISOString() : null,
    dueDate: toDateOnly(i.dueDate),
    isOverdue: isOverdue(i.status, i.dueDate, balance),
    onVetHold: onVetHold(i.status, i.vetHoldAt),
  };
}

export function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

// ---- Mutations ----

type Tx = Prisma.TransactionClient;

// Recompute and persist the money snapshot from current line items. Used while
// a draft is edited and again at issue time. The DB generates line_total, so we
// read it back rather than recomputing per line.
export async function recomputeInvoiceTotals(
  tx: Tx,
  invoiceId: number,
): Promise<void> {
  const invoice = await tx.invoice.findUnique({
    where: { invoiceId },
    select: {
      discountPct: true,
      discountAmount: true,
      taxPct: true,
      adjustment: true,
    },
  });
  if (!invoice) throw new ApiError(404, "Invoice not found");

  // Hidden lines are filtered out in SQL rather than summed and subtracted
  // back, so there is one definition of what is on the bill and no way for a
  // caller to forget it.
  const lines = await tx.invoiceLineItem.findMany({
    where: { invoiceId, isHidden: false },
    select: { lineTotal: true },
  });

  const { subtotal, taxAmount, total } = computeTotals(
    lines.map((l) => l.lineTotal),
    invoice,
  );

  await tx.invoice.update({
    where: { invoiceId },
    data: { subtotal, taxAmount, total },
  });
}

// ---- Loose line resolution ----

export interface LooseCapableItem {
  looseUnit: string | null;
  loosePerUnit: Prisma.Decimal | null;
  loosePrice: Prisma.Decimal | null;
}

export interface ResolvedLine {
  quantity: number;
  unitPrice: number | undefined;
  looseQty: number | null;
  looseUnit: string | null;
}

/**
 * Turn what was typed into what the line stores.
 *
 * A loose amount ("2 kg") is converted here rather than in the browser, so the
 * pack quantity that moves stock and the price that bills the customer are both
 * derived from the item's own configuration, in one place, and a caller cannot
 * post a quantity and a price that disagree with each other.
 *
 * A plain pack quantity passes straight through, which is every line that is
 * not sold loose.
 */
export function resolveLine(
  item: LooseCapableItem | null,
  input: { quantity?: number; looseQty?: number; unitPrice?: number },
): ResolvedLine {
  if (input.looseQty === undefined) {
    if (input.quantity === undefined) {
      throw new ApiError(400, "A quantity is required");
    }
    return {
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      looseQty: null,
      looseUnit: null,
    };
  }

  const config = item ? looseConfigOf(item) : null;
  if (!config) {
    throw new ApiError(
      400,
      "This item is not set up to be sold loose. Set its loose unit, pack size and loose price first.",
    );
  }

  const line = looseLine(input.looseQty, config);
  if (!line) {
    throw new ApiError(
      400,
      `The smallest amount that can be sold loose is ${minLooseQuantity(config)} ${config.unit}.`,
    );
  }

  return {
    quantity: line.quantity,
    // Derived, never the caller's: the price has to be the one that makes the
    // line total match what the customer was quoted for this amount.
    unitPrice: line.unitPrice,
    looseQty: input.looseQty,
    looseUnit: config.unit,
  };
}

// Issue a draft: freeze totals, decrement stock for inventory lines (recorded as
// 'Sold' movements referencing this invoice), and lock the invoice. All atomic,
// so an oversell rolls the whole issue back.
// The Sold movement behind each return line, so giving a sale back takes off
// exactly the cost the sale put on rather than today's cost price.
//
// Return lines on one invoice can point at several different sales, so the
// sources are resolved a sale at a time. Within a sale, movements record the
// item and not the line, so duplicate lines for one item pair up in order:
// issueInvoice writes them in line order, and the nth movement for an item
// belongs to the nth line for it. Same pairing voidInvoice relies on.
// The Sold movement a return line gives back, carrying what was frozen on it at
// the time of sale.
interface OriginMovement {
  transactionId: number;
  unitCost: Prisma.Decimal | null;
  quantity: Prisma.Decimal;
  partnerPayable: Prisma.Decimal | null;
  partnerCostPart: Prisma.Decimal | null;
  // How much of the sold line had already come back on earlier, already-issued
  // returns. Lets each return reverse the difference between the cumulative
  // share and the share already reversed, so the parts telescope to exactly the
  // original accrual however many returns it takes.
  priorReturnedQty: Prisma.Decimal;
}

async function originSoldMovements(
  tx: Tx,
  invoiceId: number,
  lines: {
    lineItemId: number;
    quantity: Prisma.Decimal;
    returnedFromLineId: number | null;
  }[],
) {
  const byReturnLine = new Map<number, OriginMovement>();
  const returns = lines.filter(
    (l) => l.quantity.lessThan(0) && l.returnedFromLineId != null,
  );
  if (returns.length === 0) return byReturnLine;

  const sources = await tx.invoiceLineItem.findMany({
    where: { lineItemId: { in: returns.map((l) => l.returnedFromLineId!) } },
    select: { lineItemId: true, invoiceId: true, itemId: true },
  });
  const sourceById = new Map(sources.map((s) => [s.lineItemId, s]));

  const bySourceLine = new Map<
    number,
    Omit<OriginMovement, "priorReturnedQty">
  >();
  for (const sourceInvoiceId of new Set(sources.map((s) => s.invoiceId))) {
    const [sold, sourceLines] = await Promise.all([
      tx.inventoryTransaction.findMany({
        where: {
          referenceType: "invoice",
          referenceId: sourceInvoiceId,
          type: "Sold",
        },
        orderBy: { transactionId: "asc" },
        select: {
          transactionId: true,
          itemId: true,
          unitCost: true,
          // The frozen consignment figures and the quantity they were accrued
          // over, so a return can give back a proportion of what was actually
          // owed rather than re-pricing the goods at today's rates.
          quantity: true,
          partnerPayable: true,
          partnerCostPart: true,
        },
      }),
      tx.invoiceLineItem.findMany({
        where: { invoiceId: sourceInvoiceId, quantity: { gt: 0 } },
        orderBy: { lineItemId: "asc" },
        select: { lineItemId: true, itemId: true },
      }),
    ]);
    const queued = new Map<number, typeof sold>();
    for (const m of sold) {
      const q = queued.get(m.itemId) ?? [];
      q.push(m);
      queued.set(m.itemId, q);
    }
    for (const l of sourceLines) {
      if (l.itemId == null) continue;
      const next = queued.get(l.itemId)?.shift();
      if (next) bySourceLine.set(l.lineItemId, next);
    }
  }

  // What each sold line had already given back before this document. Only
  // invoices that are actually standing count: a draft has booked nothing yet,
  // and a voided one has been reversed.
  const priorGroups = await tx.invoiceLineItem.groupBy({
    by: ["returnedFromLineId"],
    where: {
      returnedFromLineId: { in: returns.map((l) => l.returnedFromLineId!) },
      invoiceId: { not: invoiceId },
      invoice: { status: { notIn: ["Draft", "Void"] } },
    },
    _sum: { quantity: true },
  });
  const priorBySourceLine = new Map(
    priorGroups.map((g) => [
      g.returnedFromLineId!,
      (g._sum.quantity ?? new Prisma.Decimal(0)).abs(),
    ]),
  );

  for (const l of returns) {
    const source = sourceById.get(l.returnedFromLineId!);
    const move = source ? bySourceLine.get(source.lineItemId) : undefined;
    if (move) {
      byReturnLine.set(l.lineItemId, {
        ...move,
        priorReturnedQty:
          priorBySourceLine.get(l.returnedFromLineId!) ?? new Prisma.Decimal(0),
      });
    }
  }
  return byReturnLine;
}

// The share of a sale's frozen consignment accrual that a return gives back.
//
// Scaled by quantity rather than lifted whole, so returning 1 of 3 cancels a
// third. Returns null when the sale cannot be traced or carried no accrual, and
// the caller falls back to pricing the line directly.
//
// `returnedQty` arrives positive (the movement's magnitude); the origin's own
// quantity is negative, being stock that left, so its magnitude is taken too.
function originAccrual(
  origin: OriginMovement | undefined,
  returnedQty: Prisma.Decimal,
): { payable: Prisma.Decimal; costPart: Prisma.Decimal } | null {
  if (!origin || origin.partnerPayable == null) return null;
  const soldQty = origin.quantity.abs();
  if (soldQty.isZero()) return null;

  const prior = origin.priorReturnedQty;
  const cumulative = prior.plus(returnedQty.abs());

  // Reverse the difference between the cumulative share and the share already
  // reversed, rather than this return's share on its own. Rounding each return
  // independently would strand a fraction of a cent on the balance whenever the
  // accrual does not divide evenly by the quantity: three single-unit returns of
  // a $10.00 accrual would give back $3.33 each and leave a penny owed forever.
  // Taking the difference of two rounded cumulative figures makes the parts
  // telescope, and the last one lands on the original accrual exactly.
  const slice = (whole: Prisma.Decimal) => {
    const upTo = (qty: Prisma.Decimal) =>
      whole.times(qty).dividedBy(soldQty).toDecimalPlaces(2);
    return upTo(cumulative).minus(upTo(prior));
  };

  return {
    payable: slice(origin.partnerPayable).negated(),
    costPart: slice(origin.partnerCostPart ?? new Prisma.Decimal(0)).negated(),
  };
}

// Put a return line's goods back, and bin them again if they came back unfit.
//
// Two movements rather than one flagged movement, and never a suppressed one.
// The customer is refunded either way, so a write-off that skipped its stock
// movement would make the loss invisible; writing Returned then Damaged keeps
// "returned 12 this month, wrote off 3" answerable from the movement table
// alone. The Damaged movement names the Returned one as what it undoes, so it
// eats the very stock just put back instead of picking FEFO and quietly moving
// the loss onto a different lot.
async function applyReturnLineTx(
  tx: Tx,
  params: {
    invoiceId: number;
    line: {
      lineItemId: number;
      itemId: number | null;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      returnRestock: boolean | null;
      returnLotNumber: string | null;
      returnExpiryDate: Date | null;
      item: {
        lastCost: Prisma.Decimal | null;
        partnerId: number | null;
        partnerCostPct: Prisma.Decimal | null;
        partnerProfitPct: Prisma.Decimal | null;
        partner: {
          defaultCostPct: Prisma.Decimal;
          defaultProfitPct: Prisma.Decimal;
        } | null;
      } | null;
    };
    origin?: OriginMovement;
    performedBy: number | null;
  },
) {
  const { invoiceId, line, origin, performedBy } = params;
  if (line.itemId == null) return;
  // The line carries the sign; the movement is given a magnitude and the type
  // says which way it goes.
  const quantity = line.quantity.negated();
  // The sale's own frozen cost when it can be traced, so COGS nets to zero.
  // Falling back to the item's cost price keeps an untraceable return (a legacy
  // sale, or stock sold before movements were kept) valued rather than free.
  const unitCost = origin?.unitCost ?? line.item?.lastCost ?? null;

  // Consignment: cancel the share of the accrual that is coming back. Computed
  // from the returned quantity rather than lifted off the original movement, so
  // returning 1 of 3 cancels a third of it.
  let partnerId: number | null = null;
  let partnerPayable: Prisma.Decimal | null = null;
  let partnerCostPart: Prisma.Decimal | null = null;
  if (line.item?.partnerId != null) {
    partnerId = line.item.partnerId;
    const accrued = originAccrual(origin, quantity);
    if (accrued) {
      // Give back a proportion of what the sale actually accrued, taken from the
      // frozen figures on its own movement. Re-pricing the goods here instead
      // would quietly use whatever rates are in force today, so renegotiating a
      // deal between a sale and its return would cancel an amount that was never
      // owed and leave the balance permanently adrift. Void already reverses the
      // frozen figures; this makes a counter return agree with it.
      partnerPayable = accrued.payable;
      partnerCostPart = accrued.costPart;
    } else {
      // No traceable sale (a legacy line, or stock sold before movements were
      // kept). Pricing it at the current rates is the only option left, and is
      // better than giving the goods back for nothing.
      const payable = computePartnerPayable(
        quantity,
        line.unitPrice,
        unitCost ?? 0,
        effectiveRates(line.item, line.item.partner),
      );
      partnerPayable = payable.total.negated();
      partnerCostPart = payable.costPart.negated();
    }
  }

  const { transaction } = await applyStockMovementTx(tx, {
    itemId: line.itemId,
    type: "Returned",
    quantity: quantity.toNumber(),
    unitCost: unitCost?.toNumber(),
    // Frozen at what it sold for, so the movement nets the sale's revenue back
    // out without a join to the invoice.
    salePrice: line.unitPrice,
    partnerId,
    partnerPayable,
    partnerCostPart,
    referenceType: "invoice",
    referenceId: invoiceId,
    notes: `Returned on ${formatInvoiceNumber(invoiceId)}`,
    performedBy,
    allowDeletedItem: true,
    // Confirmed at the counter, pre-filled from the lot the sale drew from. An
    // untracked item ignores both.
    lotNumber: line.returnLotNumber,
    expiryDate: line.returnExpiryDate,
  });

  if (line.returnRestock === false) {
    await applyStockMovementTx(tx, {
      itemId: line.itemId,
      type: "Damaged",
      // Damaged carries a sign so that voiding this document can undo it, which
      // means the write-off has to state its own direction: negative takes the
      // goods straight back off the shelf they were just put on.
      quantity: quantity.negated().toNumber(),
      unitCost: unitCost?.toNumber(),
      referenceType: "invoice",
      referenceId: invoiceId,
      notes: `Written off from the return on ${formatInvoiceNumber(invoiceId)}`,
      performedBy,
      allowDeletedItem: true,
      reverseOf: transaction.transactionId,
    });
  }
}

// A hidden line at issue: stock off the shelf as Used, and its cost filed as a
// running cost so the money shows up in analytics.
//
// Cost, never sale price. A running cost is money the clinic SPENT, and what a
// box of gloves would have sold for is not that. lastCost is the same frozen
// figure a Sold movement would have carried into COGS.
//
// The running cost is a real row rather than something analytics derives from
// the Used movement. That keeps the spend visible on the running-costs list
// where the clinic already looks for it, puts it in the same categories as
// everything else, and leaves the analytics query untouched. It is also why
// consumables stop needing to be typed in by hand at month end.
async function applyHiddenLineTx(
  tx: Tx,
  params: {
    invoiceId: number;
    line: {
      lineItemId: number;
      itemId: number | null;
      description: string;
      quantity: Prisma.Decimal;
    };
    item: {
      name: string;
      lastCost: Prisma.Decimal | null;
      partnerId: number | null;
    } | null;
    performedBy: number | null;
  },
): Promise<void> {
  const { invoiceId, line, item, performedBy } = params;

  // A consigned item belongs to the partner until it sells, and the payout is
  // worked out from the sale price. A hidden line has no sale price, so there
  // is nothing to work the payout out from and the clinic would quietly consume
  // stock it still owes somebody for.
  if (item?.partnerId != null) {
    throw new ApiError(
      400,
      `"${item.name}" is consigned from a partner, so it cannot be used in the clinic on an invoice. Take it off the invoice and record it as a purchase from the partner instead.`,
    );
  }

  await applyStockMovementTx(tx, {
    itemId: line.itemId!,
    type: "Used",
    quantity: line.quantity.toNumber(),
    // unitCost is left out on purpose: applyStockMovementTx defaults a Used
    // movement to the item's lastCost, which is the one place that rule lives.
    referenceType: "invoice",
    referenceId: invoiceId,
    notes: `Used in the clinic on ${formatInvoiceNumber(invoiceId)}`,
    performedBy,
    allowDeletedItem: true,
  });

  // Nothing was paid for it, so there is nothing to expense. An item with no
  // cost on record still moves stock above; it just does not invent a figure.
  const amount = (item?.lastCost ?? D(0))
    .times(line.quantity)
    .toDecimalPlaces(2);
  if (amount.lte(0)) return;

  await tx.runningCost.create({
    data: {
      category: CLINIC_USE_COST_CATEGORY,
      description: line.description.slice(0, 200),
      amount,
      // The day the invoice was issued, as the CLINIC reckons it. Vercel runs in
      // UTC, so a plain new Date() files an evening in Beirut against tomorrow
      // and drops the cost into the wrong month at a month end.
      incurredOn: new Date(`${clinicToday()}T00:00:00.000Z`),
      notes: `Used in the clinic on ${formatInvoiceNumber(invoiceId)}`,
      invoiceLineItemId: line.lineItemId,
      createdBy: performedBy,
    },
  });
}

// Bill one service line: put what it consumed off the shelf, expense it, and
// freeze what the partner who performed it is owed.
//
// The service's cost components are a RECIPE, read here and resolved into real
// movements. Two things follow from that, both deliberate:
//
//   - The recipe is expanded whether or not a partner performed the service. A
//     consultation burns gloves either way, and the stock has to leave the
//     shelf regardless of who takes a cut.
//   - Everything is frozen at this moment. The components are priced at the
//     item's cost TODAY, and the figures written here are never recomputed. A
//     delivery next week re-prices the recipe for the next invoice, not for
//     this one.
//
// A negative line is a service being given back. It accrues negatively, which
// claws the partner's cut back on its own because the sign rides on the
// quantity, and it does NOT put stock back: the gloves were already used, and
// refunding the customer does not un-use them.
async function applyServiceLineTx(
  tx: Tx,
  params: {
    invoiceId: number;
    line: {
      lineItemId: number;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      description: string;
      performedByPartnerId: number | null;
    };
    service: {
      name: string;
      partnerId: number | null;
      partnerCostPct: Prisma.Decimal | null;
      partnerProfitPct: Prisma.Decimal | null;
      partner: {
        defaultCostPct: Prisma.Decimal;
        defaultProfitPct: Prisma.Decimal;
      } | null;
      costComponents: {
        quantity: Prisma.Decimal | null;
        label: string | null;
        amount: Prisma.Decimal | null;
        itemId: number | null;
        item: {
          name: string;
          lastCost: Prisma.Decimal | null;
          partnerId: number | null;
        } | null;
      }[];
    };
    performedBy: number | null;
  },
): Promise<void> {
  const { invoiceId, line, service, performedBy } = params;
  const qty = line.quantity;
  const isReturn = qty.lessThan(0);
  const today = new Date(`${clinicToday()}T00:00:00.000Z`);

  // Per ONE performance. Multiplied by the line quantity below, so a line
  // billing two of something consumes two recipes' worth.
  const unitCost = serviceCostTotal(service.costComponents);

  if (!isReturn) {
    for (const c of service.costComponents) {
      if (c.itemId == null) continue;

      // Same rule, and the same reason, as a hidden line: a consigned item is
      // still the partner's until it sells, and consuming it here would use up
      // stock the clinic still owes somebody for with no sale price to work
      // their payout out from.
      if (c.item?.partnerId != null) {
        throw new ApiError(
          400,
          `"${c.item.name}" is consigned from a partner, so it cannot be part of what "${service.name}" costs. Take it off the service, and record it as a purchase from the partner instead.`,
        );
      }

      await applyStockMovementTx(tx, {
        itemId: c.itemId,
        type: "Used",
        // unitCost is left out on purpose: a Used movement defaults to the
        // item's lastCost, and that rule lives in applyStockMovementTx.
        quantity: c.quantity!.times(qty).toNumber(),
        referenceType: "invoice",
        referenceId: invoiceId,
        notes: `Used performing ${service.name} on ${formatInvoiceNumber(invoiceId)}`,
        performedBy,
        allowDeletedItem: true,
      });
    }

    // The money side, as running costs, which is how every other consumable in
    // this app is expensed. Filed against the SERVICE line, so voiding the
    // invoice retires them through the sweep that already exists.
    //
    // One insert for the whole recipe rather than one per ingredient: the stock
    // movements above have to go one at a time because each mutates the item's
    // stock, but these rows are independent and a ten-item recipe should not
    // cost ten round trips inside the issue transaction.
    const costRows = service.costComponents
      .map((c) => ({
        category: CLINIC_USE_COST_CATEGORY,
        description: (c.item?.name ?? c.label ?? service.name).slice(0, 200),
        amount: componentCost(c).times(qty).toDecimalPlaces(2),
        incurredOn: today,
        notes: `Used performing ${service.name} on ${formatInvoiceNumber(invoiceId)}`,
        invoiceLineItemId: line.lineItemId,
        createdBy: performedBy,
      }))
      .filter((r) => r.amount.greaterThan(0));
    if (costRows.length > 0) {
      await tx.runningCost.createMany({ data: costRows });
    }
  }

  // Who takes the cut: whoever actually performed it, falling back to the
  // partner the service names. No partner means the clinic keeps the lot, which
  // is every service that has not been given one.
  const partnerId = line.performedByPartnerId ?? service.partnerId;
  if (partnerId == null) return;

  // A line override names a partner the SERVICE may not, so the rates cannot
  // always come from the service's own partner. Read the deal in force for
  // whoever is actually being paid.
  const partner =
    line.performedByPartnerId != null &&
    line.performedByPartnerId !== service.partnerId
      ? await tx.partner.findUnique({
          where: { partnerId },
          select: { defaultCostPct: true, defaultProfitPct: true },
        })
      : service.partner;

  const payable = computePartnerPayable(
    qty,
    line.unitPrice,
    unitCost,
    effectiveRates(service, partner),
  );

  await tx.partnerAccrual.create({
    data: {
      partnerId,
      source: "service",
      invoiceId,
      lineItemId: line.lineItemId,
      earnedOn: today,
      revenue: qty.times(line.unitPrice).toDecimalPlaces(2),
      costBasis: unitCost.times(qty).toDecimalPlaces(2),
      amount: payable.total,
      costPart: payable.costPart,
    },
  });
}

export async function issueInvoice(
  invoiceId: number,
  performedBy: number | null,
  // LBP per 1 USD at the moment of issue, frozen onto the invoice.
  fxRate: number,
  // Issuing over a vet hold is deliberate and has to be asked for. The hold is
  // not an absolute block: if the vet forgets to clear it the customer is stood
  // at the counter, so a manager can go over it and the override is audited.
  overrideVetHold = false,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { invoiceId },
        include: {
          lineItems: {
            include: {
              item: {
                select: {
                  name: true,
                  lastCost: true,
                  partnerId: true,
                  partnerCostPct: true,
                  partnerProfitPct: true,
                  partner: {
                    select: { defaultCostPct: true, defaultProfitPct: true },
                  },
                },
              },
              // The recipe and the deal, for the service lines. Costs nothing
              // on an invoice of pure stock lines, where `service` is null on
              // every row.
              service: {
                select: {
                  name: true,
                  partnerId: true,
                  partnerCostPct: true,
                  partnerProfitPct: true,
                  partner: {
                    select: { defaultCostPct: true, defaultProfitPct: true },
                  },
                  costComponents: {
                    orderBy: { componentId: "asc" },
                    select: {
                      quantity: true,
                      label: true,
                      amount: true,
                      itemId: true,
                      item: {
                        select: {
                          name: true,
                          lastCost: true,
                          partnerId: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!invoice) throw new ApiError(404, "Invoice not found");
      if (invoice.status !== "Draft") {
        throw new ApiError(409, "Only draft invoices can be issued");
      }
      if (invoice.lineItems.length === 0) {
        throw new ApiError(400, "Add at least one line item before issuing");
      }
      if (invoice.vetHoldAt != null && !overrideVetHold) {
        throw new ApiError(
          409,
          "A vet is still working on this invoice. Clear the hold, or issue it anyway if you have the authority.",
        );
      }

      // What each return line's original sale actually cost, so giving it back
      // takes the same figure off COGS that the sale put on. Resolved in one
      // pass because return lines on one invoice can point at several different
      // sales.
      const origins = await originSoldMovements(
        tx,
        invoiceId,
        invoice.lineItems,
      );

      for (const line of invoice.lineItems) {
        // A service line bills work, not goods: it has no itemId, so the guard
        // below would skip it entirely. Its cost, its stock and its partner's
        // cut are all resolved from the service's recipe. A hidden service line
        // is not a thing the UI can make (hiding requires an item), so this
        // needs no isHidden branch.
        if (line.serviceId != null && line.service != null) {
          await applyServiceLineTx(tx, {
            invoiceId,
            line,
            service: line.service,
            performedBy,
          });
          continue;
        }
        if (line.itemId == null) continue;
        // Stock is tracked to 2 decimals, so fractional sell quantities
        // (e.g. 0.5 vial, 2.5 ml) decrement stock as-is.
        const qty = line.quantity.toNumber();
        const item = line.item;

        // A hidden line was consumed by the clinic, not sold to the customer.
        // It never reached the subtotal, so there is no revenue, no COGS and no
        // margin to record: the stock leaves as Used and the money side is a
        // running cost, which is how every other consumable is already
        // expensed. See applyHiddenLineTx.
        if (line.isHidden) {
          await applyHiddenLineTx(tx, { invoiceId, line, item, performedBy });
          continue;
        }

        // A negative line is a return: the same document that sells can also
        // take something back, which is how an exchange happens at the counter.
        if (qty < 0) {
          await applyReturnLineTx(tx, {
            invoiceId,
            line,
            origin: origins.get(line.lineItemId),
            performedBy,
          });
          continue;
        }

        // Consigned lines must have a recorded cost: the payout is the partner's
        // cost back plus a share of the profit, so a null lastCost would owe them
        // zero cost back and treat the whole sale as profit. Block the issue so
        // the cost gets set first rather than freezing a wrong accrual.
        if (item?.partnerId != null && item.lastCost == null) {
          throw new ApiError(
            400,
            `Set a last cost on "${item.name}" before issuing: it is consigned from a partner, and the payout is calculated from that cost.`,
          );
        }

        // Consignment: freeze what the clinic owes the sourcing partner for this
        // sale (their cost back + share of profit), mirroring how unitCost is
        // frozen for COGS. Clinic-owned lines leave these null.
        let partnerId: number | null = null;
        let partnerPayable: Prisma.Decimal | null = null;
        let partnerCostPart: Prisma.Decimal | null = null;
        if (item?.partnerId != null) {
          partnerId = item.partnerId;
          const payable = computePartnerPayable(
            line.quantity,
            line.unitPrice,
            item.lastCost ?? 0,
            effectiveRates(item, item.partner),
          );
          partnerPayable = payable.total;
          partnerCostPart = payable.costPart;
        }

        await applyStockMovementTx(tx, {
          itemId: line.itemId,
          type: "Sold",
          quantity: qty,
          // Freeze the item's cost at the moment of sale so COGS (and profit)
          // stay accurate even if the purchase cost changes later.
          unitCost: item?.lastCost?.toNumber(),
          // Freeze what it sold for too, so revenue and margin read from the
          // movement rather than needing a join back to this invoice.
          salePrice: line.unitPrice,
          partnerId,
          partnerPayable,
          partnerCostPart,
          referenceType: "invoice",
          referenceId: invoiceId,
          notes: `Sold on ${formatInvoiceNumber(invoiceId)}`,
          performedBy,
          allowDeletedItem: true,
        });
      }

      await recomputeInvoiceTotals(tx, invoiceId);

      // Re-read the total rather than using the copy loaded before the
      // recompute. That copy was stale even before returns existed, and it is
      // now dangerous: a document whose returns outweigh its sales has a
      // NEGATIVE total, so a stale figure moves the account by the wrong amount
      // and, on a pure return, in the wrong direction.
      const { total } = await tx.invoice.findUniqueOrThrow({
        where: { invoiceId },
        select: { total: true },
      });

      // Raise what the client owes. Without this the account balance only ever
      // fell (payments decrement it), so an unpaid invoice never showed as due
      // and paying one pushed the client into phantom credit. A walk-in has no
      // account for it to land on.
      //
      // A negative total decrements instead, which is the whole money side of a
      // return: it takes the debt down, and takes it below zero into credit when
      // the customer had already settled. Positive means owed, negative means in
      // credit, throughout.
      if (invoice.clientId != null) {
        await tx.client.update({
          where: { clientId: invoice.clientId },
          data: { accountBalance: { increment: total } },
        });
      }

      return tx.invoice.update({
        where: { invoiceId },
        data: {
          status: "Issued",
          issuedAt: new Date(),
          // Freeze the rate the printed LBP figures were computed at, so
          // reprinting this invoice later shows what the customer actually
          // handed over rather than today's rate.
          fxRate,
        },
        include: invoiceInclude,
      });
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (isStockCheckViolation(err)) {
      throw new ApiError(
        409,
        "Issuing would take an inventory item below zero stock",
      );
    }
    throw err;
  }
}

// Void an invoice. Blocked once any payment exists (handle a refund first). If
// the invoice was already issued, the sold stock comes back as 'Returned'
// movements so inventory stays honest.
export async function voidInvoice(
  invoiceId: number,
  performedBy: number | null,
) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { invoiceId },
      include: { lineItems: true, payments: { select: { paymentId: true } } },
    });
    if (!invoice) throw new ApiError(404, "Invoice not found");
    if (invoice.status === "Void") {
      throw new ApiError(409, "Invoice is already void");
    }
    if (invoice.payments.length > 0) {
      throw new ApiError(409, "Cannot void an invoice that has payments");
    }

    // Only issued invoices have moved stock; drafts never did.
    if (invoice.status !== "Draft") {
      // Reverse the MOVEMENTS this invoice wrote, not its lines. Lines had to be
      // paired back to movements by item and ordinal, which held only while one
      // line meant exactly one movement. It no longer does: a return line that
      // came back damaged writes two (Returned, then Damaged), and an exchange
      // writes them in both directions on one document. Reading the movements
      // back makes the reversal exact by construction, and drops the pairing.
      const written = await tx.inventoryTransaction.findMany({
        where: { referenceType: "invoice", referenceId: invoiceId },
        orderBy: { transactionId: "asc" },
        select: {
          transactionId: true,
          itemId: true,
          type: true,
          quantity: true,
          unitCost: true,
          salePrice: true,
          partnerId: true,
          partnerPayable: true,
          partnerCostPart: true,
        },
      });

      for (const m of written) {
        // A sale is undone by the goods coming back, and so is a consumable the
        // clinic used: neither Sold nor Used carries a sign, and both put the
        // stock back on the shelf when the document that took it is cancelled.
        // Everything else this invoice can write is already a signed type and
        // undoes itself, which is exactly why those types carry a sign.
        const type =
          m.type === "Sold" || m.type === "Used"
            ? "Returned"
            : (m.type as InventoryTxType);
        if (!SIGNED_TX_TYPES.includes(type)) {
          throw new ApiError(
            409,
            `This invoice wrote a ${m.type} movement, which cannot be reversed automatically.`,
          );
        }
        await applyStockMovementTx(tx, {
          itemId: m.itemId,
          type,
          // The stored quantity is already signed, so its negation is the exact
          // opposite movement whichever way the original went.
          quantity: m.quantity.negated().toNumber(),
          // Carry the frozen cost and sale price so analytics nets this sale's
          // COGS and revenue back out, and negate the consignment accrual so
          // what the partner was owed is cancelled.
          unitCost: m.unitCost?.toNumber(),
          salePrice: m.salePrice,
          partnerId: m.partnerId,
          partnerPayable: m.partnerPayable?.negated(),
          partnerCostPart: m.partnerCostPart?.negated(),
          referenceType: "invoice",
          referenceId: invoiceId,
          notes: `Reversed by voiding ${formatInvoiceNumber(invoiceId)}`,
          performedBy,
          allowDeletedItem: true,
          // Undo it batch for batch, so a perishable goes back to the exact lot
          // it left rather than opening an undated one that then picks first.
          reverseOf: m.transactionId,
        });
      }
    }

    // Retire the running costs this invoice's hidden lines raised. Soft, like
    // every other financial record here: the row stays, so the audit trail still
    // shows the clinic booked a cost and then cancelled the document behind it.
    // Without this, voiding would put the gloves back on the shelf and leave
    // their cost sitting in the month's operating costs.
    if (invoice.status !== "Draft") {
      await tx.runningCost.updateMany({
        where: {
          invoiceLineItemId: { in: invoice.lineItems.map((l) => l.lineItemId) },
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });

      // And cancel what the service lines accrued to their partners. Soft, so
      // the row keeps its figures and the trail shows an accrual made and then
      // withdrawn. Consigned stock needs nothing here: its accrual is frozen on
      // the movement, and the reversal above already negated it.
      await tx.partnerAccrual.updateMany({
        where: { invoiceId, reversedAt: null },
        data: { reversedAt: new Date() },
      });
    }

    // Voiding an issued invoice takes back what issuing added. Drafts never
    // accrued, and an invoice with payments cannot reach here at all.
    if (invoice.status !== "Draft" && invoice.clientId != null) {
      await tx.client.update({
        where: { clientId: invoice.clientId },
        data: { accountBalance: { decrement: invoice.total } },
      });
    }

    // An offer spent on this invoice goes back to the client unspent. The
    // document is cancelled, so what it consumed was never consumed, and
    // leaving the grant marked used would quietly take a discount away from
    // someone who never received one. Written inline rather than through
    // lib/offers so it stays inside this transaction, and because lib/offers
    // already imports from this file.
    await tx.offerGrant.updateMany({
      where: { redeemedInvoiceId: invoiceId },
      data: { redeemedInvoiceId: null, redeemedAt: null },
    });

    return tx.invoice.update({
      where: { invoiceId },
      data: { status: "Void" },
      include: invoiceInclude,
    });
  });
}

export type { Tender };

// Record a payment and derive the new status. Blocks overpayment and payments
// on non-issued invoices.

export async function recordPayment(
  invoiceId: number,
  data: {
    tenders: Tender[];
    // Cash from the same handover that settles debt OTHER than this invoice.
    // See accountTenders on paymentCreateSchema.
    accountTenders?: Tender[];
    // LBP per 1 USD, used to convert the lira legs.
    fxRate: number;
    method?: PaymentMethod;
    reference?: string;
    paidAt?: Date;
    notes?: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { invoiceId },
      include: {
        payments: { select: { amount: true } },
        client: { select: { accountBalance: true } },
      },
    });
    if (!invoice) throw new ApiError(404, "Invoice not found");
    if (invoice.status !== "Issued" && invoice.status !== "Partial") {
      throw new ApiError(
        409,
        "Payments can only be recorded on issued invoices",
      );
    }

    const alreadyPaid = sumPaid(invoice.payments);
    const balance = invoice.total.minus(alreadyPaid);

    // A document whose returns outweigh its sales has a negative total, so
    // settling it means paying the customer rather than being paid. Everything
    // below works in magnitudes and applies this once, which keeps one code path
    // for both and leaves no branch where a sign can be forgotten.
    const refunding = invoice.total.isNegative();
    const direction = refunding ? -1 : 1;
    if (balance.isZero()) {
      throw new ApiError(
        400,
        refunding
          ? "This return has already been refunded in full."
          : "This invoice is already settled.",
      );
    }

    // Cash arrives as a mix: some dollars, the rest in lira. Each currency is
    // stored as its own row carrying what was handed over and the rate used, so
    // the drawer can be counted at close, while `amount` stays the USD
    // equivalent that settles the invoice.
    const fxRate = D(data.fxRate);
    if (fxRate.lte(0)) throw new ApiError(400, "Invalid exchange rate");

    // At least one leg has to land on the invoice itself. Settling only the
    // account from this route would leave an untouched invoice being restatused
    // below on a zero movement, and there is a dedicated route for money that
    // belongs to the account alone.
    const legs = buildTenderLegs(data.tenders, fxRate, direction);
    if (legs.length === 0) throw new ApiError(400, "Enter an amount");

    // Compared as magnitudes inside the helper, so a refund of exactly the
    // credit is not rejected for overshooting in the negative direction.
    let amount = legs.reduce((sum, l) => sum.plus(l.usd), D(0));
    amount = absorbRoundingOvershoot(legs, amount, balance, direction);
    if (amount.abs().gt(balance.abs())) {
      throw new ApiError(
        400,
        refunding
          ? `Refund exceeds the ${balance.abs().toFixed(2)} owed back on this return`
          : `Payment exceeds the outstanding balance of ${balance.toFixed(2)}`,
      );
    }

    // Money from the same handover that clears what the client owed BEFORE this
    // visit. Issuing an invoice already raised the account balance by its total,
    // so the account still contains the invoice being settled here: the debt
    // that can be cleared on top of it is the account MINUS this balance.
    // Without that subtraction the counter could take the invoice twice, once
    // as the invoice and again as the account.
    const accountLegs = buildTenderLegs(data.accountTenders ?? [], fxRate, 1);
    let accountAmount = D(0);
    if (accountLegs.length > 0) {
      // Handing cash back and collecting old debt in one movement has no
      // counter workflow behind it and the two directions would net into a
      // single confusing figure on the drawer.
      if (refunding) {
        throw new ApiError(400, "A refund cannot also settle the account");
      }
      if (invoice.clientId == null || !invoice.client) {
        throw new ApiError(400, "A walk-in has no account to settle");
      }
      const otherDebt = invoice.client.accountBalance.minus(balance);
      accountAmount = accountLegs.reduce((sum, l) => sum.plus(l.usd), D(0));
      // Same one-cent absorption as the invoice leg above.
      accountAmount = absorbRoundingOvershoot(
        accountLegs,
        accountAmount,
        otherDebt,
        1,
      );
      if (accountAmount.gt(otherDebt)) {
        throw new ApiError(
          400,
          otherDebt.lte(0)
            ? "This client has nothing outstanding beyond this invoice"
            : `Account settlement exceeds the ${otherDebt.toFixed(2)} outstanding beyond this invoice`,
        );
      }
    }

    const paidAt = data.paidAt ?? new Date();
    const createLeg = (
      leg: { currency: string; original: Prisma.Decimal; usd: Prisma.Decimal },
      onInvoice: boolean,
    ) =>
      tx.payment.create({
        data: {
          // A payment belongs to the client's account; the invoice link
          // records which visit it was taken against. Null for a walk-in,
          // which has no account, and null on the legs that settle older debt
          // rather than this visit.
          clientId: invoice.clientId,
          invoiceId: onInvoice ? invoiceId : null,
          amount: leg.usd,
          currency: leg.currency,
          amountOriginal: leg.original,
          fxRate: leg.currency === CURRENCY.code ? null : fxRate,
          method: data.method ?? null,
          reference: data.reference,
          paidAt,
          notes: data.notes,
        },
      });

    const payments = [];
    for (const leg of legs) payments.push(await createLeg(leg, true));
    // Recorded against the account with no invoice link, which is what keeps
    // them out of this invoice's paid total while still counting as cash taken
    // for the drawer and for collected revenue.
    const accountPayments = [];
    for (const leg of accountLegs)
      accountPayments.push(await createLeg(leg, false));

    const newPaid = alreadyPaid.plus(amount);
    // "Settled" means the whole total has been handed over, in whichever
    // direction it points. A plain gte would read a part-paid refund as fully
    // settled the moment the first note left the drawer.
    const settled = refunding
      ? newPaid.lte(invoice.total)
      : newPaid.gte(invoice.total);
    const status: InvoiceStatus = settled ? "Paid" : "Partial";
    await tx.invoice.update({ where: { invoiceId }, data: { status } });

    // Keep the client's running account balance in step: taking money in
    // reduces what they owe. The balance can go negative, which is the client
    // sitting in credit.
    //
    // A refund is a negative amount, so this decrement increments, and handing
    // the cash back correctly puts the debt it had cancelled straight back on
    // the account. No branch needed.
    //
    // The account legs come off the same balance: they were validated against
    // what was outstanding beyond this invoice, so the two together can never
    // take it below zero on a single handover.
    if (invoice.clientId != null) {
      await tx.client.update({
        where: { clientId: invoice.clientId },
        data: { accountBalance: { decrement: amount.plus(accountAmount) } },
      });
    }

    const updated = await tx.invoice.findUnique({
      where: { invoiceId },
      include: invoiceInclude,
    });
    return { invoice: updated!, payments, accountPayments };
  });
}
