import { prisma } from "@/lib/prisma";
import { computePartnerPayable, effectiveRates } from "@/lib/partners";
import { BOOKING_STATUSES } from "@/types/enums";
import {
  buildBuckets,
  bucketKeyOf,
  formatLocalDate,
  pickGranularity,
  rangeBounds,
  dateOnlyBounds,
  priorRange,
  type Bucket,
  type Granularity,
} from "@/utils/date-range";
import {
  AD_HOC_LABEL,
  CATEGORY_GROUPS,
  CLIENT_LIST_LIMIT,
  COUNTER_SALE_LEGACY_CLIENT_ID,
  GROOMING_SERVICE_CATEGORY,
  ITEM_SEARCH_LIMIT,
  NON_TRADE_SERVICE_CATEGORIES,
  TOP_ITEMS_LIMIT,
  UNCATEGORISED_LABEL,
  type CategoryGroupKey,
} from "@/constants/analytics";
import type { AnalyticsSection, ClientListKind } from "@/schemas/analytics";
import type {
  AnalyticsRange,
  BookingsAnalytics,
  CategoriesAnalytics,
  CategoryComparison,
  CategoryTrendGroup,
  CategoryTrendRow,
  ClientActivityRow,
  ClientsAnalytics,
  InventoryAnalytics,
  ItemPerformanceDetail,
  ItemPerformanceRow,
  ItemSearchResult,
  ItemsAnalytics,
  NamedCount,
  NamedValue,
  ProfitAnalytics,
  PurchasesAnalytics,
  RevenueAnalytics,
} from "@/types/entities";

// Invoice statuses that represent real, billable revenue (Draft is not yet
// committed, Void is cancelled).
const REVENUE_STATUSES = ["Issued", "Partial", "Paid", "Overdue"];
// Statuses whose balance can still be outstanding.
const OPEN_STATUSES = ["Issued", "Partial", "Overdue"];

const DAY_MS = 24 * 60 * 60 * 1000;

// ---- small helpers ----

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function sumPayments(payments: { amount: { toNumber(): number } }[]): number {
  return payments.reduce((s, p) => s + p.amount.toNumber(), 0);
}

// Everything a range-scoped section needs: the query bounds plus the ordered
// buckets (daily for short ranges, monthly for long) and their granularity.
interface Prepared {
  from: Date;
  toExclusive: Date;
  granularity: Granularity;
  buckets: Bucket[];
}

function prepare(range: AnalyticsRange): Prepared {
  const { from, toExclusive } = rangeBounds(range);
  const granularity = pickGranularity(from, toExclusive);
  return {
    from,
    toExclusive,
    granularity,
    buckets: buildBuckets(from, toExclusive, granularity),
  };
}

// A zeroed number map keyed by bucket, ready to accumulate into.
function zeroMap(buckets: Bucket[]): Map<string, number> {
  return new Map(buckets.map((b) => [b.key, 0]));
}

function addTo(map: Map<string, number>, key: string, amount: number): void {
  const current = map.get(key);
  if (current !== undefined) map.set(key, current + amount);
}

// ---- section builders (range-scoped) ----

async function getRevenueSection(
  range: AnalyticsRange,
): Promise<RevenueAnalytics> {
  const { from, toExclusive, granularity, buckets } = prepare(range);
  const today = startOfToday();

  const [
    collectedAgg,
    invoicedAgg,
    avgAgg,
    voidCount,
    billedCount,
    openInvoices,
    trendInvoices,
    serviceGroups,
  ] = await Promise.all([
    prisma.payment.aggregate({
      _sum: { amount: true },
      where: { paidAt: { gte: from, lt: toExclusive } },
    }),
    prisma.invoice.aggregate({
      _sum: { total: true },
      where: {
        status: { in: REVENUE_STATUSES },
        issuedAt: { gte: from, lt: toExclusive },
      },
    }),
    prisma.invoice.aggregate({
      _avg: { total: true },
      where: {
        status: { in: REVENUE_STATUSES },
        issuedAt: { gte: from, lt: toExclusive },
      },
    }),
    prisma.invoice.count({
      where: { status: "Void", issuedAt: { gte: from, lt: toExclusive } },
    }),
    prisma.invoice.count({
      where: { issuedAt: { gte: from, lt: toExclusive } },
    }),
    // Aging + total outstanding are a snapshot of open balances as of today, so
    // they are intentionally not filtered by the range.
    prisma.invoice.findMany({
      where: { status: { in: OPEN_STATUSES } },
      select: {
        total: true,
        dueDate: true,
        payments: { select: { amount: true } },
      },
    }),
    prisma.invoice.findMany({
      where: {
        status: { in: REVENUE_STATUSES },
        issuedAt: { gte: from, lt: toExclusive },
      },
      select: {
        total: true,
        issuedAt: true,
        payments: { select: { amount: true } },
      },
    }),
    prisma.invoiceLineItem.groupBy({
      by: ["serviceId"],
      where: {
        serviceId: { not: null },
        invoice: {
          status: { in: REVENUE_STATUSES },
          issuedAt: { gte: from, lt: toExclusive },
        },
      },
      _sum: { lineTotal: true },
      orderBy: { _sum: { lineTotal: "desc" } },
      take: 8,
    }),
  ]);

  // Aging of outstanding balances (as of today).
  const aging = { current: 0, d1to30: 0, d31to60: 0, d61plus: 0 };
  let outstandingTotal = 0;
  for (const inv of openInvoices) {
    const balance = inv.total.toNumber() - sumPayments(inv.payments);
    if (balance <= 0) continue;
    outstandingTotal += balance;
    if (!inv.dueDate || inv.dueDate.getTime() >= today.getTime()) {
      aging.current += balance;
      continue;
    }
    const daysOverdue = Math.floor(
      (today.getTime() - inv.dueDate.getTime()) / DAY_MS,
    );
    if (daysOverdue <= 30) aging.d1to30 += balance;
    else if (daysOverdue <= 60) aging.d31to60 += balance;
    else aging.d61plus += balance;
  }

  // Collected vs still-outstanding per bucket, by issue date.
  const collectedMap = zeroMap(buckets);
  const outstandingMap = zeroMap(buckets);
  for (const inv of trendInvoices) {
    if (!inv.issuedAt) continue;
    const key = bucketKeyOf(inv.issuedAt, granularity);
    const paid = sumPayments(inv.payments);
    addTo(collectedMap, key, paid);
    addTo(outstandingMap, key, Math.max(inv.total.toNumber() - paid, 0));
  }
  const trend = buckets.map((b) => ({
    label: b.label,
    collected: round2(collectedMap.get(b.key) ?? 0),
    outstanding: round2(outstandingMap.get(b.key) ?? 0),
  }));

  // Top services by billed revenue within the range.
  const serviceIds = serviceGroups
    .map((g) => g.serviceId)
    .filter((id): id is number => id !== null);
  const services = await prisma.service.findMany({
    where: { serviceId: { in: serviceIds } },
    select: { serviceId: true, name: true },
  });
  const serviceNames = new Map(services.map((s) => [s.serviceId, s.name]));
  const byService = serviceGroups.map((g) => ({
    label: serviceNames.get(g.serviceId as number) ?? `Service #${g.serviceId}`,
    value: round2(g._sum.lineTotal?.toNumber() ?? 0),
  }));

  return {
    periodCollected: round2(collectedAgg._sum.amount?.toNumber() ?? 0),
    periodInvoiced: round2(invoicedAgg._sum.total?.toNumber() ?? 0),
    outstandingTotal: round2(outstandingTotal),
    avgInvoiceValue: round2(avgAgg._avg.total?.toNumber() ?? 0),
    voidRate: billedCount > 0 ? round2((voidCount / billedCount) * 100) : 0,
    aging: {
      current: round2(aging.current),
      d1to30: round2(aging.d1to30),
      d31to60: round2(aging.d31to60),
      d61plus: round2(aging.d61plus),
    },
    trend,
    byService,
  };
}

// Net profit within the range = revenue collected - COGS (whatever the clinic
// itself funded) - partner earnings - operating (running) costs. COGS and partner
// payouts are the frozen amounts on Sold movements (bucketed by sale date, void
// reversals net out); revenue is cash collected. Self-contained so it can be
// queried for a range independent of the revenue section.
//
// Stock sold under a partner deal is counted once and only once, split by who
// paid for it: the clinic's share of the cost lands in COGS, the partner's in
// their payout. Which is which comes from the frozen costPart on the movement,
// never from the presence of a partner.
async function getProfitSection(
  range: AnalyticsRange,
): Promise<ProfitAnalytics> {
  const { from, toExclusive, granularity, buckets } = prepare(range);
  // incurredOn is a date-only column and needs calendar-date bounds.
  const { from: dateFrom, toExclusive: dateToExclusive } =
    dateOnlyBounds(range);

  const [
    costAgg,
    costRows,
    categoryGroups,
    soldRows,
    partnerRows,
    accrualRows,
    paymentRows,
    unsoldRows,
  ] = await Promise.all([
    prisma.runningCost.aggregate({
      _sum: { amount: true },
      where: {
        deletedAt: null,
        incurredOn: { gte: dateFrom, lt: dateToExclusive },
      },
    }),
    prisma.runningCost.findMany({
      where: {
        deletedAt: null,
        incurredOn: { gte: dateFrom, lt: dateToExclusive },
      },
      select: { incurredOn: true, amount: true },
    }),
    prisma.runningCost.groupBy({
      by: ["category"],
      where: {
        deletedAt: null,
        incurredOn: { gte: dateFrom, lt: dateToExclusive },
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 8,
    }),
    // Sold movements carry the frozen unit cost; COGS = |qty| * unitCost. Giving
    // a sale back writes a Returned movement (referenceType "invoice") carrying
    // the same frozen cost at the opposite sign, so the signed sum below nets it
    // out. That covers both a voided invoice and a counter return, because they
    // are the same event to the ledger and now share one type.
    //
    // Partner items are INCLUDED. They used to be filtered out here on the
    // reasoning that their payout already carried their cost, but that is only
    // true of a deal that hands the partner their outlay back. On this clinic's
    // deal (0% cost, a share of the margin) the clinic buys the stock and the
    // payout returns none of it, so excluding these rows expensed nothing at all
    // and overstated profit by the full cost of every partner-item sale. What
    // the payout does cover is subtracted below, per row, rather than assumed.
    prisma.inventoryTransaction.findMany({
      where: {
        unitCost: { not: null },
        performedAt: { gte: from, lt: toExclusive },
        OR: [{ type: "Sold" }, { type: "Returned", referenceType: "invoice" }],
      },
      select: {
        performedAt: true,
        quantity: true,
        unitCost: true,
        partnerCostPart: true,
      },
    }),
    // Consignment payouts: the frozen amount owed to partners on their sold
    // items. Void reversals carry a negative payable, so they net out.
    prisma.inventoryTransaction.findMany({
      where: {
        partnerId: { not: null },
        performedAt: { gte: from, lt: toExclusive },
      },
      select: { performedAt: true, partnerPayable: true },
    }),
    // What partners earned that has no stock movement to hang off: a service
    // they performed, and a guaranteed day topped up. Both are real costs the
    // moment they are earned, and neither reached this calculation before, so a
    // partner on services was working for free as far as profit was concerned.
    //
    // Settling a partner is NOT read here and must not be. A payout moves cash
    // against a balance already expensed above; charging it again would count
    // every partner cost twice.
    //
    // reversedAt filters out a voided service line and an unsettled day, exactly
    // as the partner's own balance does, so the two never disagree. earnedOn is
    // date-only and takes calendar bounds.
    prisma.partnerAccrual.findMany({
      where: {
        reversedAt: null,
        earnedOn: { gte: dateFrom, lt: dateToExclusive },
      },
      select: { earnedOn: true, amount: true },
    }),
    // Collected revenue for the profit trend (cash basis).
    prisma.payment.findMany({
      where: { paidAt: { gte: from, lt: toExclusive } },
      select: { paidAt: true, amount: true },
    }),
    // Stock that left without a sale. Reported alongside profit, never inside
    // it: consumables are expensed via running costs, so charging their cost
    // here as well would count the same stock twice. Surfacing the figure lets
    // the clinic see what it consumes and what it bins.
    prisma.inventoryTransaction.findMany({
      where: {
        type: { in: ["Used", "Expired"] },
        unitCost: { not: null },
        performedAt: { gte: from, lt: toExclusive },
      },
      select: { type: true, quantity: true, unitCost: true },
    }),
  ]);

  const costMap = zeroMap(buckets);
  for (const row of costRows) {
    addTo(
      costMap,
      bucketKeyOf(row.incurredOn, granularity),
      row.amount.toNumber(),
    );
  }

  const cogsMap = zeroMap(buckets);
  for (const row of soldRows) {
    // Signed by direction: a Sold line has negative quantity (adds cost), a void
    // reversal has positive quantity (removes it), so a voided sale nets to zero.
    const cost = -row.quantity.toNumber() * (row.unitCost?.toNumber() ?? 0);
    // Less the part of that cost the partner is reimbursed for, which the payout
    // below already charges. costPart is the only honest measure of who funded
    // the stock: at a 0% cost rate it is zero and the whole cost stays the
    // clinic's, at 100% it equals the cost and this row contributes nothing.
    // Reversals negate costPart alongside the payable, so returns net out here
    // exactly as they do there.
    const clinicFunded = cost - (row.partnerCostPart?.toNumber() ?? 0);
    addTo(cogsMap, bucketKeyOf(row.performedAt, granularity), clinicFunded);
  }

  // Everything partners earn, whichever of the three ways they earned it. Stock
  // is frozen on the movement and dated by it; services and guaranteed days are
  // accruals dated by the day earned. One bucket, because a reader asking what
  // partners cost this month means all of it.
  const partnerMap = zeroMap(buckets);
  for (const row of partnerRows) {
    addTo(
      partnerMap,
      bucketKeyOf(row.performedAt, granularity),
      row.partnerPayable?.toNumber() ?? 0,
    );
  }
  for (const row of accrualRows) {
    addTo(
      partnerMap,
      bucketKeyOf(row.earnedOn, granularity),
      row.amount.toNumber(),
    );
  }

  const revenueMap = zeroMap(buckets);
  for (const row of paymentRows) {
    addTo(
      revenueMap,
      bucketKeyOf(row.paidAt, granularity),
      row.amount.toNumber(),
    );
  }

  const trend = buckets.map((b) => {
    const revenue = round2(revenueMap.get(b.key) ?? 0);
    const cogs = round2(cogsMap.get(b.key) ?? 0);
    const partnerCost = round2(partnerMap.get(b.key) ?? 0);
    const costs = round2(costMap.get(b.key) ?? 0);
    return {
      label: b.label,
      revenue,
      cogs,
      partnerCost,
      costs,
      profit: round2(revenue - cogs - partnerCost - costs),
    };
  });

  // Full cost breakdown: operating-cost categories plus COGS and partner earnings
  // as their own slices, so the chart shows where every cost dollar goes.
  const cogsTotal = round2([...cogsMap.values()].reduce((s, v) => s + v, 0));
  const partnerTotal = round2(
    [...partnerMap.values()].reduce((s, v) => s + v, 0),
  );
  const byCategory: NamedValue[] = categoryGroups.map((g) => ({
    label: g.category,
    value: round2(g._sum.amount?.toNumber() ?? 0),
  }));
  if (cogsTotal > 0)
    byCategory.push({ label: "Cost of goods sold", value: cogsTotal });
  if (partnerTotal > 0)
    byCategory.push({ label: "Partner earnings", value: partnerTotal });
  byCategory.sort((a, b) => b.value - a.value);
  byCategory.splice(8);

  const periodRevenue = round2(
    paymentRows.reduce((s, p) => s + p.amount.toNumber(), 0),
  );
  const periodCosts = round2(costAgg._sum.amount?.toNumber() ?? 0);
  // Note what is absent: clinic use and write-offs. They are reported below but
  // never subtracted here, because running costs already expense consumables.
  const periodProfit = round2(
    periodRevenue - cogsTotal - partnerTotal - periodCosts,
  );

  // Used and Expired both carry a negative quantity, so negating gives the
  // amount that left the shelf.
  let clinicUse = 0;
  let writeOffs = 0;
  for (const row of unsoldRows) {
    const value = -row.quantity.toNumber() * (row.unitCost?.toNumber() ?? 0);
    if (row.type === "Used") clinicUse += value;
    else writeOffs += value;
  }

  return {
    periodRevenue,
    periodCogs: cogsTotal,
    periodPartnerCost: partnerTotal,
    periodCosts,
    periodProfit,
    periodClinicUse: round2(clinicUse),
    periodWriteOffs: round2(writeOffs),
    trend,
    byCategory,
  };
}

async function getBookingsSection(
  range: AnalyticsRange,
): Promise<BookingsAnalytics> {
  const { from, toExclusive, granularity, buckets } = prepare(range);

  const rows = await prisma.booking.findMany({
    where: { startsAt: { gte: from, lt: toExclusive } },
    select: { startsAt: true, status: true },
  });

  const volMap = zeroMap(buckets);
  const statusCounts = new Map<string, number>();
  const dayCounts = new Array(7).fill(0) as number[];
  for (const r of rows) {
    addTo(volMap, bucketKeyOf(r.startsAt, granularity), 1);
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
    // getDay(): 0=Sun..6=Sat -> shift so Mon=0.
    dayCounts[(r.startsAt.getDay() + 6) % 7] += 1;
  }

  const volumeTrend: NamedCount[] = buckets.map((b) => ({
    label: b.label,
    count: volMap.get(b.key) ?? 0,
  }));

  const statusMix: NamedCount[] = BOOKING_STATUSES.filter((s) =>
    statusCounts.has(s),
  ).map((s) => ({ label: s, count: statusCounts.get(s)! }));

  const total = rows.length;
  const pct = (n: number) => (total > 0 ? round2((n / total) * 100) : 0);

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const byWeekday: NamedCount[] = dayLabels.map((label, i) => ({
    label,
    count: dayCounts[i],
  }));

  return {
    periodCount: total,
    noShowRate: pct(statusCounts.get("No Show") ?? 0),
    cancellationRate: pct(statusCounts.get("Cancelled") ?? 0),
    completedRate: pct(statusCounts.get("Completed") ?? 0),
    volumeTrend,
    statusMix,
    byWeekday,
  };
}

// ---- category performance (period over period) ----

// Billed revenue per category for one window, as group -> category -> total.
//
// Billed rather than collected, on purpose: a payment settles an invoice, not a
// line, so cash cannot honestly be attributed to a category. Returns carry a
// negative lineTotal (see InvoiceLineItem.returnedFromLineId), so a refunded
// sale subtracts itself from its own category with no special handling here.
async function billedByCategory(
  range: AnalyticsRange,
): Promise<Map<CategoryGroupKey, Map<string, number>>> {
  const { from, toExclusive } = rangeBounds(range);

  const lines = await prisma.invoiceLineItem.findMany({
    where: {
      // A hidden line was consumed by the clinic, not billed. Its line_total is
      // still whatever the item would have sold for, so leaving it in would
      // report a box of gloves as revenue nobody was ever charged.
      isHidden: false,
      invoice: {
        status: { in: REVENUE_STATUSES },
        issuedAt: { gte: from, lt: toExclusive },
      },
    },
    select: {
      lineTotal: true,
      item: { select: { category: true } },
      service: { select: { category: true } },
    },
  });

  const out = new Map<CategoryGroupKey, Map<string, number>>(
    CATEGORY_GROUPS.map((g) => [g.key, new Map<string, number>()]),
  );
  for (const line of lines) {
    const [group, label] = classifyLine(line);
    const bucket = out.get(group)!;
    bucket.set(label, (bucket.get(label) ?? 0) + line.lineTotal.toNumber());
  }
  return out;
}

// Which business line a sold line belongs to, and under what name. A service
// line takes the service's category, split so grooming reads as its own trade
// rather than as veterinary work; a stock line takes the item's category.
function classifyLine(line: {
  item: { category: string | null } | null;
  service: { category: string | null } | null;
}): [CategoryGroupKey, string] {
  if (line.service) {
    const category = line.service.category ?? UNCATEGORISED_LABEL;
    if (NON_TRADE_SERVICE_CATEGORIES.has(category)) return ["other", category];
    return [
      category === GROOMING_SERVICE_CATEGORY ? "grooming" : "vet",
      category,
    ];
  }
  if (line.item) return ["products", line.item.category ?? UNCATEGORISED_LABEL];
  // Neither: a free-text line typed at the counter, with no category to take.
  return ["other", AD_HOC_LABEL];
}

function sumValues(map: Map<string, number>): number {
  let total = 0;
  for (const v of map.values()) total += v;
  return total;
}

function toTrendRow(
  label: string,
  current: number,
  prior: number,
): CategoryTrendRow {
  const delta = current - prior;
  return {
    label,
    current: round2(current),
    prior: round2(prior),
    delta: round2(delta),
    // Only a positive base gives a percentage any meaning. A window that billed
    // nothing, or that netted negative on returns, gets null and reads as "new"
    // rather than as a number the reader would have to distrust.
    percent: prior > 0 ? round2((delta / prior) * 100) : null,
  };
}

// Pair one window's totals against another's. Categories are unioned across
// both, so a line that sold last year and not this year still appears, showing
// the drop instead of quietly vanishing from the report.
function compareCategories(
  priorWindow: AnalyticsRange,
  current: Map<CategoryGroupKey, Map<string, number>>,
  prior: Map<CategoryGroupKey, Map<string, number>>,
): CategoryComparison {
  let currentTotal = 0;
  let priorTotal = 0;

  const groups: CategoryTrendGroup[] = [];
  for (const group of CATEGORY_GROUPS) {
    const cur = current.get(group.key) ?? new Map<string, number>();
    const pri = prior.get(group.key) ?? new Map<string, number>();

    const rows = [...new Set([...cur.keys(), ...pri.keys()])]
      .map((label) =>
        toTrendRow(label, cur.get(label) ?? 0, pri.get(label) ?? 0),
      )
      // A category that billed nothing in either window is noise, not a zero
      // worth a row.
      .filter((r) => r.current !== 0 || r.prior !== 0)
      .sort((a, b) => b.current - a.current);
    if (rows.length === 0) continue;

    const groupCurrent = sumValues(cur);
    const groupPrior = sumValues(pri);
    currentTotal += groupCurrent;
    priorTotal += groupPrior;
    groups.push({
      key: group.key,
      ...toTrendRow(group.label, groupCurrent, groupPrior),
      rows,
    });
  }

  return {
    priorRange: priorWindow,
    total: toTrendRow("All billed revenue", currentTotal, priorTotal),
    groups,
  };
}

// Month-on-month and year-on-year in one payload. Both comparisons share the
// current window, so they can never disagree about it, and the UI can flip
// between them without another round trip.
async function getCategoriesSection(
  range: AnalyticsRange,
): Promise<CategoriesAnalytics> {
  const momWindow = priorRange(range, "mom");
  const yoyWindow = priorRange(range, "yoy");

  const [current, mom, yoy] = await Promise.all([
    billedByCategory(range),
    billedByCategory(momWindow),
    billedByCategory(yoyWindow),
  ]);

  return {
    mom: compareCategories(momWindow, current, mom),
    yoy: compareCategories(yoyWindow, current, yoy),
  };
}

// ---- per-item performance ----

// Invoices whose lines count as trade, over the given window. Shared by every
// query in this part of the file so the leaderboard, the detail view and the
// search can never disagree about which sales exist.
function tradedInvoiceFilter(from: Date, toExclusive: Date) {
  return {
    status: { in: REVENUE_STATUSES },
    issuedAt: { gte: from, lt: toExclusive },
  };
}

// The running totals for one item, before they are rounded into a row.
interface ItemTally {
  unitsSold: number;
  unitsReturned: number;
  grossRevenue: number;
  refunded: number;
  saleLines: number;
  returnLines: number;
}

function emptyTally(): ItemTally {
  return {
    unitsSold: 0,
    unitsReturned: 0,
    grossRevenue: 0,
    refunded: 0,
    saleLines: 0,
    returnLines: 0,
  };
}

// Fold one invoice line into a tally. The sign of the quantity is the whole
// classification: a return is stored as a negative quantity against a positive
// unit price, so both sides are flipped back to positive figures here and the
// caller never has to remember which way round they were.
function addLine(
  tally: ItemTally,
  quantity: number,
  lineTotal: number,
  lineCount = 1,
): void {
  if (quantity < 0) {
    tally.unitsReturned += -quantity;
    tally.refunded += -lineTotal;
    tally.returnLines += lineCount;
  } else {
    tally.unitsSold += quantity;
    tally.grossRevenue += lineTotal;
    tally.saleLines += lineCount;
  }
}

// Turn a tally into the reported row. Quantities keep three decimals because
// stock is decimal (a part-pack sells as 0.25 of a bag); money keeps two.
function toItemRow(
  identity: {
    itemId: number;
    name: string;
    category: string | null;
    unit: string | null;
    barcode: string | null;
  },
  tally: ItemTally,
): ItemPerformanceRow {
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    ...identity,
    unitsSold: round3(tally.unitsSold),
    unitsReturned: round3(tally.unitsReturned),
    netUnits: round3(tally.unitsSold - tally.unitsReturned),
    grossRevenue: round2(tally.grossRevenue),
    refunded: round2(tally.refunded),
    netRevenue: round2(tally.grossRevenue - tally.refunded),
    saleLines: tally.saleLines,
    returnLines: tally.returnLines,
    // Nothing sold means there is no base to take a percentage of. Null says so
    // rather than printing a 0% that would read as "nothing came back".
    returnRate:
      tally.unitsSold > 0
        ? round2((tally.unitsReturned / tally.unitsSold) * 100)
        : null,
  };
}

// The leaderboard: the best-selling stock items over the window, ranked on net
// units, i.e. after what came back. Ranking on gross would put an item that
// sold forty and had thirty returned above one that quietly sold thirty-five.
//
// Stock items only. Services have no barcode and no stock position, so they
// belong to the category section rather than here.
async function getItemsSection(range: AnalyticsRange): Promise<ItemsAnalytics> {
  const { from, toExclusive } = rangeBounds(range);

  // Two grouped passes rather than one, split on the sign of the quantity, so
  // sold and returned stay separate figures instead of a single net sum that
  // could not be taken apart again.
  const [sold, returned] = await Promise.all(
    [{ gt: 0 }, { lt: 0 }].map((quantity) =>
      prisma.invoiceLineItem.groupBy({
        by: ["itemId"],
        where: {
          itemId: { not: null },
          // Consumed in the clinic, never sold. It belongs in operating costs,
          // which is where issuing files it, and not in what this item sold.
          isHidden: false,
          quantity,
          invoice: tradedInvoiceFilter(from, toExclusive),
        },
        _sum: { quantity: true, lineTotal: true },
        _count: { _all: true },
      }),
    ),
  );

  const tallies = new Map<number, ItemTally>();
  for (const group of [...sold, ...returned]) {
    if (group.itemId == null) continue;
    const tally = tallies.get(group.itemId) ?? emptyTally();
    addLine(
      tally,
      group._sum.quantity?.toNumber() ?? 0,
      group._sum.lineTotal?.toNumber() ?? 0,
      group._count._all,
    );
    tallies.set(group.itemId, tally);
  }

  const ranked = [...tallies.entries()]
    .sort((a, b) => {
      const netA = a[1].unitsSold - a[1].unitsReturned;
      const netB = b[1].unitsSold - b[1].unitsReturned;
      // Units first, then money as the tie-break: two items that each moved ten
      // units are not equally worth knowing about.
      if (netB !== netA) return netB - netA;
      return (
        b[1].grossRevenue - b[1].refunded - (a[1].grossRevenue - a[1].refunded)
      );
    })
    .slice(0, TOP_ITEMS_LIMIT);

  const items = await prisma.inventoryItem.findMany({
    where: { itemId: { in: ranked.map(([itemId]) => itemId) } },
    select: {
      itemId: true,
      name: true,
      category: true,
      unit: true,
      barcode: true,
    },
  });
  const byId = new Map(items.map((i) => [i.itemId, i]));

  return {
    topSold: ranked.map(([itemId, tally]) =>
      toItemRow(
        byId.get(itemId) ?? {
          itemId,
          // A deleted item still sold, so it keeps its place on the board under
          // an honest placeholder rather than dropping out of the totals.
          name: `Item #${itemId}`,
          category: null,
          unit: null,
          barcode: null,
        },
        tally,
      ),
    ),
  };
}

// Everything one item did over the window, for the detail view under the
// search. Reads the lines themselves rather than grouped sums: the trend, the
// distinct-invoice count and the last sale all need the individual rows, and a
// single item's lines are a small set even over a long range.
export async function getItemPerformance(
  itemId: number,
  range: AnalyticsRange,
): Promise<ItemPerformanceDetail | null> {
  const { from, toExclusive, granularity, buckets } = prepare(range);

  const [item, lines] = await Promise.all([
    prisma.inventoryItem.findUnique({
      where: { itemId },
      select: {
        itemId: true,
        name: true,
        category: true,
        unit: true,
        barcode: true,
        currentStock: true,
        salePrice: true,
      },
    }),
    prisma.invoiceLineItem.findMany({
      // isHidden excluded for the same reason as the tallies above: clinic use
      // is a cost, not a sale, and the two must not be added together.
      where: {
        itemId,
        isHidden: false,
        invoice: tradedInvoiceFilter(from, toExclusive),
      },
      select: {
        quantity: true,
        lineTotal: true,
        invoiceId: true,
        invoice: { select: { issuedAt: true, clientId: true } },
      },
    }),
  ]);
  // Soft-deleted items are still reported: they sold, and hiding the history of
  // a discontinued line is how a report starts disagreeing with the invoices.
  if (!item) return null;

  const tally = emptyTally();
  const soldMap = zeroMap(buckets);
  const returnedMap = zeroMap(buckets);
  const revenueMap = zeroMap(buckets);
  const invoiceIds = new Set<number>();
  const clientIds = new Set<number>();
  let lastSoldAt: Date | null = null;

  for (const line of lines) {
    const quantity = line.quantity.toNumber();
    const lineTotal = line.lineTotal.toNumber();
    addLine(tally, quantity, lineTotal);
    invoiceIds.add(line.invoiceId);
    if (line.invoice.clientId != null) clientIds.add(line.invoice.clientId);

    const issuedAt = line.invoice.issuedAt;
    if (!issuedAt) continue;
    const key = bucketKeyOf(issuedAt, granularity);
    if (quantity < 0) addTo(returnedMap, key, -quantity);
    else {
      addTo(soldMap, key, quantity);
      // Only a sale sets the last-sold date. A refund is the opposite of the
      // thing being asked about.
      if (!lastSoldAt || issuedAt > lastSoldAt) lastSoldAt = issuedAt;
    }
    // Revenue is net per bucket, so a refund shows up in the period it was
    // given, which is the period whose cash it actually changed.
    addTo(revenueMap, key, lineTotal);
  }

  const row = toItemRow(item, tally);

  return {
    ...row,
    currentStock: item.currentStock.toNumber(),
    salePrice: item.salePrice?.toNumber() ?? null,
    invoiceCount: invoiceIds.size,
    clientCount: clientIds.size,
    lastSoldAt: lastSoldAt ? (lastSoldAt as Date).toISOString() : null,
    // What a unit actually fetched, after returns and after whatever discount
    // was typed at the counter. Undefined when the returns cancel the sales out.
    avgUnitPrice:
      row.netUnits !== 0 ? round2(row.netRevenue / row.netUnits) : null,
    trend: buckets.map((b) => ({
      label: b.label,
      sold: Math.round((soldMap.get(b.key) ?? 0) * 1000) / 1000,
      returned: Math.round((returnedMap.get(b.key) ?? 0) * 1000) / 1000,
      revenue: round2(revenueMap.get(b.key) ?? 0),
    })),
  };
}

// Predictive search behind the item picker, matching on name, category and
// barcode. Alternate codes are searched too (see InventoryBarcode): a carton
// scanned at the counter carries the case code, not the item's primary one, so
// a search that only looked at the primary column would fail on exactly the
// codes someone is most likely to scan into the box.
export async function searchAnalyticsItems(
  query: string,
): Promise<ItemSearchResult[]> {
  const q = query.trim();
  const select = {
    itemId: true,
    name: true,
    category: true,
    barcode: true,
    unit: true,
  };

  const items = await prisma.inventoryItem.findMany({
    where: {
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { category: { contains: q, mode: "insensitive" as const } },
              { barcode: { contains: q, mode: "insensitive" as const } },
              { barcodes: { some: { gtin: { contains: q } } } },
            ],
          }
        : {}),
    },
    select,
    orderBy: [{ name: "asc" }, { itemId: "asc" }],
    take: ITEM_SEARCH_LIMIT,
  });

  return items;
}

// ---- clients ----

// Booking statuses that never put the client in front of anyone. A cancellation
// and a no-show are appointments that did not happen, so neither counts as a
// visit and neither keeps a client off the lapsed list. Anything else does.
const NON_VISIT_BOOKING_STATUSES = ["Cancelled", "No Show"];

// The top and lapsed lists in full, before the section trims them to a page.
interface ClientLists {
  top: ClientActivityRow[];
  lapsed: ClientActivityRow[];
}

// Both client lists come out of one pass, because they are the same question
// asked from either end: who traded in this window, and who did not.
//
// Activity means an issued invoice or an attended booking. Reading bookings
// alone, which is what the lapsed count used to do, marks very nearly the whole
// book lapsed: this clinic sells over the counter, and the imported history
// carries thousands of invoices with no appointment behind them.
//
// Everything is measured as at the range end, so a client added after it is not
// reported as having gone quiet during a window they did not exist in.
async function buildClientLists(range: AnalyticsRange): Promise<ClientLists> {
  const { from, toExclusive } = rangeBounds(range);

  const [clients, periodBilling, lifetimeBilling, lastBookings] =
    await Promise.all([
      prisma.client.findMany({
        where: {
          deletedAt: null,
          createdAt: { lt: toExclusive },
          // Spelled as an OR because `legacyId: { not: n }` compiles to
          // `legacy_id <> n`, which is NULL, and so false, for every client
          // created in this app rather than imported. That silently drops them
          // from both lists.
          OR: [
            { legacyId: null },
            { legacyId: { not: COUNTER_SALE_LEGACY_CLIENT_ID } },
          ],
        },
        select: {
          clientId: true,
          firstName: true,
          lastName: true,
          phone: true,
          phone2: true,
          email: true,
          accountBalance: true,
        },
      }),
      prisma.invoice.groupBy({
        by: ["clientId"],
        // A walk-in belongs to no account, so it can neither top the list nor
        // fall off it.
        where: {
          clientId: { not: null },
          ...tradedInvoiceFilter(from, toExclusive),
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
      // Lifetime rather than in-period: it is what dates the last visit, and on
      // the lapsed list it is what says whether the client walking away was
      // worth chasing.
      prisma.invoice.groupBy({
        by: ["clientId"],
        where: {
          clientId: { not: null },
          status: { in: REVENUE_STATUSES },
          issuedAt: { lt: toExclusive },
        },
        _sum: { total: true },
        _max: { issuedAt: true },
      }),
      prisma.booking.groupBy({
        by: ["clientId"],
        where: {
          status: { notIn: NON_VISIT_BOOKING_STATUSES },
          startsAt: { lt: toExclusive },
        },
        _max: { startsAt: true },
      }),
    ]);

  const period = new Map(
    periodBilling.flatMap((g) =>
      g.clientId === null
        ? []
        : [
            [
              g.clientId,
              {
                billed: g._sum.total?.toNumber() ?? 0,
                invoices: g._count._all,
              },
            ] as const,
          ],
    ),
  );
  const lifetime = new Map(
    lifetimeBilling.flatMap((g) =>
      g.clientId === null
        ? []
        : [
            [
              g.clientId,
              {
                billed: g._sum.total?.toNumber() ?? 0,
                lastAt: g._max.issuedAt,
              },
            ] as const,
          ],
    ),
  );
  const lastBooking = new Map(
    lastBookings.map((g) => [g.clientId, g._max.startsAt] as const),
  );

  const top: ClientActivityRow[] = [];
  const lapsed: ClientActivityRow[] = [];

  for (const c of clients) {
    const traded = period.get(c.clientId);
    const ever = lifetime.get(c.clientId);
    const booked = lastBooking.get(c.clientId) ?? null;
    const invoiced = ever?.lastAt ?? null;
    // The later of the two, and null only for a client who has never been
    // billed and never had an appointment.
    const seenAt =
      invoiced && booked
        ? invoiced > booked
          ? invoiced
          : booked
        : (invoiced ?? booked);

    const row: ClientActivityRow = {
      clientId: c.clientId,
      name: `${c.firstName} ${c.lastName}`.trim(),
      // Falls back to the second number: for many imported clients that is the
      // one that actually reaches them.
      phone: c.phone ?? c.phone2 ?? null,
      email: c.email,
      invoices: traded?.invoices ?? 0,
      billed: round2(traded?.billed ?? 0),
      lifetimeBilled: round2(ever?.billed ?? 0),
      accountBalance: c.accountBalance.toNumber(),
      lastActivity: seenAt ? formatLocalDate(seenAt) : null,
    };

    if (traded) top.push(row);
    // Nothing seen inside the window. Both halves of seenAt are capped at the
    // range end, so "before the window opened" is the whole of it.
    if (!seenAt || seenAt < from) lapsed.push(row);
  }

  top.sort(
    (a, b) =>
      b.billed - a.billed ||
      b.invoices - a.invoices ||
      a.name.localeCompare(b.name),
  );
  // Most recently seen first: the freshest lapses are the ones still worth a
  // phone call, and the client who has never been in at all goes last.
  lapsed.sort(
    (a, b) =>
      (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") ||
      a.name.localeCompare(b.name),
  );

  return { top, lapsed };
}

// One client list in full, for the download. The table on screen shows a page
// of the same list, so the file is never a different answer to the same
// question, only a longer one.
export async function getClientListExport(
  list: ClientListKind,
  range: AnalyticsRange,
): Promise<ClientActivityRow[]> {
  const lists = await buildClientLists(range);
  return list === "top" ? lists.top : lists.lapsed;
}

// Clients and patients over a window. The head-count figures (clients on file,
// patients, patients per client) are a position and stay a snapshot of right
// now; everything else follows the range picked at the top of the section.
async function getClientsSection(
  range: AnalyticsRange,
): Promise<ClientsAnalytics> {
  const { from, toExclusive, granularity, buckets } = prepare(range);

  const [totalActive, totalPatients, newRows, speciesGroups, lists] =
    await Promise.all([
      prisma.client.count({ where: { deletedAt: null } }),
      prisma.patient.count({ where: { deletedAt: null } }),
      prisma.client.findMany({
        where: {
          deletedAt: null,
          createdAt: { gte: from, lt: toExclusive },
        },
        select: { createdAt: true },
      }),
      prisma.patient.groupBy({
        by: ["species"],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { _count: { species: "desc" } },
      }),
      buildClientLists(range),
    ]);

  const newMap = zeroMap(buckets);
  for (const row of newRows) {
    addTo(newMap, bucketKeyOf(row.createdAt, granularity), 1);
  }
  const newTrend: NamedCount[] = buckets.map((b) => ({
    label: b.label,
    count: newMap.get(b.key) ?? 0,
  }));

  const speciesMix: NamedCount[] = speciesGroups
    .map((g) => ({ label: g.species ?? "Unknown", count: g._count._all }))
    .slice(0, 8);

  return {
    totalActive,
    newInPeriod: newRows.length,
    lapsed: lists.lapsed.length,
    totalPatients,
    avgPatientsPerClient:
      totalActive > 0 ? round2(totalPatients / totalActive) : 0,
    newTrend,
    speciesMix,
    topClients: lists.top.slice(0, CLIENT_LIST_LIMIT),
    lapsedClients: lists.lapsed.slice(0, CLIENT_LIST_LIMIT),
    tradingCount: lists.top.length,
  };
}

// ---- snapshot sections (not time-boxed) ----

// Stock as it stands right now: levels, valuation and warnings, none of which
// are a flow and so none of which take a date range. What sold is a flow, and
// lives in the items section instead, off the invoice lines rather than off
// stock movements so returns net out of it.
export async function getInventorySnapshot(): Promise<InventoryAnalytics> {
  const today = startOfToday();
  const in30Days = new Date(today.getTime() + 30 * DAY_MS);

  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    select: {
      itemId: true,
      name: true,
      currentStock: true,
      reorderLevel: true,
      unit: true,
      salePrice: true,
      lastCost: true,
      partnerId: true,
      // The deal in force on a consigned item, needed to say how much of the
      // margin on the shelf is the partner's rather than the clinic's. Both
      // rates fall back to the partner's defaults, which is why the partner
      // travels with the row.
      partnerCostPct: true,
      partnerProfitPct: true,
      partner: { select: { defaultCostPct: true, defaultProfitPct: true } },
      expiryDate: true,
      tracksExpiry: true,
      // Soonest dated batch still on the shelf. For a tracked item this is the
      // expiry that matters; the column above only speaks for items that are
      // not batched.
      batches: {
        where: { quantity: { gt: 0 }, expiryDate: { not: null } },
        orderBy: { expiryDate: "asc" },
        take: 1,
        select: { expiryDate: true },
      },
    },
  });

  // The shelf costed, priced, and the gap between the two split by whose money
  // it is. Reading a single "stock value" was what made the figure impossible
  // to reconcile against the old system: that number is clinic-funded stock
  // only, so it comes up short of a report that counts every item on the shelf,
  // and nothing on the screen said so.
  //
  // The identity these keep is what makes the card checkable by eye:
  //
  //   stockCost + clinicProfit + partnerShare === retailValue
  //
  // Cost is what the CLINIC paid for the stock on the shelf, and a partner deal
  // does not by itself mean the clinic paid nothing. Nothing in the schema
  // records who funded an item, so the cost rate stands in for it, and it is a
  // faithful stand-in: the share of cost that flows back to the partner on a
  // sale is the share the partner put up. At this clinic's 0% every item was
  // bought by the clinic, partner-linked or not, and the partner simply takes a
  // cut of the margin. At 100% the partner fronted it and is made whole.
  //
  //   an item at 100, sold at 150, partner on 0% cost and 50% profit
  //   -> cost 100 is the clinic's, partner takes 25, clinic keeps 125
  //
  // Reading a single "stock value" was what made the figure impossible to
  // reconcile against the old system: it counted clinic-owned items only, on the
  // assumption that a partner item was the partner's money. Here it never was.
  let ownedCost = 0; // stock carrying no partner deal, at cost
  let consignedCost = 0; // stock under a partner deal, at cost
  let retailValue = 0; // the whole shelf at its sale price
  let partnerShare = 0; // the whole payout owed on consigned stock
  let partnerCostPart = 0; // how much of that payout is outlay coming back
  let itemsMissingCost = 0;
  let itemsMissingPrice = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let expiringSoonCount = 0;
  for (const it of items) {
    // No fallback to sale price. Valuing stock at retail because its cost was
    // never recorded overstates the asset, and it disagreed with the partner
    // valuation in lib/partners, which has always used `lastCost ?? 0`. Items
    // with no cost are counted instead, so the gap is stated rather than
    // quietly filled in.
    const unitCost = it.lastCost?.toNumber() ?? 0;
    const unitPrice = it.salePrice?.toNumber() ?? 0;
    const stock = it.currentStock.toNumber();
    const costValue = stock * unitCost;
    retailValue += stock * unitPrice;
    if (stock > 0 && it.lastCost == null) itemsMissingCost += 1;
    if (stock > 0 && it.salePrice == null) itemsMissingPrice += 1;
    if (it.partnerId == null) {
      ownedCost += costValue;
    } else {
      consignedCost += costValue;
      // Costed through the same function the invoice pays out on, so this card
      // and the partner's balance can never tell two different stories about
      // the same deal.
      const payable = computePartnerPayable(
        stock,
        unitPrice,
        unitCost,
        effectiveRates(it, it.partner),
      );
      // Taken whole, and its cost half taken from costPart rather than by
      // subtracting the item's cost from it. Those are not the same number: the
      // payout returns `cost * costPct%`, so at this clinic's 0% the partner
      // gets no outlay back at all and subtracting cost would report their
      // earnings as a large negative. costPart exists precisely because a cost
      // rate that is not 100 makes that subtraction wrong.
      partnerShare += payable.total.toNumber();
      partnerCostPart += payable.costPart.toNumber();
    }
    if (stock <= 0) outOfStockCount += 1;
    if (it.reorderLevel > 0 && stock <= it.reorderLevel) lowStockCount += 1;
    const expiry = it.tracksExpiry
      ? (it.batches[0]?.expiryDate ?? null)
      : it.expiryDate;
    if (
      expiry &&
      expiry.getTime() >= today.getTime() &&
      expiry.getTime() <= in30Days.getTime()
    ) {
      expiringSoonCount += 1;
    }
  }

  const lowStockItems = items
    .filter(
      (it) =>
        it.reorderLevel > 0 && it.currentStock.toNumber() <= it.reorderLevel,
    )
    .sort(
      (a, b) =>
        a.currentStock.toNumber() -
        a.reorderLevel -
        (b.currentStock.toNumber() - b.reorderLevel),
    )
    .slice(0, 10)
    .map((it) => ({
      itemId: it.itemId,
      name: it.name,
      currentStock: it.currentStock.toNumber(),
      reorderLevel: it.reorderLevel,
      unit: it.unit,
    }));

  const outOfStockItems = items
    .filter((it) => it.currentStock.toNumber() <= 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 10)
    .map((it) => ({ itemId: it.itemId, name: it.name, unit: it.unit }));

  // Rounded first, then the clinic's share taken as the residual of the rounded
  // figures rather than rounded on its own. Rounding three sums independently
  // lets them miss the total by a cent or two, and a card whose whole point is
  // that the lines add up cannot afford to be a cent out. Any sub-cent
  // remainder therefore lands on the clinic, which is the same convention
  // computePartnerPayable already uses for the residual half of a line.
  //
  // A shelf holding items priced below cost makes this negative, which is the
  // honest answer rather than something to floor at zero.
  // Everything on the shelf at cost, less whatever part of it a partner fronted
  // and will be handed back on the sale. At a 0% cost rate that subtracts
  // nothing and the whole shelf is the clinic's, which is the case here.
  const stockCost = round2(ownedCost + consignedCost - partnerCostPart);
  const share = round2(partnerShare);
  const retail = round2(retailValue);
  const clinicProfit = round2(retail - stockCost - share);
  // Both footnotes, rounded on their own because neither is a term in the
  // identity: how much of the shelf sits under a partner deal, and how much of
  // the partner's payout is their own money coming back rather than earnings.
  const consignedAtCost = round2(consignedCost);
  const shareCostPart = round2(partnerCostPart);

  return {
    totalItems: items.length,
    stockCost,
    consignedCost: consignedAtCost,
    clinicProfit,
    partnerShare: share,
    partnerShareCostPart: shareCostPart,
    retailValue: retail,
    itemsMissingCost,
    itemsMissingPrice,
    lowStockCount,
    outOfStockCount,
    expiringSoonCount,
    lowStockItems,
    outOfStockItems,
  };
}

// Cash out to suppliers over the range, plus the position as it stands now.
//
// Kept entirely out of the profit calculation on purpose. The clinic recognises
// stock cost as COGS when the item sells, so buying stock moves cash and nothing
// else; folding purchases into profit would charge the same stock twice, once on
// arrival and again on sale. This section sits beside Profitability and answers a
// different question: where the money went, not what was earned.
async function getPurchasesSection(
  range: AnalyticsRange,
): Promise<PurchasesAnalytics> {
  // Every date this section filters on (billedOn, paidOn) is a date-only column,
  // so it needs calendar-date bounds throughout and never the timestamp ones.
  const { granularity, buckets } = prepare(range);
  const { from: dateFrom, toExclusive: dateToExclusive } =
    dateOnlyBounds(range);

  const [billedOrders, payments, allOrders, allPayments, openingBalances] =
    await Promise.all([
      // An order is billed on the date it reached Received, which is what billedOn
      // records. receivedOn marks the first of possibly several deliveries and
      // would land a part-delivered order in the wrong period.
      prisma.purchaseOrder.findMany({
        where: {
          deletedAt: null,
          status: "Received",
          billedOn: { gte: dateFrom, lt: dateToExclusive },
        },
        select: {
          billedOn: true,
          discountAmount: true,
          shippingAmount: true,
          taxAmount: true,
          supplier: { select: { name: true } },
          lines: { select: { quantityOrdered: true, unitCost: true } },
        },
      }),
      // Cash only. A credit note settles a bill without any money leaving the
      // clinic, so counting it here would report a month as having spent what the
      // supplier actually wrote off. The balance figures below deliberately do NOT
      // make this distinction: a credit reduces what is owed exactly as a payment
      // does.
      prisma.supplierPayment.findMany({
        where: {
          deletedAt: null,
          kind: { not: "Credit" },
          paidOn: { gte: dateFrom, lt: dateToExclusive },
        },
        select: { paidOn: true, amount: true },
      }),
      // Everything, for the as-of-now position: balances are a point in time, so
      // they are not confined to the range.
      prisma.purchaseOrder.findMany({
        where: { deletedAt: null, supplierId: { not: null } },
        select: {
          supplierId: true,
          status: true,
          discountAmount: true,
          shippingAmount: true,
          taxAmount: true,
          lines: { select: { quantityOrdered: true, unitCost: true } },
        },
      }),
      // Every kind, unlike the range-scoped query above: this one builds what is
      // owed, and a credit note settles a bill just as a payment does.
      prisma.supplierPayment.groupBy({
        by: ["supplierId"],
        where: { deletedAt: null },
        _sum: { amount: true },
      }),
      // The balance each account was opened with. Without it the position is not
      // merely incomplete, it can have the wrong sign: a supplier paid more than
      // this system has ever billed them reads as being in credit when an opening
      // balance means money is still owed.
      prisma.openingBalance.groupBy({
        by: ["supplierId"],
        where: { supplierId: { not: null } },
        _sum: { amount: true },
      }),
    ]);

  const orderValue = (o: {
    discountAmount: { toNumber(): number } | null;
    shippingAmount: { toNumber(): number } | null;
    taxAmount: { toNumber(): number } | null;
    lines: {
      quantityOrdered: { toNumber(): number };
      unitCost: { toNumber(): number } | null;
    }[];
  }): number => {
    const subtotal = o.lines.reduce(
      (s, l) =>
        l.unitCost
          ? s + l.quantityOrdered.toNumber() * l.unitCost.toNumber()
          : s,
      0,
    );
    return (
      subtotal -
      (o.discountAmount?.toNumber() ?? 0) +
      (o.shippingAmount?.toNumber() ?? 0) +
      (o.taxAmount?.toNumber() ?? 0)
    );
  };

  const billedMap = zeroMap(buckets);
  const paidMap = zeroMap(buckets);
  const bySupplier = new Map<string, number>();
  let periodBilled = 0;

  for (const order of billedOrders) {
    const value = orderValue(order);
    periodBilled += value;
    if (order.billedOn) {
      addTo(billedMap, bucketKeyOf(order.billedOn, granularity), value);
    }
    const name = order.supplier?.name ?? "No supplier";
    bySupplier.set(name, (bySupplier.get(name) ?? 0) + value);
  }

  let periodPaid = 0;
  for (const payment of payments) {
    const amount = payment.amount.toNumber();
    periodPaid += amount;
    addTo(paidMap, bucketKeyOf(payment.paidOn, granularity), amount);
  }

  // Position as of now. Debts and credits are summed separately so a credit on
  // one account cannot cancel a real debt on another.
  const paidBySupplier = new Map(
    allPayments.map((p) => [p.supplierId, p._sum.amount?.toNumber() ?? 0]),
  );
  const billedBySupplier = new Map<number, number>();
  let inProgressNow = 0;
  for (const order of allOrders) {
    if (order.supplierId == null) continue;
    const value = orderValue(order);
    if (order.status === "Received") {
      billedBySupplier.set(
        order.supplierId,
        (billedBySupplier.get(order.supplierId) ?? 0) + value,
      );
    } else if (order.status !== "Cancelled") {
      inProgressNow += value;
    }
  }

  const openingBySupplier = new Map(
    openingBalances.map((o) => [o.supplierId!, o._sum.amount?.toNumber() ?? 0]),
  );

  // The opening position, whole and unaged. An opening balance is what the
  // account was opened with; it does not shrink as payments come in and it does
  // not belong to any date range, so it is reported as it stands and never
  // allocated against later payments.
  let owedOpening = 0;
  for (const amount of openingBySupplier.values()) owedOpening += amount;

  let owedNow = 0;
  let owedThisYear = 0;
  let creditNow = 0;
  for (const supplierId of new Set([
    ...openingBySupplier.keys(),
    ...billedBySupplier.keys(),
    ...paidBySupplier.keys(),
  ])) {
    const paid = paidBySupplier.get(supplierId) ?? 0;
    const billed = billedBySupplier.get(supplierId) ?? 0;
    const balance = (openingBySupplier.get(supplierId) ?? 0) + billed - paid;
    if (balance > 0) owedNow += balance;
    else creditNow += -balance;
    // What this year's trading alone has left outstanding, opening balances set
    // aside. Clamped per supplier for the same reason owedNow is: a credit on
    // one account does not cancel a real debt on another.
    if (billed - paid > 0) owedThisYear += billed - paid;
  }

  return {
    periodBilled: round2(periodBilled),
    periodPaid: round2(periodPaid),
    periodOrderCount: billedOrders.length,
    owedNow: round2(owedNow),
    owedOpening: round2(owedOpening),
    owedThisYear: round2(owedThisYear),
    creditNow: round2(creditNow),
    inProgressNow: round2(inProgressNow),
    trend: buckets.map((b) => ({
      label: b.label,
      billed: round2(billedMap.get(b.key) ?? 0),
      paid: round2(paidMap.get(b.key) ?? 0),
    })),
    bySupplier: [...bySupplier.entries()]
      .map(([label, value]) => ({ label, value: round2(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
  };
}

// ---- public API ----

// One time-boxable section for a given range. Used by the /api/analytics route
// when the user changes a section's date range. Profit is gated by the caller
// (costs:read), so it is only reachable for permitted users.
export function getAnalyticsSection(
  section: AnalyticsSection,
  range: AnalyticsRange,
): Promise<
  | RevenueAnalytics
  | ProfitAnalytics
  | PurchasesAnalytics
  | BookingsAnalytics
  | CategoriesAnalytics
  | ItemsAnalytics
  | ClientsAnalytics
> {
  switch (section) {
    case "revenue":
      return getRevenueSection(range);
    case "profit":
      return getProfitSection(range);
    case "purchases":
      return getPurchasesSection(range);
    case "bookings":
      return getBookingsSection(range);
    case "categories":
      return getCategoriesSection(range);
    case "items":
      return getItemsSection(range);
    case "clients":
      return getClientsSection(range);
  }
}
