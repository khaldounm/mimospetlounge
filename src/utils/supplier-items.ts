import {
  SUPPLIER_ITEMS_LIMIT,
  SUPPLIER_ITEM_ORDER_LABELS,
  SUPPLIER_ITEM_VIEW_LABELS,
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
// once from the per-category rows and totals the server sends. Shares and
// supplier-wide figures are never sent: they are sums and divisions of
// figures already on hand.

// A part of a whole as a percentage. Null when there is no base: nothing
// sold, or returns outran sales.
export function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

// The supplier across every category: what the bottom line of the grouped
// table and the category chips' shares are measured against.
export function supplierTotals(data: SupplierItemLines): {
  units: number;
  revenue: number;
  items: number;
  unsoldItems: number;
  maxUnits: number; // the biggest category's units, which category bars are drawn against
} {
  let units = 0;
  let revenue = 0;
  let items = 0;
  let unsoldItems = 0;
  let maxUnits = 0;
  for (const c of data.categories) {
    units += c.total.units;
    revenue += c.total.revenue;
    items += c.total.items;
    unsoldItems += c.unsoldItems;
    maxUnits = Math.max(maxUnits, c.total.units);
  }
  return {
    units: Math.round(units * 1000) / 1000,
    revenue: Math.round(revenue * 100) / 100,
    items,
    unsoldItems,
    maxUnits,
  };
}

// The supplier's best seller across every category, which the flat list's
// bars are drawn against. Not the first flat row: on the slow sellers the
// best seller is not in the list at all.
export function supplierMaxUnits(data: SupplierItemLines): number {
  return data.categories.reduce((max, c) => Math.max(max, c.total.maxUnits), 0);
}

// The supplier-wide fifteen, merged from the per-category rows in the same
// order the database ranked them: units, then revenue, then name, biggest
// first on the best sellers and smallest first on the slow sellers.
export function flatLines(data: SupplierItemLines): SupplierItemLine[] {
  const sign = data.order === "top" ? -1 : 1;
  return data.categories
    .flatMap((c) => c.lines)
    .sort(
      (a, b) =>
        (a.units - b.units) * sign ||
        (a.revenue - b.revenue) * sign ||
        a.name.localeCompare(b.name),
    )
    .slice(0, SUPPLIER_ITEMS_LIMIT);
}

// The line under the title: which list, laid out how, over which dates.
export function supplierItemsCaption(
  order: SupplierItemOrder,
  view: SupplierItemView,
  range: AnalyticsRange,
): string {
  const end = order === "top" ? "Top" : "Bottom";
  const of =
    view === "category" ? "in each category" : "of this supplier's products";
  return `${end} ${SUPPLIER_ITEMS_LIMIT} ${of} by units sold, ${formatRangeLabel(range)}.`;
}

// Under a category's name, or the supplier's: how many products sold and how
// many did not, which together are the whole of what is filed there.
export function soldSummary(sold: number, unsold: number): string {
  const text = `${sold} ${sold === 1 ? "product" : "products"} sold`;
  return unsold === 0 ? text : `${text}, ${unsold} did not sell`;
}

// The note under one category's list: how much of the category's units it
// covers, only when the list was cut (otherwise it is all of them and the
// figure says nothing). Null when there is nothing to say.
export function categoryNote(category: SupplierItemCategory): string | null {
  if (category.lines.length >= category.total.items) return null;
  const listed = category.lines.reduce((sum, l) => sum + l.units, 0);
  const share = shareOf(listed, category.total.units);
  if (share === null) return null;
  return `These ${category.lines.length} lines are ${formatShare(share)} of the units ${category.category} sold.`;
}

// The note under the whole table: how many of the supplier's products sold
// nothing at all. Null when every product moved.
export function supplierNote(data: SupplierItemLines): string | null {
  const { unsoldItems } = supplierTotals(data);
  if (unsoldItems === 0) return null;
  return `${unsoldItems} of this supplier's products did not sell at all over the period.`;
}

// The note under the flat list: how much of the supplier's units it covers,
// only when it was cut, and then the supplier note. Null when neither applies.
export function flatNote(
  data: SupplierItemLines,
  lines: SupplierItemLine[],
): string | null {
  const totals = supplierTotals(data);
  const parts: string[] = [];
  if (lines.length < totals.items) {
    const listed = lines.reduce((sum, l) => sum + l.units, 0);
    const share = shareOf(listed, totals.units);
    if (share !== null) {
      parts.push(
        `These ${lines.length} lines are ${formatShare(share)} of the units sold.`,
      );
    }
  }
  const unsold = supplierNote(data);
  if (unsold) parts.push(unsold);
  return parts.length > 0 ? parts.join(" ") : null;
}

// "royal-canin-best-sellers-by-item-2026-08-01-to-2026-09-21.pdf": the
// supplier, the list, the layout and the dates, so files saved side by side
// can be told apart.
export function supplierItemsFileName(
  supplier: SupplierOption,
  order: SupplierItemOrder,
  view: SupplierItemView,
  range: AnalyticsRange,
): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const name = slug(supplier.name) || String(supplier.supplierId);
  const list = slug(SUPPLIER_ITEM_ORDER_LABELS[order]);
  const layout = slug(SUPPLIER_ITEM_VIEW_LABELS[view]);
  return `${name}-${list}-${layout}-${range.from}-to-${range.to}.pdf`;
}
