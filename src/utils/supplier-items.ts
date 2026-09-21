import {
  SUPPLIER_ITEMS_LIMIT,
  SUPPLIER_ITEM_ORDER_LABELS,
  SUPPLIER_ITEM_VIEW_LABELS,
  type SupplierItemMeasure,
  type SupplierItemOrder,
  type SupplierItemView,
} from "@/constants/analytics";
import { formatRangeLabel } from "@/utils/date-range";
import { formatShare } from "@/utils/format";
import type {
  AnalyticsRange,
  SupplierItemCategory,
  SupplierItemLine,
  SupplierItemLines,
  SupplierOption,
} from "@/types/entities";

// What the dialog and the PDF both say about one supplier's lists, worked out
// once from the per-category rows and totals the server sends. Every ranking,
// share and supplier-wide figure here is a sort, a sum or a division of
// figures already on hand: the reply carries each category's top fifteen by
// units and by revenue together, and the browser picks the measure.

// A part of a whole as a percentage. Null when there is no base: nothing
// sold, or returns outran sales.
export function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

// The figure a line is ranked and shared on.
export function measureOf(
  line: { units: number; revenue: number },
  measure: SupplierItemMeasure,
): number {
  return measure === "units" ? line.units : line.revenue;
}

// The best of a category on the measure, which its bars are drawn against.
export function categoryMax(
  category: SupplierItemCategory,
  measure: SupplierItemMeasure,
): number {
  return measure === "units"
    ? category.total.maxUnits
    : category.total.maxRevenue;
}

// The order the database ranked in: the measure first, the other measure to
// break ties, then the name; biggest first on the top list and smallest first
// on the bottom.
function compare(
  measure: SupplierItemMeasure,
  order: SupplierItemOrder,
): (a: SupplierItemLine, b: SupplierItemLine) => number {
  const sign = order === "top" ? -1 : 1;
  const other: SupplierItemMeasure = measure === "units" ? "revenue" : "units";
  return (a, b) =>
    (measureOf(a, measure) - measureOf(b, measure)) * sign ||
    (measureOf(a, other) - measureOf(b, other)) * sign ||
    a.name.localeCompare(b.name);
}

// One category's fifteen on the measure, cut from the union the reply holds.
export function rankedLines(
  category: SupplierItemCategory,
  measure: SupplierItemMeasure,
  order: SupplierItemOrder,
): SupplierItemLine[] {
  return [...category.lines]
    .sort(compare(measure, order))
    .slice(0, SUPPLIER_ITEMS_LIMIT);
}

// The supplier-wide fifteen on the measure, merged from every category's
// rows: a product in the supplier's top fifteen is in its category's top
// fifteen by necessity, and the same holds at the bottom.
export function flatLines(
  data: SupplierItemLines,
  measure: SupplierItemMeasure,
): SupplierItemLine[] {
  return data.categories
    .flatMap((c) => c.lines)
    .sort(compare(measure, data.order))
    .slice(0, SUPPLIER_ITEMS_LIMIT);
}

// The categories in the list's direction on the measure: the one that sold
// or billed most first on the top list, the least first on the bottom.
export function sortedCategories(
  data: SupplierItemLines,
  measure: SupplierItemMeasure,
): SupplierItemCategory[] {
  const sign = data.order === "top" ? -1 : 1;
  return [...data.categories].sort(
    (a, b) =>
      (measureOf(a.total, measure) - measureOf(b.total, measure)) * sign ||
      a.category.localeCompare(b.category),
  );
}

// The supplier across every category: what the bottom line of the grouped
// table and the pills' shares are measured against.
export function supplierTotals(data: SupplierItemLines): {
  units: number;
  revenue: number;
  items: number;
  unsoldItems: number;
  // The biggest category on either measure, which category bars are drawn
  // against, and the best seller and earner across the supplier, for the
  // flat list's bars.
  maxUnits: number;
  maxRevenue: number;
  maxLineUnits: number;
  maxLineRevenue: number;
} {
  const t = {
    units: 0,
    revenue: 0,
    items: 0,
    unsoldItems: 0,
    maxUnits: 0,
    maxRevenue: 0,
    maxLineUnits: 0,
    maxLineRevenue: 0,
  };
  for (const c of data.categories) {
    t.units += c.total.units;
    t.revenue += c.total.revenue;
    t.items += c.total.items;
    t.unsoldItems += c.unsoldItems;
    t.maxUnits = Math.max(t.maxUnits, c.total.units);
    t.maxRevenue = Math.max(t.maxRevenue, c.total.revenue);
    t.maxLineUnits = Math.max(t.maxLineUnits, c.total.maxUnits);
    t.maxLineRevenue = Math.max(t.maxLineRevenue, c.total.maxRevenue);
  }
  t.units = Math.round(t.units * 1000) / 1000;
  t.revenue = Math.round(t.revenue * 100) / 100;
  return t;
}

// The unit of the measure, as the notes say it.
function measureNoun(measure: SupplierItemMeasure): string {
  return measure === "units" ? "units" : "revenue";
}

// The line under the title: which list, laid out how, ranked on what, over
// which dates.
export function supplierItemsCaption(
  order: SupplierItemOrder,
  view: SupplierItemView,
  measure: SupplierItemMeasure,
  range: AnalyticsRange,
): string {
  const end = order === "top" ? "Top" : "Bottom";
  const of =
    view === "category" ? "in each category" : "of this supplier's products";
  const by = measure === "units" ? "units sold" : "revenue billed";
  return `${end} ${SUPPLIER_ITEMS_LIMIT} ${of} by ${by}, ${formatRangeLabel(range)}.`;
}

// Under a category's name, or the supplier's: how many products sold and how
// many did not, which together are the whole of what is filed there.
export function soldSummary(sold: number, unsold: number): string {
  const text = `${sold} ${sold === 1 ? "product" : "products"} sold`;
  return unsold === 0 ? text : `${text}, ${unsold} did not sell`;
}

// The note under one category's list: how much of the category the shown
// lines cover on the measure, only when the list was cut (otherwise it is all
// of them and the figure says nothing). Null when there is nothing to say.
export function categoryNote(
  category: SupplierItemCategory,
  lines: SupplierItemLine[],
  measure: SupplierItemMeasure,
): string | null {
  if (lines.length >= category.total.items) return null;
  const listed = lines.reduce((sum, l) => sum + measureOf(l, measure), 0);
  const share = shareOf(listed, measureOf(category.total, measure));
  if (share === null) return null;
  const verb = measure === "units" ? "sold" : "billed";
  return `These ${lines.length} lines are ${formatShare(share)} of the ${measureNoun(measure)} ${category.category} ${verb}.`;
}

// The note under the whole table: how many of the supplier's products sold
// nothing at all. Null when every product moved.
export function supplierNote(data: SupplierItemLines): string | null {
  const { unsoldItems } = supplierTotals(data);
  if (unsoldItems === 0) return null;
  return `${unsoldItems} of this supplier's products did not sell at all over the period.`;
}

// The note under the flat list: how much of the supplier the list covers on
// the measure, only when it was cut, and then the supplier note. Null when
// neither applies.
export function flatNote(
  data: SupplierItemLines,
  lines: SupplierItemLine[],
  measure: SupplierItemMeasure,
): string | null {
  const totals = supplierTotals(data);
  const parts: string[] = [];
  if (lines.length < totals.items) {
    const listed = lines.reduce((sum, l) => sum + measureOf(l, measure), 0);
    const share = shareOf(listed, measureOf(totals, measure));
    if (share !== null) {
      const verb = measure === "units" ? "sold" : "billed";
      parts.push(
        `These ${lines.length} lines are ${formatShare(share)} of the ${measureNoun(measure)} ${verb}.`,
      );
    }
  }
  const unsold = supplierNote(data);
  if (unsold) parts.push(unsold);
  return parts.length > 0 ? parts.join(" ") : null;
}

// "royal-canin-top-earners-by-item-2026-08-01-to-2026-09-21.pdf": the
// supplier, the list (which names the measure), the layout and the dates, so
// files saved side by side can be told apart.
export function supplierItemsFileName(
  supplier: SupplierOption,
  order: SupplierItemOrder,
  view: SupplierItemView,
  measure: SupplierItemMeasure,
  range: AnalyticsRange,
): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const name = slug(supplier.name) || String(supplier.supplierId);
  const list = slug(SUPPLIER_ITEM_ORDER_LABELS[measure][order]);
  const layout = slug(SUPPLIER_ITEM_VIEW_LABELS[view]);
  return `${name}-${list}-${layout}-${range.from}-to-${range.to}.pdf`;
}
