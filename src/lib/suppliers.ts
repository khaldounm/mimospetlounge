import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { orderInclude, toPurchaseOrderDTO } from "@/lib/purchase-orders";
import { toDateOnly } from "@/utils/format";
import type {
  PayableOrderOption,
  PurchaseOrderDTO,
  SupplierContactDTO,
  SupplierDTO,
  SupplierMoneyDTO,
  SupplierPaymentDTO,
} from "@/types/entities";
import type {
  SupplierContactInput,
  SupplierCreditInput,
} from "@/schemas/supplier";
import type { SupplierSettlementKind } from "@/constants/supplier";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

// Contacts in the order the form laid them out, so the repeater round-trips
// unchanged and the first row is a stable fallback for the primary.
export const supplierInclude = {
  contacts: { orderBy: [{ sortOrder: "asc" }, { contactId: "asc" }] },
} as const satisfies Prisma.SupplierInclude;

type ContactRow = {
  contactId: number;
  supplierId: number;
  name: string;
  role: string | null;
  categories: string[];
  phone: string | null;
  email: string | null;
  notes: string | null;
  isPrimary: boolean;
  sortOrder: number;
};

// Shape returned by supplier queries. Kept structural (not a Prisma payload
// type) so create/update rows map through the same function.
type SupplierRow = {
  needsReview: boolean;
  reviewNote: string | null;
  supplierId: number;
  name: string;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  contacts: ContactRow[];
};

export function toSupplierContactDTO(c: ContactRow): SupplierContactDTO {
  return {
    contactId: c.contactId,
    supplierId: c.supplierId,
    name: c.name,
    role: c.role,
    categories: c.categories,
    phone: c.phone,
    email: c.email,
    notes: c.notes,
    isPrimary: c.isPrimary,
    sortOrder: c.sortOrder,
  };
}

type SupplierStats = {
  itemCount: number;
  // Omitted for a caller without payables:read. Stripped here rather than in
  // the component so the figures never reach the browser at all.
  money?: SupplierMoneyDTO;
};

export function toSupplierDTO(
  s: SupplierRow,
  stats?: SupplierStats,
): SupplierDTO {
  // Falls back to the first contact so a supplier whose rows predate the
  // primary flag, or one saved outside the form, still shows a line of detail
  // rather than "No contact details" beside a populated list.
  const primary = s.contacts.find((c) => c.isPrimary) ?? s.contacts[0] ?? null;

  const dto: SupplierDTO = {
    supplierId: s.supplierId,
    name: s.name,
    needsReview: s.needsReview,
    reviewNote: s.reviewNote,
    contacts: s.contacts.map(toSupplierContactDTO),
    contactPerson: primary?.name ?? null,
    phone: primary?.phone ?? null,
    email: primary?.email ?? null,
    notes: s.notes,
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
  };
  if (stats) {
    dto.itemCount = stats.itemCount;
    if (stats.money) dto.money = stats.money;
  }
  return dto;
}

export const supplierPaymentInclude = {
  creator: { select: { firstName: true, lastName: true } },
  order: { select: { orderId: true, reference: true } },
} as const;

type PaymentRow = Prisma.SupplierPaymentGetPayload<{
  include: typeof supplierPaymentInclude;
}>;

export function toSupplierPaymentDTO(p: PaymentRow): SupplierPaymentDTO {
  return {
    paymentId: p.paymentId,
    supplierId: p.supplierId,
    orderId: p.orderId,
    orderReference: p.order
      ? p.order.reference || `Order #${p.order.orderId}`
      : null,
    amount: p.amount.toFixed(2),
    paidOn: toDateOnly(p.paidOn) ?? "",
    kind: (p.kind === "Credit"
      ? "Credit"
      : "Payment") as SupplierSettlementKind,
    method: p.method,
    reference: p.reference,
    notes: p.notes,
    createdByName: p.creator
      ? `${p.creator.firstName} ${p.creator.lastName}`
      : null,
    createdAt: p.createdAt.toISOString(),
  };
}

// ---- Contact writes ----

// Replaces a supplier's contact set in one pass: rows carrying a contactId are
// updated, rows without one are created, and anything absent from the array is
// deleted. Runs inside a transaction, since the set is briefly incomplete.
//
// isPrimary is cleared across the supplier before the chosen row is flagged.
// The partial unique index permits one primary at a time, so flagging the new
// one while the old still holds it would collide, and a unique index cannot be
// deferred to the end of the transaction.
export async function writeSupplierContacts(
  tx: Prisma.TransactionClient,
  supplierId: number,
  contacts: SupplierContactInput[],
): Promise<void> {
  const keptIds = contacts
    .map((c) => c.contactId)
    .filter((id): id is number => id !== undefined);

  await tx.supplierContact.deleteMany({
    where: {
      supplierId,
      ...(keptIds.length > 0 ? { contactId: { notIn: keptIds } } : {}),
    },
  });
  await tx.supplierContact.updateMany({
    where: { supplierId },
    data: { isPrimary: false },
  });

  const ids: number[] = [];
  for (const [index, c] of contacts.entries()) {
    const data = {
      name: c.name,
      role: c.role ?? null,
      categories: c.categories,
      phone: c.phone ?? null,
      email: c.email ?? null,
      notes: c.notes ?? null,
      sortOrder: index,
      isPrimary: false,
    };

    // Scoped by supplierId so an id belonging to another supplier cannot be
    // adopted by editing the payload; a miss falls through to a create.
    let id: number | null = null;
    if (c.contactId !== undefined) {
      const updated = await tx.supplierContact.updateMany({
        where: { contactId: c.contactId, supplierId },
        data,
      });
      if (updated.count > 0) id = c.contactId;
    }
    if (id === null) {
      const created = await tx.supplierContact.create({
        data: { ...data, supplierId },
      });
      id = created.contactId;
    }
    ids.push(id);
  }

  // Whichever row the form flagged, else the first: a supplier that has any
  // contacts always has exactly one primary, which is what the list column and
  // the detail header read.
  const flagged = contacts.findIndex((c) => c.isPrimary);
  const primaryId = ids[flagged === -1 ? 0 : flagged];
  if (primaryId !== undefined) {
    await tx.supplierContact.update({
      where: { contactId: primaryId },
      data: { isPrimary: true },
    });
  }
}

// ---- Balance ----

// Statuses whose value counts as billed. Received means the delivery is settled,
// whether everything arrived or the order was closed short. Draft, Placed and
// Partial are still in progress: the supplier has not finished delivering, so
// there is no bill to owe against yet.
const INVOICED_STATUS = "Received";
const OPEN_STATUSES = ["Draft", "Placed", "Partial"];

// What a supplier's order book is worth, split the way the balance needs it.
//
// An order's value matches exactly what the order page shows: lines at the
// quantity ordered, plus the charges. For a fully delivered order that is also
// what arrived. For one closed short it is what was asked for rather than what
// came, so a short-shipped order reads high until its lines are corrected.
export interface SupplierOrderTotals {
  invoiced: Prisma.Decimal;
  orderCount: number;
  inProgress: Prisma.Decimal;
  openOrderCount: number;
}

const NO_ORDERS: SupplierOrderTotals = {
  invoiced: D(0),
  orderCount: 0,
  inProgress: D(0),
  openOrderCount: 0,
};

type OrderTotalsRow = {
  supplier_id: number;
  invoiced: Prisma.Decimal;
  order_count: bigint;
  in_progress: Prisma.Decimal;
  open_order_count: bigint;
};

/**
 * Every supplier's order totals in one grouped query, or one supplier's when an
 * id is given.
 *
 * This used to pull every purchase order with every line so JavaScript could
 * add them up: nine hundred lines across the wire, on both the suppliers list
 * and each supplier page, to produce four numbers per supplier.
 *
 * Summed at full precision rather than rounded per order, because that is what
 * the JavaScript did and the balance is rounded once at the end.
 */
async function orderTotalsBySupplier(
  supplierId?: number,
): Promise<Map<number, SupplierOrderTotals>> {
  // Lines are summed in a lateral before the grouping, so the order-level
  // charges are counted once per order rather than once per line.
  const rows = await prisma.$queryRaw<OrderTotalsRow[]>`
    SELECT o.supplier_id,
           COALESCE(SUM(v.value) FILTER (WHERE o.status = ${INVOICED_STATUS}), 0)
             AS invoiced,
           COUNT(*) FILTER (WHERE o.status = ${INVOICED_STATUS})
             AS order_count,
           COALESCE(SUM(v.value) FILTER (WHERE o.status = ANY(${OPEN_STATUSES})), 0)
             AS in_progress,
           COUNT(*) FILTER (WHERE o.status = ANY(${OPEN_STATUSES}))
             AS open_order_count
    FROM purchase_orders o
    LEFT JOIN LATERAL (
      SELECT COALESCE(l.subtotal, 0)
             - COALESCE(o.discount_amount, 0)
             + COALESCE(o.shipping_amount, 0)
             + COALESCE(o.tax_amount, 0) AS value
      FROM (
        SELECT SUM(quantity_ordered * unit_cost) AS subtotal
        FROM purchase_order_lines
        WHERE order_id = o.order_id
      ) l
    ) v ON TRUE
    WHERE o.deleted_at IS NULL
      AND o.supplier_id IS NOT NULL
      -- One prepared statement serves both the list and a single supplier.
      AND (${supplierId ?? null}::int IS NULL OR o.supplier_id = ${supplierId ?? null})
    GROUP BY o.supplier_id`;

  return new Map(
    rows.map((r) => [
      r.supplier_id,
      {
        invoiced: D(r.invoiced),
        orderCount: Number(r.order_count),
        inProgress: D(r.in_progress),
        openOrderCount: Number(r.open_order_count),
      },
    ]),
  );
}

// `opening` is the balance the account was opened with. It has to be in the
// balance or the figure is not merely incomplete, it has the wrong sign:
// Libanvet was paid 6,886.30 against 6,566.45 of orders and read as 319.85
// "in credit" when an opening balance of 937.53 means 617.68 is owed.
function toMoneyDTO(
  orders: SupplierOrderTotals,
  settled: { paid: Prisma.Decimal; credited: Prisma.Decimal },
  opening: Prisma.Decimal,
  openingAsOf: Date | null,
): SupplierMoneyDTO {
  // Cancelled orders are in neither figure: nothing was delivered and nothing
  // is owed. The query counts only the two statuses that book.
  const { invoiced, inProgress, orderCount, openOrderCount } = orders;

  // Both kinds settle the account, so both come off the balance. They are
  // reported apart because only one of them was money: a credit note reduces
  // what is owed without anything leaving the bank, and adding it to "paid"
  // would have the clinic believe it spent what the supplier wrote off.
  const settledTotal = settled.paid.plus(settled.credited);

  return {
    openingBalance: opening.toFixed(2),
    openingBalanceAsOf: openingAsOf ? toDateOnly(openingAsOf) : null,
    invoiced: invoiced.toFixed(2),
    paid: settled.paid.toFixed(2),
    credited: settled.credited.toFixed(2),
    balance: opening.plus(invoiced).minus(settledTotal).toFixed(2),
    inProgress: inProgress.toFixed(2),
    orderCount,
    openOrderCount,
  };
}

// ---- Reads ----

// All suppliers with item counts and their balance. Inactive suppliers sort last
// but stay visible, since their history still matters.
export async function getSuppliersWithStats(
  canSeePayables: boolean,
): Promise<SupplierDTO[]> {
  const [suppliers, itemGroups, orderTotals, paidGroups, openingGroups] =
    await Promise.all([
      prisma.supplier.findMany({
        where: { deletedAt: null },
        include: supplierInclude,
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      }),
      prisma.inventoryItem.groupBy({
        by: ["supplierId"],
        where: { supplierId: { not: null }, deletedAt: null },
        _count: { _all: true },
      }),
      orderTotalsBySupplier(),
      prisma.supplierPayment.groupBy({
        by: ["supplierId", "kind"],
        where: { deletedAt: null },
        _sum: { amount: true },
      }),
      prisma.openingBalance.findMany({
        where: { supplierId: { not: null } },
        select: { supplierId: true, amount: true, asOfDate: true },
      }),
    ]);

  const itemMap = new Map(itemGroups.map((g) => [g.supplierId, g._count._all]));
  const settledMap = new Map<
    number,
    { paid: Prisma.Decimal; credited: Prisma.Decimal }
  >();
  for (const g of paidGroups) {
    const current = settledMap.get(g.supplierId) ?? {
      paid: D(0),
      credited: D(0),
    };
    const amount = g._sum.amount ?? D(0);
    if (g.kind === "Credit") current.credited = current.credited.plus(amount);
    else current.paid = current.paid.plus(amount);
    settledMap.set(g.supplierId, current);
  }
  // At most one per supplier, so the last write wins harmlessly.
  const openingMap = new Map(openingGroups.map((g) => [g.supplierId, g]));

  return suppliers.map((s) =>
    toSupplierDTO(s, {
      itemCount: itemMap.get(s.supplierId) ?? 0,
      money: !canSeePayables
        ? undefined
        : toMoneyDTO(
            orderTotals.get(s.supplierId) ?? NO_ORDERS,
            settledMap.get(s.supplierId) ?? { paid: D(0), credited: D(0) },
            openingMap.get(s.supplierId)?.amount ?? D(0),
            openingMap.get(s.supplierId)?.asOfDate ?? null,
          ),
    }),
  );
}

// Active suppliers only, for the inventory item picker (no stats needed).
export async function getActiveSuppliers(): Promise<SupplierDTO[]> {
  const suppliers = await prisma.supplier.findMany({
    where: { deletedAt: null, isActive: true },
    include: supplierInclude,
    orderBy: { name: "asc" },
  });
  return suppliers.map((s) => toSupplierDTO(s));
}

export async function getSupplier(
  supplierId: number,
  canSeePayables: boolean,
): Promise<SupplierDTO | null> {
  const supplier = await prisma.supplier.findFirst({
    where: { supplierId, deletedAt: null },
    include: supplierInclude,
  });
  if (!supplier) return null;

  const [itemCount, orderTotals, paidAgg, openingAgg] = await Promise.all([
    prisma.inventoryItem.count({ where: { supplierId, deletedAt: null } }),
    orderTotalsBySupplier(supplierId),
    prisma.supplierPayment.groupBy({
      by: ["kind"],
      _sum: { amount: true },
      where: { supplierId, deletedAt: null },
    }),
    prisma.openingBalance.findFirst({
      where: { supplierId },
      orderBy: { asOfDate: "asc" },
      select: { amount: true, asOfDate: true },
    }),
  ]);

  return toSupplierDTO(supplier, {
    itemCount,
    money: !canSeePayables
      ? undefined
      : toMoneyDTO(
          orderTotals.get(supplierId) ?? NO_ORDERS,
          {
            paid: paidAgg.find((g) => g.kind !== "Credit")?._sum.amount ?? D(0),
            credited:
              paidAgg.find((g) => g.kind === "Credit")?._sum.amount ?? D(0),
          },
          openingAgg?.amount ?? D(0),
          openingAgg?.asOfDate ?? null,
        ),
  });
}

// A supplier's contacts on their own, for the order page's WhatsApp send.
// Deliberately not read off the active-supplier list the page already loads:
// an order can belong to a supplier since marked inactive, and its contacts
// still need to be reachable.
export async function getSupplierContacts(
  supplierId: number,
): Promise<SupplierContactDTO[]> {
  const contacts = await prisma.supplierContact.findMany({
    where: { supplierId },
    orderBy: [{ sortOrder: "asc" }, { contactId: "asc" }],
  });
  return contacts.map(toSupplierContactDTO);
}

export const SUPPLIER_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function pageBounds(page = 1, pageSize = SUPPLIER_PAGE_SIZE) {
  const size = Math.min(pageSize, MAX_PAGE_SIZE);
  return { take: size, skip: (Math.max(page, 1) - 1) * size, pageSize: size };
}

export interface SupplierOrdersPage {
  orders: PurchaseOrderDTO[];
  total: number;
  page: number;
  pageSize: number;
}

// One page of a supplier's order history, newest first. Both tables on the
// supplier page used to arrive whole: for the largest supplier that was 178
// orders with every line and every line's item, to fill a table showing six
// columns of headline figures.
export async function getSupplierOrders(
  supplierId: number,
  page = 1,
): Promise<SupplierOrdersPage> {
  const { take, skip, pageSize } = pageBounds(page);
  const where = { supplierId, deletedAt: null };

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: orderInclude,
      orderBy: [{ createdAt: "desc" }, { orderId: "desc" }],
      take,
      skip,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return {
    orders: orders.map((o) => toPurchaseOrderDTO(o)),
    total,
    page: Math.max(page, 1),
    pageSize,
  };
}

export interface SupplierPaymentsPage {
  payments: SupplierPaymentDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getSupplierPayments(
  supplierId: number,
  page = 1,
): Promise<SupplierPaymentsPage> {
  const { take, skip, pageSize } = pageBounds(page);
  const where = { supplierId, deletedAt: null };

  const [payments, total] = await Promise.all([
    prisma.supplierPayment.findMany({
      where,
      include: supplierPaymentInclude,
      orderBy: [{ paidOn: "desc" }, { paymentId: "desc" }],
      take,
      skip,
    }),
    prisma.supplierPayment.count({ where }),
  ]);

  return {
    payments: payments.map(toSupplierPaymentDTO),
    total,
    page: Math.max(page, 1),
    pageSize,
  };
}

export interface SupplierDetailData {
  supplier: SupplierDTO;
  orders: SupplierOrdersPage;
  payments: SupplierPaymentsPage;
}

export async function getSupplierDetail(
  supplierId: number,
  canSeePayables: boolean,
): Promise<SupplierDetailData | null> {
  const supplier = await getSupplier(supplierId, canSeePayables);
  if (!supplier) return null;

  // The payment history is money, so it is not fetched at all without the
  // permission rather than fetched and hidden. The order history stays: it is
  // what was bought and what it cost, which rides with orders:read.
  const [orders, payments] = await Promise.all([
    getSupplierOrders(supplierId, 1),
    canSeePayables
      ? getSupplierPayments(supplierId, 1)
      : Promise.resolve<SupplierPaymentsPage>({
          payments: [],
          total: 0,
          page: 1,
          pageSize: 0,
        }),
  ]);

  return { supplier, orders, payments };
}

type PayableRow = {
  order_id: number;
  reference: string | null;
  received_on: Date | null;
  total: Prisma.Decimal;
  outstanding: Prisma.Decimal;
};

// The bills still open on a supplier's account, for the "which bill is this
// settling?" picker on the payment and credit forms. An open order is not a
// bill yet and is not offered; a bill that is paid off is not offered again.
//
// "Paid off" is worked out the way a statement of open items is, not by the
// order link alone. The clinic settles most accounts with a lump sum against
// the account rather than bill by bill, so nearly every delivered order had
// nothing linked to it and the picker offered four years of settled paperwork
// (Envetra: 186 bills for a balance of two). What is put against a bill by
// name comes off that bill first; everything else on the account (payments
// and credit notes with no order, less the opening balance, plus any return
// document, which is money the supplier owes back) is washed against the
// remaining bills oldest first. What that leaves on a bill is what it is
// offered at, so the amount prefilled is the one that closes it rather than
// the one that pays it twice. Summed over every bill, that is exactly the
// balance the supplier page shows, or the whole of it that bills explain when
// an opening balance is still uncovered.
//
// Every open bill, not a page: the picker has to be able to offer any bill the
// clinic might be settling. Each option is a handful of fields with its total
// and what is left summed in SQL, where this used to hand the pickers a full
// purchase order document, lines and item details included.
export async function getPayableOrders(
  supplierId: number,
): Promise<PayableOrderOption[]> {
  const rows = await prisma.$queryRaw<PayableRow[]>`
    WITH bills AS (
      SELECT o.order_id, o.reference, o.received_on,
             -- The date the liability was recognised, which is the order the
             -- account is settled in. Every delivered order carries one, but
             -- received_on is the fallback that keeps a stray row in sequence.
             COALESCE(o.billed_on, o.received_on, o.created_at::date) AS billed_on,
             ROUND(
               COALESCE(l.subtotal, 0)
               - COALESCE(o.discount_amount, 0)
               + COALESCE(o.shipping_amount, 0)
               + COALESCE(o.tax_amount, 0)
             , 2) AS total,
             -- Payments and credit notes both settle a bill, so both count.
             COALESCE(p.paid, 0) AS paid
      FROM purchase_orders o
      LEFT JOIN LATERAL (
        SELECT SUM(quantity_ordered * unit_cost) AS subtotal
        FROM purchase_order_lines
        WHERE order_id = o.order_id
      ) l ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(amount) AS paid
        FROM supplier_payments
        WHERE order_id = o.order_id AND deleted_at IS NULL
      ) p ON TRUE
      WHERE o.supplier_id = ${supplierId}
        AND o.deleted_at IS NULL
        AND o.status = ${INVOICED_STATUS}
    ),
    -- What is on the account without a bill's name on it, as money available
    -- to wash the open bills: settlements against the account, less the
    -- opening balance they cover first, plus anything the bills themselves
    -- net back (a return document, or a bill paid past its total).
    pool AS (
      SELECT
        COALESCE((
          SELECT SUM(amount) FROM supplier_payments
          WHERE supplier_id = ${supplierId}
            AND order_id IS NULL AND deleted_at IS NULL
        ), 0)
        - COALESCE((
          SELECT SUM(amount) FROM opening_balances
          WHERE supplier_id = ${supplierId}
        ), 0)
        + COALESCE((
          SELECT SUM(paid - total) FROM bills WHERE total - paid <= 0
        ), 0) AS available
    ),
    open_bills AS (
      SELECT b.order_id, b.reference, b.received_on, b.total,
             b.total - b.paid AS due,
             SUM(b.total - b.paid) OVER (
               ORDER BY b.billed_on, b.order_id
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS running
      FROM bills b
      WHERE b.total - b.paid > 0
    )
    SELECT ob.order_id, ob.reference, ob.received_on, ob.total,
           -- Oldest first: the pool covers each bill in turn until it runs out,
           -- and what it leaves on a bill is what the bill is offered at.
           ob.due - LEAST(ob.due, GREATEST(pool.available - (ob.running - ob.due), 0))
             AS outstanding
    FROM open_bills ob, pool
    WHERE ob.due - LEAST(ob.due, GREATEST(pool.available - (ob.running - ob.due), 0)) > 0
    -- Most recently delivered first. NULLS FIRST is Postgres' own default for a
    -- descending sort and is spelled out here so it survives a rewrite.
    ORDER BY ob.received_on DESC NULLS FIRST, ob.order_id DESC`;

  return rows.map((r) => ({
    orderId: r.order_id,
    reference: r.reference,
    receivedOn: toDateOnly(r.received_on),
    total: r.total.toFixed(2),
    paid: r.total.minus(r.outstanding).toFixed(2),
    outstanding: D(r.outstanding).toFixed(2),
  }));
}

// ---- Credit notes ----

// Records one credit note and spreads it across the account in a single
// transaction. The clinic is handed a note for a lump sum and decides at the
// counter where it goes: some against a specific bill, whatever is left over
// against the account.
//
// Each allocation is stored as its own settlement row, sharing the note's number
// in `reference`. That is what makes the statement read correctly: a credit that
// settled two bills genuinely is two entries on the account, and forcing it into
// one row would leave neither bill showing as settled.
//
// One transaction, because a half-applied credit note is worse than none: the
// balance would be right in total while pointing at the wrong orders.
export async function recordSupplierCredit(
  supplierId: number,
  data: SupplierCreditInput,
  performedBy: number | null,
): Promise<number[]> {
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: { supplierId, deletedAt: null },
      select: { supplierId: true },
    });
    if (!supplier) throw new ApiError(404, "Supplier not found");

    // Every named order has to be this supplier's and actually billed, or the
    // credit would settle a bill that does not exist yet, or one on another
    // account. Checked in one query rather than per allocation.
    const orderIds = data.allocations
      .map((a) => a.orderId)
      .filter((id): id is number => id != null);
    if (orderIds.length > 0) {
      const orders = await tx.purchaseOrder.findMany({
        where: { orderId: { in: orderIds }, supplierId, deletedAt: null },
        select: { orderId: true, status: true },
      });
      const byId = new Map(orders.map((o) => [o.orderId, o]));
      for (const orderId of orderIds) {
        const order = byId.get(orderId);
        if (!order) {
          throw new ApiError(
            404,
            `Order #${orderId} does not belong to this supplier`,
          );
        }
        if (order.status !== INVOICED_STATUS) {
          throw new ApiError(
            409,
            `Order #${orderId} is ${order.status.toLowerCase()}, so there is nothing to credit against it yet. Put that part against the account instead.`,
          );
        }
      }
    }

    const created: number[] = [];
    for (const allocation of data.allocations) {
      const row = await tx.supplierPayment.create({
        data: {
          supplierId,
          orderId: allocation.orderId ?? null,
          amount: allocation.amount,
          paidOn: data.paidOn,
          kind: "Credit",
          // The document number, repeated on every part of it. This is what ties
          // the rows back together as one note on the statement.
          reference: data.reference,
          notes: data.notes,
          createdBy: performedBy,
        },
        select: { paymentId: true },
      });
      created.push(row.paymentId);
    }
    return created;
  });
}
