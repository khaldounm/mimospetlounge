import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { toDateOnly } from "@/utils/format";
import { dateOnlyBounds, rangeBounds } from "@/utils/date-range";
import { PARTNER_PAGE_SIZE } from "@/constants/partner";
import type {
  AnalyticsRange,
  PartnerDTO,
  PartnerEarningDTO,
  PartnerItemPerformanceDTO,
  PartnerItemsPage,
  PartnerMoneyDTO,
  PartnerPayoutDTO,
  PartnerPayoutsPage,
  PartnerSalesPage,
} from "@/types/entities";
import type { InventoryTxType } from "@/types/enums";

type DecimalInput = string | number | Prisma.Decimal;

const D = (v: DecimalInput) => new Prisma.Decimal(v);

// Mirrors formatInvoiceNumber from lib/invoices; kept local so this module does
// not import lib/invoices (which imports the partner math here, forming a cycle).
function invoiceNumber(id: number): string {
  return `INV-${String(id).padStart(5, "0")}`;
}

// The two free-form rates that define a partner's deal. Kept as one object so
// the pair travels together: reading a cost rate without the profit rate it was
// agreed alongside describes half a deal.
export interface PartnerRates {
  costPct: Prisma.Decimal;
  profitPct: Prisma.Decimal;
}

// Amount owed to a partner for one sold line:
//
//   qty * ( cost * costPct% + max(salePrice - cost, 0) * profitPct% )
//
// Two independent percentages rather than one, which is what lets a single
// formula cover every deal the clinic strikes. 100/30 hands back the outlay and
// splits the upside; 90/50 keeps a tenth of the cost against handling; 120/0 is
// a flat 20% uplift on cost with no interest in the sale price; 0/60 is a pure
// profit split. None of these needs a branch here.
//
// Profit stays floored at zero, so a sale below cost never charges the partner a
// negative share. Note what that means for a costPct of 100: the partner is made
// whole and the clinic absorbs the whole loss. Lower the cost rate if the deal
// is meant to share the downside.
//
// Rounding happens once, on each line total, so a fractional per-unit share never
// compounds across the quantity.
export interface PartnerPayable {
  // What the clinic owes for the line, and what gets frozen on the movement.
  total: Prisma.Decimal;
  // How much of that total is the cost half. Frozen alongside the total so the
  // capital/profit split stays exact: once costPct can be anything, subtracting
  // the item's cost from the total no longer recovers the profit share.
  costPart: Prisma.Decimal;
}

export function computePartnerPayable(
  quantity: DecimalInput,
  salePrice: DecimalInput,
  cost: DecimalInput,
  rates: PartnerRates,
): PartnerPayable {
  const qty = D(quantity);
  const unitCost = D(cost);
  const diff = D(salePrice).minus(unitCost);
  const profit = diff.greaterThan(0) ? diff : D(0);
  const costPerUnit = unitCost.times(rates.costPct).dividedBy(100);
  const sharePerUnit = profit.times(rates.profitPct).dividedBy(100);
  // Both rounded from the unrounded per-unit figures rather than the cost half
  // being rounded and the total built from it, so the total is unchanged from
  // what a single-rate calculation produced. Any sub-cent remainder therefore
  // lands in the profit half, which is the residual of the two and the right
  // place for it.
  return {
    total: qty.times(costPerUnit.plus(sharePerUnit)).toDecimalPlaces(2),
    costPart: qty.times(costPerUnit).toDecimalPlaces(2),
  };
}

// The rates in force for one item: each per-item override applies on its own,
// falling back to the partner's default. They resolve independently on purpose,
// so an item can carry a custom cost rate while still following the partner's
// standard profit split.
//
// The cost fallback is 100 rather than 0: an item consigned with nothing said
// about cost returns the partner's outlay, which is the safe reading of silence.
// A zero there would quietly keep money that was never the clinic's.
export function effectiveRates(
  item: {
    partnerCostPct: Prisma.Decimal | null;
    partnerProfitPct: Prisma.Decimal | null;
  },
  partnerDefaults:
    | { defaultCostPct: Prisma.Decimal; defaultProfitPct: Prisma.Decimal }
    | null
    | undefined,
): PartnerRates {
  return {
    costPct: item.partnerCostPct ?? partnerDefaults?.defaultCostPct ?? D(100),
    profitPct:
      item.partnerProfitPct ?? partnerDefaults?.defaultProfitPct ?? D(0),
  };
}

// ---- Row shapes ----

type PartnerRow = {
  partnerId: number;
  name: string;
  phone: string | null;
  defaultCostPct: Prisma.Decimal;
  defaultProfitPct: Prisma.Decimal;
  dailyMinimum: Prisma.Decimal | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
};

// Raw sums for one partner, before the derived figures are worked out. Kept
// separate from the DTO so the arithmetic lives in exactly one place.
type PartnerTotals = {
  revenue: Prisma.Decimal;
  costOfSales: Prisma.Decimal;
  accrued: Prisma.Decimal;
  // The cost half of `accrued`, summed from the frozen split on each movement.
  // Distinct from costOfSales: that is what the partner actually laid out, this
  // is what the deal returns to them for it. They coincide only at a 100% cost
  // rate.
  accruedCost: Prisma.Decimal;
  unitsSold: Prisma.Decimal;
};

// What the accrual ledger owes this partner, kept apart from the stock figures
// rather than folded into them. A service is not a sale of their capital, and
// blending the two would break the identities the stock figures hold to
// (partnerShare + clinicShare = grossProfit, and so on) while making neither
// stream readable on its own.
type AccrualTotals = {
  service: Prisma.Decimal;
  guarantee: Prisma.Decimal;
  // The cost half, for the rare service deal struck at a non-zero cost rate.
  // Usually zero: a vet fronts no capital.
  costPart: Prisma.Decimal;
  // What the customer was billed for the work, frozen on the accrual. Carried
  // so the services row can show billed / theirs / clinic's, the same three
  // figures the stock row shows, rather than their cut floating on its own.
  // Guarantee rows bill nothing, so only service rows add to it.
  serviceRevenue: Prisma.Decimal;
};

const emptyAccruals = (): AccrualTotals => ({
  service: D(0),
  guarantee: D(0),
  costPart: D(0),
  serviceRevenue: D(0),
});

const totalAccrued = (a: AccrualTotals): Prisma.Decimal =>
  a.service.plus(a.guarantee);

const emptyTotals = (): PartnerTotals => ({
  revenue: D(0),
  costOfSales: D(0),
  accrued: D(0),
  accruedCost: D(0),
  unitsSold: D(0),
});

type PartnerStats = {
  itemCount: number;
  // Flow over the selected range.
  inRange: PartnerTotals;
  paidInRange: Prisma.Decimal;
  // Position as at the range's last day: cumulative from the beginning of time
  // up to that date, not confined to the range.
  toDate: PartnerTotals;
  paidToDate: Prisma.Decimal;
  capitalOnShelf: Prisma.Decimal;
  // What the account was already owed at `openingAsOf`, before any movement in
  // this database. Carried the same way clients and suppliers carry theirs: a
  // partner's accrual comes off sale movements and their payouts off
  // partner_payouts, and a year-end prune removes both, so a balance that only
  // counts what survives is not incomplete, it is wrong.
  opening: Prisma.Decimal;
  openingAsOf: Date | null;
  // Services performed and days guaranteed. Same range/position split as above.
  accrualsInRange: AccrualTotals;
  accrualsToDate: AccrualTotals;
};

// Movements that represent a sale or its reversal. A Sold line carries a negative
// quantity, and giving it back writes a Returned line with the same frozen cost
// and sale price at the opposite sign, so summing `-quantity * price` across both
// nets it to zero without special-casing it. One filter covers a voided invoice
// and a counter return alike: to a partner's balance they are the same event.
export const SALE_MOVEMENT_FILTER: Prisma.InventoryTransactionWhereInput = {
  OR: [{ type: "Sold" }, { type: "Returned", referenceType: "invoice" }],
};

// The columns every partner figure is derived from. See saleMovementSelect.
export type SaleMovementRow = {
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal | null;
  salePrice: Prisma.Decimal | null;
  partnerPayable: Prisma.Decimal | null;
  partnerCostPart: Prisma.Decimal | null;
};

// Turn a partner's sale movements into the four raw sums.
function sumSaleMovements(rows: SaleMovementRow[]): PartnerTotals {
  const totals = emptyTotals();
  for (const row of rows) {
    // Sign flip: outbound stock (negative quantity) adds to revenue and cost.
    const sold = row.quantity.negated();
    totals.unitsSold = totals.unitsSold.plus(sold);
    if (row.salePrice) {
      totals.revenue = totals.revenue.plus(sold.times(row.salePrice));
    }
    if (row.unitCost) {
      totals.costOfSales = totals.costOfSales.plus(sold.times(row.unitCost));
    }
    totals.accrued = totals.accrued.plus(row.partnerPayable ?? 0);
    // Movements written before the split was frozen carry null here. Falling
    // back to the item cost matches what those sales actually accrued, since
    // every one of them ran at a 100% cost rate.
    totals.accruedCost = totals.accruedCost.plus(
      row.partnerCostPart ?? (row.unitCost ? sold.times(row.unitCost) : 0),
    );
  }
  return totals;
}

// The derived view the UI reads. Every figure here is arithmetic on the sums
// above, so the definitions cannot drift between the list and the detail page.
//
// The key split: `accrued` is what the clinic owes for a sale, and it is the
// partner's capital coming back PLUS their cut of the profit. Reporting it as
// "earned" is what makes capital and profit look like the same thing.
function toMoneyDTO(stats: PartnerStats): PartnerMoneyDTO {
  const { inRange, toDate } = stats;

  // How gross profit divides between the two, which is a different question from
  // how the money owed divides (that split is below, and uses accruedCost).
  //
  // Measured against what the stock cost, not against the cost half of the
  // payout. The partner funded the goods, so everything the deal pays them above
  // that outlay is their take: at a cost rate over 100 the uplift is part of what
  // they earn, and below 100 the shortfall is value the clinic kept. Using the
  // frozen cost half here instead would drop that adjustment on the floor and
  // report a clinic share it never actually received.
  //
  // Defined this way the two always sum to gross profit, and clinicShare always
  // equals revenue minus what was accrued.
  const partnerShare = inRange.accrued.minus(inRange.costOfSales);
  const grossProfit = inRange.revenue.minus(inRange.costOfSales);
  // Can go negative: a sale below cost still owes the partner their cost share,
  // so the clinic absorbs the shortfall.
  const clinicShare = grossProfit.minus(partnerShare);

  // Everything the partner has earned that is not stock: services they
  // performed and days their guarantee topped up.
  const accrualRange = totalAccrued(stats.accrualsInRange);
  const accrualToDate = totalAccrued(stats.accrualsToDate);
  const earnedToDate = toDate.accrued.plus(accrualToDate);

  const balance = stats.opening.plus(earnedToDate).minus(stats.paidToDate);

  // What the partner had in play at that date: the cost of everything that had
  // sold by then (recovered) plus the cost of what was still on the shelf. Not a
  // separate query, just the two halves added up.
  const capitalRecovered = toDate.costOfSales;
  const capitalDeployed = capitalRecovered.plus(stats.capitalOnShelf);
  const sellThrough = capitalDeployed.isZero()
    ? D(0)
    : capitalRecovered.dividedBy(capitalDeployed).times(100);

  // Split the outstanding balance into capital and profit. A payout is a bare
  // amount and says nothing about which half it settles, so a convention is
  // needed: capital is settled first, which matches how the arrangement reads
  // (give the partner their money back, then their cut) and means a part-paid
  // partner sees "capital is back, the rest is your share" rather than two
  // half-settled numbers.
  //
  // The two always sum to the balance, including when payouts have overshot: a
  // negative profitOwed then reads as an overpayment, which is the truth.
  // Split on what the deal owes for capital, not on what the stock cost. At a
  // 100% rate these are the same figure; below it, only the owed half can be
  // settled, so using cost would hold back more than the partner is due and
  // drive profitOwed negative.
  // The opening balance is a single carried figure and says nothing about which
  // half of the deal it settles, so it is not treated as capital here. It falls
  // into profitOwed, which is derived as the remainder, and the two halves still
  // sum to the balance. That is the honest place for a figure whose composition
  // this database never saw.
  // A service deal at a non-zero cost rate returns capital too, so its cost half
  // belongs on this side of the split like any other.
  const capitalAccrued = toDate.accruedCost.plus(stats.accrualsToDate.costPart);
  const profitShareToDate = earnedToDate.minus(capitalAccrued);
  const capitalOutstanding = capitalAccrued.minus(stats.paidToDate);
  const capitalOwed = capitalOutstanding.greaterThan(0)
    ? capitalOutstanding
    : D(0);
  const profitOwed = balance.minus(capitalOwed);

  return {
    openingBalance: stats.opening.toFixed(2),
    openingBalanceAsOf: stats.openingAsOf
      ? toDateOnly(stats.openingAsOf)
      : null,
    revenue: inRange.revenue.toFixed(2),
    costOfSales: inRange.costOfSales.toFixed(2),
    grossProfit: grossProfit.toFixed(2),
    partnerShare: partnerShare.toFixed(2),
    clinicShare: clinicShare.toFixed(2),
    accrued: inRange.accrued.toFixed(2),
    unitsSold: inRange.unitsSold.toString(),
    paidInRange: stats.paidInRange.toFixed(2),
    earnedToDate: earnedToDate.toFixed(2),
    serviceEarned: stats.accrualsInRange.service.toFixed(2),
    guaranteeEarned: stats.accrualsInRange.guarantee.toFixed(2),
    serviceRevenue: stats.accrualsInRange.serviceRevenue.toFixed(2),
    // Billed minus what the partner is owed for it, which is exactly how the
    // stock clinicShare above is derived (there the cost cancels out of
    // grossProfit minus partnerShare, leaving revenue minus accrued). A service
    // struck at a non-zero cost rate returns capital inside that same accrued
    // figure, so this stays right without a separate cost term.
    serviceClinicShare: stats.accrualsInRange.serviceRevenue
      .minus(stats.accrualsInRange.service)
      .toFixed(2),
    accrualEarnedInRange: accrualRange.toFixed(2),
    paidToDate: stats.paidToDate.toFixed(2),
    balance: balance.toFixed(2),
    capitalOwed: capitalOwed.toFixed(2),
    profitOwed: profitOwed.toFixed(2),
    profitShareToDate: profitShareToDate.toFixed(2),
    capitalDeployed: capitalDeployed.toFixed(2),
    capitalOnShelf: stats.capitalOnShelf.toFixed(2),
    capitalRecoveredToDate: capitalRecovered.toFixed(2),
    sellThroughPct: sellThrough.toDecimalPlaces(1).toString(),
  };
}

type EarningRow = {
  transactionId: number;
  performedAt: Date;
  type: string;
  quantity: Prisma.Decimal;
  partnerPayable: Prisma.Decimal | null;
  referenceType: string | null;
  referenceId: number | null;
  item: { name: string };
};

export const partnerPayoutInclude = {
  creator: { select: { firstName: true, lastName: true } },
} as const;

type PayoutRow = Prisma.PartnerPayoutGetPayload<{
  include: typeof partnerPayoutInclude;
}>;

// ---- DTO mappers ----

export function toPartnerDTO(p: PartnerRow, stats?: PartnerStats): PartnerDTO {
  const dto: PartnerDTO = {
    partnerId: p.partnerId,
    name: p.name,
    phone: p.phone,
    defaultCostPct: p.defaultCostPct.toString(),
    defaultProfitPct: p.defaultProfitPct.toString(),
    dailyMinimum: p.dailyMinimum?.toFixed(2) ?? null,
    notes: p.notes,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
  };
  if (stats) {
    dto.itemCount = stats.itemCount;
    dto.money = toMoneyDTO(stats);
  }
  return dto;
}

export function toPartnerPayoutDTO(p: PayoutRow): PartnerPayoutDTO {
  return {
    payoutId: p.payoutId,
    partnerId: p.partnerId,
    amount: p.amount.toFixed(2),
    paidOn: toDateOnly(p.paidOn) ?? "",
    method: p.method,
    reference: p.reference,
    notes: p.notes,
    createdByName: p.creator
      ? `${p.creator.firstName} ${p.creator.lastName}`
      : null,
    createdAt: p.createdAt.toISOString(),
  };
}

export function toPartnerEarningDTO(t: EarningRow): PartnerEarningDTO {
  return {
    transactionId: t.transactionId,
    performedAt: t.performedAt.toISOString(),
    type: t.type as InventoryTxType,
    itemName: t.item.name,
    quantity: t.quantity.toString(),
    payable: (t.partnerPayable ?? D(0)).toFixed(2),
    invoiceNumber:
      t.referenceType === "invoice" && t.referenceId != null
        ? invoiceNumber(t.referenceId)
        : null,
  };
}

// ---- Ledger reads ----

// Live accruals only: a reversed row keeps its figures for the audit trail but
// is no longer owed. Dated on earnedOn, a date-only column, so it takes calendar
// bounds like payouts do rather than timestamp ones.
const LIVE_ACCRUAL = { reversedAt: null } as const;

type AccrualGroup = {
  partnerId: number;
  source: string;
  _sum: {
    amount: Prisma.Decimal | null;
    costPart: Prisma.Decimal | null;
    revenue: Prisma.Decimal | null;
  };
};

function foldAccruals(rows: AccrualGroup[]): Map<number, AccrualTotals> {
  const out = new Map<number, AccrualTotals>();
  for (const r of rows) {
    const totals = out.get(r.partnerId) ?? emptyAccruals();
    const amount = r._sum.amount ?? D(0);
    if (r.source === "guarantee") {
      totals.guarantee = totals.guarantee.plus(amount);
    } else {
      totals.service = totals.service.plus(amount);
      totals.serviceRevenue = totals.serviceRevenue.plus(r._sum.revenue ?? 0);
    }
    totals.costPart = totals.costPart.plus(r._sum.costPart ?? 0);
    out.set(r.partnerId, totals);
  }
  return out;
}

// ---- grouping helpers ----

function groupByPartner<T extends { partnerId: number | null }>(
  rows: T[],
): Map<number, T[]> {
  const buckets = new Map<number, T[]>();
  for (const row of rows) {
    if (row.partnerId == null) continue;
    const bucket = buckets.get(row.partnerId);
    if (bucket) bucket.push(row);
    else buckets.set(row.partnerId, [row]);
  }
  return buckets;
}

function mapValues<K, V, R>(
  source: Map<K, V>,
  transform: (value: V) => R,
): Map<K, R> {
  return new Map([...source].map(([key, value]) => [key, transform(value)]));
}

type ShelfRow = {
  itemId: number;
  currentStock: Prisma.Decimal;
  lastCost: Prisma.Decimal | null;
};

// What was on the shelf at the end of the range, worked back from today by
// reversing every movement recorded since. Movements are signed, so a receipt
// subtracts and a sale adds back.
//
// Both the quantity shown and the value derived from it go through here, so the
// two can never end up stating different dates: reading a row as "120 in stock,
// $0.00 held" was exactly that bug.
function stockAsAt(
  item: ShelfRow,
  movedSince?: Map<number, Prisma.Decimal>,
): Prisma.Decimal {
  const since = movedSince?.get(item.itemId) ?? D(0);
  const stock = item.currentStock.minus(since);
  // Floor at zero: a rollback can only go negative on inconsistent data, and
  // negative stock would be nonsense either way.
  return stock.greaterThan(0) ? stock : D(0);
}

// Unsold consigned stock as it stood at the end of the range: the partner's
// money still tied up rather than recovered.
//
// Quantities are exact. The valuation uses each item's *current* lastCost, which
// is the same approximation the live figure already makes: purchase cost is only
// kept as "most recent", not as a history.
// Rounded PER ITEM before adding up, because the per-item figure is the one on
// screen: the By item table prints a capital-held column, and a reader adding
// that column up has to land on the total above it. Summing the raw products
// and rounding once at the end is more precise and reads as wrong, since a few
// items hold a fractional stock whose value falls on half a cent (0.5 of a vial
// at 4.17 is 2.085), and 345 of those drift the total a cent or two off the
// column. The displayed figures are the money here, so they define the total.
function sumShelfValue(
  rows: ShelfRow[],
  movedSince?: Map<number, Prisma.Decimal>,
): Prisma.Decimal {
  return rows.reduce(
    (sum, item) =>
      sum.plus(
        stockAsAt(item, movedSince)
          .times(item.lastCost ?? 0)
          .toDecimalPlaces(2),
      ),
    D(0),
  );
}

// Shape of the movement rows every partner figure is derived from. Selected once
// here so the list, the detail page and the per-item breakdown all read the same
// frozen columns.
// What a set of sale movements actually PAID the partner: what the clinic owes
// for them, less the capital of theirs coming back inside that payment. For a
// partner who funds nothing the two are the same figure, since none of what
// they are owed is a stake being returned.
//
// Shares sumSaleMovements so the fallback for movements written before the
// split was frozen is applied here too, rather than drifting from it.
export function partnerEarningsOf(rows: SaleMovementRow[]): Prisma.Decimal {
  const totals = sumSaleMovements(rows);
  return totals.accrued.minus(totals.accruedCost);
}

export const saleMovementSelect = {
  partnerId: true,
  itemId: true,
  quantity: true,
  unitCost: true,
  salePrice: true,
  partnerPayable: true,
  partnerCostPart: true,
} as const;

// All partners. Sales figures cover `range`; balance and capital figures are the
// position as at its last day. Two passes over the movements rather than one:
// flow over a period and position at a date answer different questions and must
// not be conflated.
export async function getPartnersWithStats(
  range: AnalyticsRange,
): Promise<PartnerDTO[]> {
  const { from, toExclusive } = rangeBounds(range);
  // Payout dates are a date-only column, so they need calendar-date bounds.
  const { from: dateFrom, toExclusive: dateToExclusive } =
    dateOnlyBounds(range);

  const [
    partners,
    rangeRows,
    toDateRows,
    paidInRangeGroups,
    paidToDateGroups,
    items,
    movedSinceGroups,
    openings,
    accrualRangeGroups,
    accrualToDateGroups,
  ] = await Promise.all([
    prisma.partner.findMany({
      where: { deletedAt: null },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.inventoryTransaction.findMany({
      where: {
        partnerId: { not: null },
        performedAt: { gte: from, lt: toExclusive },
        ...SALE_MOVEMENT_FILTER,
      },
      select: saleMovementSelect,
    }),
    prisma.inventoryTransaction.findMany({
      where: {
        partnerId: { not: null },
        performedAt: { lt: toExclusive },
        ...SALE_MOVEMENT_FILTER,
      },
      select: saleMovementSelect,
    }),
    prisma.partnerPayout.groupBy({
      by: ["partnerId"],
      where: {
        deletedAt: null,
        paidOn: { gte: dateFrom, lt: dateToExclusive },
      },
      _sum: { amount: true },
    }),
    prisma.partnerPayout.groupBy({
      by: ["partnerId"],
      where: { deletedAt: null, paidOn: { lt: dateToExclusive } },
      _sum: { amount: true },
    }),
    prisma.inventoryItem.findMany({
      where: { partnerId: { not: null }, deletedAt: null },
      select: {
        itemId: true,
        partnerId: true,
        currentStock: true,
        lastCost: true,
      },
    }),
    // Every movement since the range ended, so today's stock can be rolled back
    // to what was on the shelf then. Empty when the range ends today, which is
    // the default, so the usual view costs nothing extra.
    prisma.inventoryTransaction.groupBy({
      by: ["itemId"],
      where: {
        performedAt: { gte: toExclusive },
        item: { partnerId: { not: null } },
      },
      _sum: { quantity: true },
    }),
    prisma.openingBalance.findMany({
      where: { partnerId: { not: null } },
      select: { partnerId: true, amount: true, asOfDate: true },
    }),
    // Services and guarantees, the second and third things a partner can be
    // owed for. Grouped by source so the two read separately on screen.
    prisma.partnerAccrual.groupBy({
      by: ["partnerId", "source"],
      where: {
        ...LIVE_ACCRUAL,
        earnedOn: { gte: dateFrom, lt: dateToExclusive },
      },
      _sum: { amount: true, costPart: true, revenue: true },
    }),
    prisma.partnerAccrual.groupBy({
      by: ["partnerId", "source"],
      where: { ...LIVE_ACCRUAL, earnedOn: { lt: dateToExclusive } },
      _sum: { amount: true, costPart: true, revenue: true },
    }),
  ]);

  const movedSince = new Map(
    movedSinceGroups.map((g) => [g.itemId, g._sum.quantity ?? D(0)]),
  );

  const rangeMap = mapValues(groupByPartner(rangeRows), sumSaleMovements);
  const toDateMap = mapValues(groupByPartner(toDateRows), sumSaleMovements);
  const itemsByPartner = groupByPartner(items);
  const shelfMap = mapValues(itemsByPartner, (rows) =>
    sumShelfValue(rows, movedSince),
  );
  const itemCountMap = mapValues(itemsByPartner, (rows) => rows.length);
  const paidInRangeMap = new Map(
    paidInRangeGroups.map((g) => [g.partnerId, g._sum.amount ?? D(0)]),
  );
  const paidToDateMap = new Map(
    paidToDateGroups.map((g) => [g.partnerId, g._sum.amount ?? D(0)]),
  );
  // At most one per partner, so the last write wins harmlessly.
  const openingMap = new Map(openings.map((o) => [o.partnerId, o]));
  const accrualRangeMap = foldAccruals(accrualRangeGroups);
  const accrualToDateMap = foldAccruals(accrualToDateGroups);

  return partners.map((p) =>
    toPartnerDTO(p, {
      itemCount: itemCountMap.get(p.partnerId) ?? 0,
      inRange: rangeMap.get(p.partnerId) ?? emptyTotals(),
      paidInRange: paidInRangeMap.get(p.partnerId) ?? D(0),
      toDate: toDateMap.get(p.partnerId) ?? emptyTotals(),
      paidToDate: paidToDateMap.get(p.partnerId) ?? D(0),
      capitalOnShelf: shelfMap.get(p.partnerId) ?? D(0),
      opening: openingMap.get(p.partnerId)?.amount ?? D(0),
      openingAsOf: openingMap.get(p.partnerId)?.asOfDate ?? null,
      accrualsInRange: accrualRangeMap.get(p.partnerId) ?? emptyAccruals(),
      accrualsToDate: accrualToDateMap.get(p.partnerId) ?? emptyAccruals(),
    }),
  );
}

// Active partners only, for the inventory item picker (no stats needed).
export async function getActivePartners(): Promise<PartnerDTO[]> {
  const partners = await prisma.partner.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { name: "asc" },
  });
  return partners.map((p) => toPartnerDTO(p));
}

// ---- Partner detail ----
//
// One header read, plus three ledgers that each fetch their own page when the
// section is opened. It used to be a single call that returned every item the
// partner sources whatever the range: 345 rows and 75 KB for a page whose
// headline question is "what do I owe them", answered by the figures alone.

// Everything above the ledgers: the deal, the period figures and the position.
export async function getPartnerHeader(
  partnerId: number,
  range: AnalyticsRange,
): Promise<{ partner: PartnerDTO } | null> {
  const partner = await prisma.partner.findFirst({
    where: { partnerId, deletedAt: null },
  });
  if (!partner) return null;

  const { from, toExclusive } = rangeBounds(range);
  // Payout dates are a date-only column, so they need calendar-date bounds.
  const { from: dateFrom, toExclusive: dateToExclusive } =
    dateOnlyBounds(range);

  const [
    rangeRows,
    toDateRows,
    paidInRangeAgg,
    paidToDateAgg,
    items,
    movedSinceGroups,
    opening,
    accrualRangeGroups,
    accrualToDateGroups,
    lastMovement,
  ] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where: {
        partnerId,
        performedAt: { gte: from, lt: toExclusive },
        ...SALE_MOVEMENT_FILTER,
      },
      select: saleMovementSelect,
    }),
    prisma.inventoryTransaction.findMany({
      where: {
        partnerId,
        performedAt: { lt: toExclusive },
        ...SALE_MOVEMENT_FILTER,
      },
      select: saleMovementSelect,
    }),
    prisma.partnerPayout.aggregate({
      _sum: { amount: true },
      where: {
        partnerId,
        deletedAt: null,
        paidOn: { gte: dateFrom, lt: dateToExclusive },
      },
    }),
    prisma.partnerPayout.aggregate({
      _sum: { amount: true },
      where: { partnerId, deletedAt: null, paidOn: { lt: dateToExclusive } },
    }),
    // Shelf columns only. The header needs what the stock is worth and how many
    // lines there are, not the lines themselves: those belong to the By item
    // section, which pages them.
    prisma.inventoryItem.findMany({
      where: { partnerId, deletedAt: null },
      select: { itemId: true, currentStock: true, lastCost: true },
    }),
    // Movements since the range ended, so stock can be rolled back to what was
    // on the shelf then.
    prisma.inventoryTransaction.groupBy({
      by: ["itemId"],
      where: { performedAt: { gte: toExclusive }, item: { partnerId } },
      _sum: { quantity: true },
    }),
    prisma.openingBalance.findFirst({
      where: { partnerId },
      orderBy: { asOfDate: "asc" },
      select: { amount: true, asOfDate: true },
    }),
    prisma.partnerAccrual.groupBy({
      by: ["partnerId", "source"],
      where: {
        partnerId,
        ...LIVE_ACCRUAL,
        earnedOn: { gte: dateFrom, lt: dateToExclusive },
      },
      _sum: { amount: true, costPart: true, revenue: true },
    }),
    prisma.partnerAccrual.groupBy({
      by: ["partnerId", "source"],
      where: { partnerId, ...LIVE_ACCRUAL, earnedOn: { lt: dateToExclusive } },
      _sum: { amount: true, costPart: true, revenue: true },
    }),
    // Ignores the range on purpose: it is the answer to "why is every table
    // below empty", so it has to be able to point outside the dates.
    prisma.inventoryTransaction.findFirst({
      where: { partnerId, ...SALE_MOVEMENT_FILTER },
      orderBy: { performedAt: "desc" },
      select: { performedAt: true },
    }),
  ]);

  const movedSince = new Map(
    movedSinceGroups.map((g) => [g.itemId, g._sum.quantity ?? D(0)]),
  );

  const dto = toPartnerDTO(partner, {
    itemCount: items.length,
    inRange: sumSaleMovements(rangeRows),
    toDate: sumSaleMovements(toDateRows),
    paidInRange: paidInRangeAgg._sum.amount ?? D(0),
    paidToDate: paidToDateAgg._sum.amount ?? D(0),
    capitalOnShelf: sumShelfValue(items, movedSince),
    opening: opening?.amount ?? D(0),
    openingAsOf: opening?.asOfDate ?? null,
    accrualsInRange:
      foldAccruals(accrualRangeGroups).get(partnerId) ?? emptyAccruals(),
    accrualsToDate:
      foldAccruals(accrualToDateGroups).get(partnerId) ?? emptyAccruals(),
  });
  dto.lastMovementAt = lastMovement?.performedAt.toISOString() ?? null;

  return { partner: dto };
}

// Where a page of rows starts. The page index is already validated as a
// non-negative integer by the query schema.
function skipFor(page: number): number {
  return page * PARTNER_PAGE_SIZE;
}

// The sale movements behind the balance, newest first, for the range.
//
// Filtered to sale movements like every money figure on the page is, so the
// ledger and the totals above it can never disagree about what counts. Ordered
// by id as well as time because a single invoice writes several movements on
// the same timestamp, and a page boundary landing inside one of those groups
// would otherwise drop or repeat rows.
export async function getPartnerSales(
  partnerId: number,
  range: AnalyticsRange,
  page: number,
): Promise<PartnerSalesPage> {
  const { from, toExclusive } = rangeBounds(range);
  const where: Prisma.InventoryTransactionWhereInput = {
    partnerId,
    performedAt: { gte: from, lt: toExclusive },
    ...SALE_MOVEMENT_FILTER,
  };
  const [rows, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      orderBy: [{ performedAt: "desc" }, { transactionId: "desc" }],
      skip: skipFor(page),
      take: PARTNER_PAGE_SIZE,
      select: {
        transactionId: true,
        performedAt: true,
        type: true,
        quantity: true,
        partnerPayable: true,
        referenceType: true,
        referenceId: true,
        item: { select: { name: true } },
      },
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);
  return { rows: rows.map(toPartnerEarningDTO), total };
}

// Payouts recorded inside the range, newest first.
export async function getPartnerPayouts(
  partnerId: number,
  range: AnalyticsRange,
  page: number,
): Promise<PartnerPayoutsPage> {
  const { from, toExclusive } = dateOnlyBounds(range);
  const where: Prisma.PartnerPayoutWhereInput = {
    partnerId,
    deletedAt: null,
    paidOn: { gte: from, lt: toExclusive },
  };
  const [rows, total] = await Promise.all([
    prisma.partnerPayout.findMany({
      where,
      orderBy: [{ paidOn: "desc" }, { payoutId: "desc" }],
      skip: skipFor(page),
      take: PARTNER_PAGE_SIZE,
      include: partnerPayoutInclude,
    }),
    prisma.partnerPayout.count({ where }),
  ]);
  return { rows: rows.map(toPartnerPayoutDTO), total };
}

// Per-item performance over the range, a page at a time. Every item the partner
// sources appears, including ones that sold nothing, since a line sitting still
// is exactly what the clinic wants to spot. Ordered by name so the pages are
// stable and a reader can find a line where they expect it.
//
// The movement reads are scoped to the page's items rather than to the whole
// partner, so a partner with hundreds of lines costs no more to page through
// than one with a dozen.
export async function getPartnerItems(
  partnerId: number,
  range: AnalyticsRange,
  page: number,
): Promise<PartnerItemsPage> {
  const { from, toExclusive } = rangeBounds(range);
  const where: Prisma.InventoryItemWhereInput = { partnerId, deletedAt: null };

  const [items, total] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      select: {
        itemId: true,
        name: true,
        unit: true,
        currentStock: true,
        lastCost: true,
      },
      orderBy: { name: "asc" },
      skip: skipFor(page),
      take: PARTNER_PAGE_SIZE,
    }),
    prisma.inventoryItem.count({ where }),
  ]);
  const itemIds = items.map((i) => i.itemId);

  const [rangeRows, movedSinceGroups] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where: {
        partnerId,
        itemId: { in: itemIds },
        performedAt: { gte: from, lt: toExclusive },
        ...SALE_MOVEMENT_FILTER,
      },
      select: saleMovementSelect,
    }),
    prisma.inventoryTransaction.groupBy({
      by: ["itemId"],
      where: { itemId: { in: itemIds }, performedAt: { gte: toExclusive } },
      _sum: { quantity: true },
    }),
  ]);

  const movedSince = new Map(
    movedSinceGroups.map((g) => [g.itemId, g._sum.quantity ?? D(0)]),
  );
  const rowsByItem = new Map<number, typeof rangeRows>();
  for (const row of rangeRows) {
    const bucket = rowsByItem.get(row.itemId);
    if (bucket) bucket.push(row);
    else rowsByItem.set(row.itemId, [row]);
  }

  const rows: PartnerItemPerformanceDTO[] = items.map((item) => {
    const totals = sumSaleMovements(rowsByItem.get(item.itemId) ?? []);
    // Measured against the stock's cost, exactly as toMoneyDTO does, so these
    // rows add up to the header figures at any pair of rates.
    const partnerShare = totals.accrued.minus(totals.costOfSales);
    const grossProfit = totals.revenue.minus(totals.costOfSales);
    return {
      itemId: item.itemId,
      itemName: item.name,
      unit: item.unit,
      currentStock: stockAsAt(item, movedSince).toNumber(),
      capitalOnShelf: sumShelfValue([item], movedSince).toFixed(2),
      unitsSold: totals.unitsSold.toString(),
      revenue: totals.revenue.toFixed(2),
      costOfSales: totals.costOfSales.toFixed(2),
      grossProfit: grossProfit.toFixed(2),
      partnerShare: partnerShare.toFixed(2),
      clinicShare: grossProfit.minus(partnerShare).toFixed(2),
    };
  });

  return { rows, total };
}
