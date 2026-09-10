import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { toDateOnly } from "@/utils/format";
import { INVENTORY_CATEGORIES } from "@/constants/inventory";
import { UNCATEGORISED, categorySlug } from "@/utils/inventory";
import type {
  InventoryItemDTO,
  InventoryTransactionDTO,
} from "@/types/entities";
import { SIGNED_TX_TYPES, type InventoryTxType } from "@/types/enums";

// Shape returned by inventory item queries.
type ItemRow = {
  needsReview: boolean;
  reviewNote: string | null;
  itemId: number;
  name: string;
  category: string | null;
  barcode: string | null;
  unit: string | null;
  currentStock: Prisma.Decimal;
  reorderLevel: number;
  salePrice: Prisma.Decimal | null;
  lastCost: Prisma.Decimal | null;
  partnerId: number | null;
  partnerCostPct: Prisma.Decimal | null;
  partnerProfitPct: Prisma.Decimal | null;
  supplierId: number | null;
  // Present only when the query includes the relation; absent on the bare rows
  // returned by create/update, so both stay optional.
  partner?: { name: string } | null;
  supplier?: { name: string } | null;
  expiryDate: Date | null;
  tracksExpiry: boolean;
  // Soonest KNOWN expiry among the item's open batches, when the caller asked
  // for it. Absent on queries that did not join batches, which then fall back
  // to the item's own date.
  batches?: { expiryDate: Date | null }[];
  looseUnit: string | null;
  loosePerUnit: Prisma.Decimal | null;
  loosePrice: Prisma.Decimal | null;
  notes: string | null;
};

type TransactionRow = {
  transactionId: number;
  itemId: number;
  type: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal | null;
  salePrice: Prisma.Decimal | null;
  referenceType: string | null;
  referenceId: number | null;
  notes: string | null;
  performedAt: Date;
  performer: { firstName: string; lastName: string } | null;
};

// Which date the item should be judged on. A tracked item's expiry belongs to
// its batches, and the one that matters is the soonest still on the shelf. The
// item's own column stays authoritative for everything not batched, so nothing
// that was already working had to change.
//
// Batches with no recorded expiry are skipped rather than treated as expiring:
// unknown is not the same as imminent, and they are already picked first.
function effectiveExpiry(i: {
  expiryDate: Date | null;
  tracksExpiry: boolean;
  batches?: { expiryDate: Date | null }[];
}): Date | null {
  if (!i.tracksExpiry || i.batches === undefined) return i.expiryDate;
  const dated = i.batches
    .map((b) => b.expiryDate)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());
  return dated[0] ?? null;
}

function isExpired(expiryDate: Date | null): boolean {
  if (!expiryDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return expiryDate.getTime() < today.getTime();
}

// `canSeeCost` is REQUIRED, not optional with a friendly default, and that is
// deliberate. Cost is the one field on an item the owner does not want clinical
// staff to have: sale price is visible to everyone, so anyone holding the cost
// can work out the clinic's margin. Hiding it in the component is not enough,
// because the figure still ships in the JSON and is one devtools panel away.
// Making the flag mandatory means every call site has to answer the question
// and a new one cannot leak it by forgetting an argument.
//
// The gate is `orders:read`, which only Admin holds. That is the same line the
// rest of the app already draws: purchasing permissions are separate from
// inventory:* precisely so clinical staff see stock without seeing what it cost.
export function toInventoryItemDTO(
  i: ItemRow,
  canSeeCost: boolean,
): InventoryItemDTO {
  const currentStock = i.currentStock.toNumber();
  return {
    itemId: i.itemId,
    name: i.name,
    category: i.category,
    barcode: i.barcode,
    unit: i.unit,
    currentStock,
    reorderLevel: i.reorderLevel,
    salePrice: i.salePrice ? i.salePrice.toString() : null,
    lastCost: canSeeCost && i.lastCost ? i.lastCost.toString() : null,
    partnerId: i.partnerId,
    partnerName: i.partner?.name ?? null,
    partnerCostPct: i.partnerCostPct ? i.partnerCostPct.toString() : null,
    partnerProfitPct: i.partnerProfitPct ? i.partnerProfitPct.toString() : null,
    supplierId: i.supplierId,
    supplierName: i.supplier?.name ?? null,
    expiryDate: toDateOnly(effectiveExpiry(i)),
    tracksExpiry: i.tracksExpiry,
    looseUnit: i.looseUnit,
    loosePerUnit: i.loosePerUnit ? i.loosePerUnit.toString() : null,
    loosePrice: i.loosePrice ? i.loosePrice.toString() : null,
    notes: i.notes,
    needsReview: i.needsReview,
    reviewNote: i.reviewNote,
    // Only nag about reorder when a level is actually configured.
    isLowStock: i.reorderLevel > 0 && currentStock <= i.reorderLevel,
    isExpired: isExpired(effectiveExpiry(i)),
  };
}

// Same rule as toInventoryItemDTO: a Received movement carries the supplier's
// unit cost, which is the same leak by another route.
export function toInventoryTransactionDTO(
  t: TransactionRow,
  canSeeCost: boolean,
): InventoryTransactionDTO {
  return {
    transactionId: t.transactionId,
    itemId: t.itemId,
    type: t.type as InventoryTxType,
    quantity: t.quantity.toNumber(),
    unitCost: canSeeCost && t.unitCost ? t.unitCost.toString() : null,
    salePrice: t.salePrice ? t.salePrice.toString() : null,
    referenceType: t.referenceType,
    referenceId: t.referenceId,
    notes: t.notes,
    performedAt: t.performedAt.toISOString(),
    performerName: t.performer
      ? `${t.performer.firstName} ${t.performer.lastName}`
      : null,
  };
}

// Convert the request's quantity into the signed value stored on the
// transaction (and added to current_stock).
//
// Direction is a property of the type, so most callers send a magnitude and
// never a sign. The two in SIGNED_TX_TYPES are the exceptions and say why they
// are; everything that used to borrow Adjusted purely to get a sign now has a
// type that states what it was.
export function signedDelta(type: InventoryTxType, quantity: number): number {
  if (SIGNED_TX_TYPES.includes(type)) return quantity;
  return type === "Received" ? Math.abs(quantity) : -Math.abs(quantity);
}

// The DB CHECK (current_stock >= 0) rejects any movement that would oversell.
// Postgres reports it as check_violation (SQLSTATE 23514) naming the column.
export function isStockCheckViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: unknown; meta?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  const metaCode =
    e.meta && typeof e.meta === "object" && "code" in e.meta
      ? String((e.meta as { code?: unknown }).code)
      : "";
  return (
    e.code === "23514" ||
    metaCode === "23514" ||
    message.includes("current_stock")
  );
}

export function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

const txInclude = {
  performer: { select: { firstName: true, lastName: true } },
} as const;

// Joined wherever an item DTO is built, so the expiry shown is the soonest one
// actually on the shelf. Only dated, open batches matter, and only the first,
// so this is one indexed row per item rather than a second query.
export const itemExpiryInclude = {
  batches: {
    where: { quantity: { gt: 0 }, expiryDate: { not: null } },
    orderBy: { expiryDate: "asc" },
    take: 1,
    select: { expiryDate: true },
  },
} as const;

export interface StockMovementParams {
  itemId: number;
  type: InventoryTxType;
  quantity: number;
  unitCost?: number;
  // Frozen sale price and consignment accrual, set by the invoice paths. With
  // these here, revenue, cost and what a partner is owed are all readable from
  // the movement alone, with no join back to the invoice.
  salePrice?: Prisma.Decimal | number | null;
  partnerId?: number | null;
  partnerPayable?: Prisma.Decimal | number | null;
  partnerCostPart?: Prisma.Decimal | number | null;
  referenceType?: string;
  referenceId?: number;
  notes?: string;
  performedBy: number | null;
  // An invoice line outlives a soft-deleted item: a draft raised before the
  // delete still has to issue and void cleanly, and blocking it here would
  // strand the invoice. Only those callers opt in, so everyone else keeps the
  // existence check.
  allowDeletedItem?: boolean;
  // Batch details for a delivery of a perishable item. Ignored on items that do
  // not track expiry.
  lotNumber?: string | null;
  expiryDate?: Date | null;
  purchaseLineId?: number | null;
  // Exactly undo an earlier movement, batch for batch, instead of opening a new
  // lot or picking FEFO. Voiding an invoice uses this so a returned scoop goes
  // back to the lot it came out of rather than becoming undated stock that then
  // picks first, and a written-off return uses it so the Damaged movement eats
  // the very stock the Returned movement just put back. Ignored unless this
  // movement is the exact opposite of that one.
  reverseOf?: number | null;
}

// FEFO: soonest expiry first, and a null expiry sorts before any date because
// undated stock is the oldest stock on the shelf. Ties break on the oldest
// delivery. Written as raw SQL for the row lock: two invoices issued at the
// same moment would otherwise both read the same batch and both decrement it.
async function lockBatchesForPicking(
  tx: Prisma.TransactionClient,
  itemId: number,
): Promise<{ batch_id: number; quantity: Prisma.Decimal }[]> {
  return tx.$queryRaw`
    SELECT batch_id, quantity
      FROM inventory_batches
     WHERE item_id = ${itemId}
       AND quantity > 0
     ORDER BY expiry_date ASC NULLS FIRST, received_at ASC, batch_id ASC
     FOR UPDATE
  `;
}

// Move a tracked item's batches to match a movement that has already been
// applied to current_stock, so the rollup and the batch rows stay equal.
async function applyBatchDelta(
  tx: Prisma.TransactionClient,
  params: {
    itemId: number;
    itemName: string;
    delta: Prisma.Decimal;
    transactionId: number;
    lotNumber?: string | null;
    expiryDate?: Date | null;
    purchaseLineId?: number | null;
    reverseOf?: number | null;
  },
): Promise<void> {
  const { itemId, delta, transactionId } = params;
  if (delta.isZero()) return;

  const allocate = async (batchId: number, quantity: Prisma.Decimal) => {
    await tx.inventoryBatchMovement.create({
      data: { transactionId, batchId, quantity },
    });
    await tx.inventoryBatch.update({
      where: { batchId },
      data: { quantity: { increment: quantity } },
    });
  };

  // Undoing a specific movement puts the stock back exactly where that movement
  // took it from, or takes back exactly what it added. Both directions matter: a
  // return that comes back damaged is a Returned into a lot followed by a
  // Damaged out of it, and if the write-off picked FEFO instead it would leave
  // the returned goods sitting in one lot while eating another.
  //
  // Only an exact undo qualifies. A partial reversal cannot be split across the
  // original's lots without guessing which one came back, so it falls through to
  // the ordinary rules below.
  if (params.reverseOf != null) {
    const original = await tx.inventoryBatchMovement.findMany({
      where: { transactionId: params.reverseOf },
    });
    const moved = original.reduce(
      (sum, m) => sum.plus(m.quantity),
      new Prisma.Decimal(0),
    );
    if (original.length > 0 && moved.negated().equals(delta)) {
      for (const m of original) {
        await allocate(m.batchId, m.quantity.negated());
      }
      return;
    }
  }

  if (delta.isNegative()) {
    let remaining = delta.abs();
    for (const row of await lockBatchesForPicking(tx, itemId)) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const take = Prisma.Decimal.min(remaining, row.quantity);
      await allocate(row.batch_id, take.negated());
      remaining = remaining.minus(take);
    }
    if (remaining.greaterThan(0)) {
      // current_stock said there was enough but the batches do not add up. That
      // is a rollup that has drifted, and continuing would hide it.
      throw new ApiError(
        409,
        `Batch records for "${params.itemName}" do not match its stock level: they are ${remaining} short. Count the item and adjust it before selling.`,
      );
    }
    return;
  }

  // A real lot number identifies stock, so a repeat delivery of it joins the
  // batch already on the shelf. Undated stock gets its own row instead, which
  // keeps the opening batch from swallowing every later delivery.
  const existing =
    params.lotNumber != null
      ? await tx.inventoryBatch.findFirst({
          where: {
            itemId,
            lotNumber: params.lotNumber,
            expiryDate: params.expiryDate ?? null,
          },
        })
      : null;

  if (existing) {
    await allocate(existing.batchId, delta);
    return;
  }

  const created = await tx.inventoryBatch.create({
    data: {
      itemId,
      lotNumber: params.lotNumber ?? null,
      expiryDate: params.expiryDate ?? null,
      purchaseLineId: params.purchaseLineId ?? null,
      quantity: 0,
    },
  });
  await allocate(created.batchId, delta);
}

/**
 * Give an item that has just started tracking expiry one undated batch for the
 * stock already on the shelf, so the rollup and the batch rows start out equal.
 *
 * Turning tracking on is a flag flip, but from that moment sales pick from
 * batches instead of current_stock. An item holding stock with no batches is
 * therefore armed to fail on its next sale, reported as drift that never
 * happened. The item dialog already promises this ("whatever is on the shelf
 * now counts as one undated batch"), and the cutover migration did exactly this
 * for the items tracked from the start. This is the same thing for an item
 * switched on later.
 *
 * Undated is the honest value: nobody recorded an expiry for stock bought
 * before anyone was asking for one. It also sorts first under FEFO, so the
 * unknown pool drains before any dated delivery.
 *
 * No batch movement is written, matching the migration: an opening batch is a
 * starting position, not something that moved.
 */
export async function openOpeningBatchTx(
  tx: Prisma.TransactionClient,
  itemId: number,
): Promise<void> {
  const item = await tx.inventoryItem.findUnique({
    where: { itemId },
    select: { currentStock: true },
  });
  if (!item) return;

  // Sized to the shortfall rather than to current_stock, so an item switched
  // off and on again is topped up instead of counted twice.
  const held = await tx.inventoryBatch.aggregate({
    where: { itemId },
    _sum: { quantity: true },
  });
  const shortfall = item.currentStock.minus(
    held._sum.quantity ?? new Prisma.Decimal(0),
  );
  if (shortfall.lessThanOrEqualTo(0)) return;

  await tx.inventoryBatch.create({ data: { itemId, quantity: shortfall } });
}

// Record one stock movement and apply it to current_stock, inside a transaction
// the caller owns. Receiving a purchase order writes many movements that must
// all land or none, so it drives this directly rather than calling
// applyStockMovement per line and getting one transaction each.
export async function applyStockMovementTx(
  tx: Prisma.TransactionClient,
  params: StockMovementParams,
) {
  const delta = signedDelta(params.type, params.quantity);

  const item = await tx.inventoryItem.findFirst({
    where: {
      itemId: params.itemId,
      ...(params.allowDeletedItem ? {} : { deletedAt: null }),
    },
    select: { itemId: true, name: true, lastCost: true, tracksExpiry: true },
  });
  if (!item) throw new ApiError(404, "Inventory item not found");

  // Stock consumed in the clinic or written off (expired, or a return that came
  // back damaged) leaves without a sale, so no cost gets frozen on it the way a
  // Sold movement freezes one from the invoice.
  // Default it from the item's latest purchase cost, so the value of what was
  // used or binned is on record rather than lost. The caller sends nothing, so
  // nobody has to type it.
  //
  // Recording it does NOT charge it to profit: consumables are expensed through
  // running costs, and charging them here as well would count the same stock
  // twice. Analytics reports these separately for visibility.
  const unitCost =
    params.unitCost ??
    (params.type === "Used" ||
    params.type === "Expired" ||
    params.type === "Damaged"
      ? (item.lastCost ?? undefined)
      : undefined);

  const transaction = await tx.inventoryTransaction.create({
    data: {
      itemId: params.itemId,
      performedBy: params.performedBy,
      type: params.type,
      quantity: delta,
      unitCost,
      salePrice: params.salePrice ?? undefined,
      partnerId: params.partnerId ?? undefined,
      partnerPayable: params.partnerPayable ?? undefined,
      partnerCostPart: params.partnerCostPart ?? undefined,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      notes: params.notes,
    },
    include: txInclude,
  });

  const updated = await tx.inventoryItem.update({
    where: { itemId: params.itemId },
    data: {
      currentStock: { increment: delta },
      // Receiving stock refreshes the most-recent purchase cost.
      ...(params.type === "Received" && params.unitCost !== undefined
        ? { lastCost: params.unitCost }
        : {}),
    },
  });

  // Batches are the truth for a tracked item and current_stock above is the
  // cached rollup of them, so this runs inside the same transaction: either
  // both move or neither does.
  if (item.tracksExpiry) {
    await applyBatchDelta(tx, {
      itemId: params.itemId,
      itemName: item.name,
      delta: new Prisma.Decimal(delta),
      transactionId: transaction.transactionId,
      lotNumber: params.lotNumber,
      expiryDate: params.expiryDate,
      purchaseLineId: params.purchaseLineId,
      reverseOf: params.reverseOf,
    });
  }

  return { item: updated, transaction };
}

// Turn a raw movement failure into the API error the client should see. Shared
// by every caller that writes movements, so the oversell message is identical
// whether one movement failed or one line of a received order did.
export function rethrowStockMovementError(err: unknown): never {
  if (err instanceof ApiError) throw err;
  if (isStockCheckViolation(err)) {
    throw new ApiError(409, "This movement would take stock below zero.");
  }
  throw err;
}

// Record a stock movement and apply it to current_stock atomically. The insert
// and the increment live in one transaction, so a CHECK failure (oversell)
// rolls back the movement too. The increment is computed by the DB, making it
// safe against concurrent movements.
export async function applyStockMovement(params: StockMovementParams) {
  try {
    return await prisma.$transaction((tx) => applyStockMovementTx(tx, params));
  } catch (err) {
    rethrowStockMovementError(err);
  }
}

// ---- Inventory list (paged, per category) ----

/**
 * The inventory page loads one category at a time. Previously it fetched every
 * item with its partner and supplier joined, then grouped them client-side into
 * accordions, so all 1,744 rows were in the DOM at once. Now the category is
 * part of the route, the query returns one page, and the tab strip is served by
 * a single grouped count.
 */
export interface InventoryListQuery {
  /** Exact category. `UNCATEGORISED` selects items with no category set. */
  category?: string;
  q?: string;
  lowStock?: boolean;
  /** Supplier id, or "none" for items with no usual supplier yet. */
  supplier?: string;
  page?: number;
  pageSize?: number;
}

export interface InventoryListPage {
  items: InventoryItemDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InventoryCategoryCount {
  category: string;
  slug: string;
  count: number;
  lowStockCount: number;
}

export const INVENTORY_PAGE_SIZE = 25;
const MAX_INVENTORY_PAGE_SIZE = 100;

/**
 * Ids of items at or below their reorder level.
 *
 * Low stock compares two columns, and Prisma cannot express that in a `where`
 * (reorder_level is an Int, current_stock a Decimal). The old list filtered
 * after mapping, which was fine while it fetched everything, but silently
 * wrong once the query is paged: it would take a page and then filter it. So
 * the ids are selected first and used as a filter.
 */
async function lowStockItemIds(): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ item_id: number }[]>`
    SELECT item_id FROM inventory_items
    WHERE deleted_at IS NULL
      AND reorder_level > 0
      AND current_stock <= reorder_level`;
  return rows.map((r) => r.item_id);
}

function inventoryWhere(
  query: InventoryListQuery,
  lowStockIds: number[] | null,
): Prisma.InventoryItemWhereInput {
  const q = query.q?.trim();
  const supplierId = Number(query.supplier);
  const supplierFilter: Prisma.InventoryItemWhereInput =
    query.supplier === "none"
      ? { supplierId: null }
      : query.supplier && Number.isInteger(supplierId)
        ? { supplierId }
        : {};

  const category =
    query.category === UNCATEGORISED
      ? { OR: [{ category: null }, { category: "" }] }
      : query.category
        ? { category: query.category }
        : {};

  return {
    deletedAt: null,
    ...category,
    ...supplierFilter,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { category: { contains: q, mode: "insensitive" as const } },
            { barcode: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    // "Low stock" only means something once a reorder level is configured,
    // matching isLowStock on the DTO.
    ...(lowStockIds ? { itemId: { in: lowStockIds } } : {}),
  };
}

export async function listInventory(
  query: InventoryListQuery = {},
  canSeeCost = false,
): Promise<InventoryListPage> {
  const pageSize = Math.min(
    query.pageSize ?? INVENTORY_PAGE_SIZE,
    MAX_INVENTORY_PAGE_SIZE,
  );
  const page = Math.max(query.page ?? 1, 1);
  const where = inventoryWhere(
    query,
    query.lowStock ? await lowStockItemIds() : null,
  );

  const [rows, total] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      include: {
        partner: { select: { name: true } },
        supplier: { select: { name: true } },
        ...itemExpiryInclude,
      },
      orderBy: [{ name: "asc" }, { itemId: "asc" }],
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.inventoryItem.count({ where }),
  ]);

  return {
    items: rows.map((r) => toInventoryItemDTO(r, canSeeCost)),
    total,
    page,
    pageSize,
  };
}

/**
 * Counts per category for the tab strip. One grouped query rather than loading
 * every item to count them, and the low-stock tally comes with it so a tab can
 * show a badge without a second pass.
 */
export async function getInventoryCategories(): Promise<
  InventoryCategoryCount[]
> {
  const rows = await prisma.$queryRaw<
    { category: string | null; count: bigint; low: bigint }[]
  >`
    SELECT nullif(trim(category), '') AS category,
           count(*) AS count,
           count(*) FILTER (
             WHERE reorder_level > 0 AND current_stock <= reorder_level
           ) AS low
    FROM inventory_items
    WHERE deleted_at IS NULL
    GROUP BY 1`;

  const known: readonly string[] = INVENTORY_CATEGORIES;
  const rank = (category: string) => {
    if (category === UNCATEGORISED) return known.length + 1;
    const index = known.indexOf(category);
    return index === -1 ? known.length : index;
  };

  return rows
    .map((r) => {
      const category = r.category ?? UNCATEGORISED;
      return {
        category,
        slug: categorySlug(category),
        count: Number(r.count),
        lowStockCount: Number(r.low),
      };
    })
    .sort(
      (a, b) =>
        rank(a.category) - rank(b.category) ||
        a.category.localeCompare(b.category),
    );
}
