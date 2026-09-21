import {
  SUPPLIER_ITEMS_LIMIT,
  SUPPLIER_ITEM_ORDER_LABELS,
  type SupplierItemOrder,
} from "@/constants/analytics";
import { formatRangeLabel } from "@/utils/date-range";
import { formatShare } from "@/utils/format";
import type {
  AnalyticsRange,
  SupplierItemLines,
  SupplierOption,
} from "@/types/entities";

// What the dialog and the PDF both say about one supplier's list, worked out
// once from the fifteen rows and four totals the server sends. Shares are
// never sent: they are a division of figures already on hand.

// A line's share of every unit the supplier's products sold over the range.
// Null when there is no base: nothing sold, or returns outran sales.
export function unitShare(
  data: SupplierItemLines,
  units: number,
): number | null {
  return data.total.units > 0 ? (units / data.total.units) * 100 : null;
}

// The line under the title: which list, and over which dates.
export function supplierItemsCaption(
  order: SupplierItemOrder,
  range: AnalyticsRange,
): string {
  const end = order === "top" ? "Top" : "Bottom";
  return `${end} ${SUPPLIER_ITEMS_LIMIT} of this supplier's products by units sold, ${formatRangeLabel(range)}.`;
}

// The note under the table: how much of the supplier's units the list covers
// (only when the list was cut at the cap, otherwise it is all of them and the
// figure says nothing), and how many products sold nothing at all. Null when
// there is nothing to say.
export function supplierItemsNote(data: SupplierItemLines): string | null {
  const parts: string[] = [];
  if (data.lines.length >= SUPPLIER_ITEMS_LIMIT) {
    const listed = data.lines.reduce((sum, l) => sum + l.units, 0);
    const share = unitShare(data, listed);
    if (share !== null) {
      parts.push(
        `These ${data.lines.length} lines are ${formatShare(share)} of the units sold.`,
      );
    }
  }
  if (data.unsoldItems > 0) {
    parts.push(
      `${data.unsoldItems} more of this supplier's products did not sell at all over the period.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

// "royal-canin-best-sellers-2026-08-01-to-2026-09-21.pdf": the supplier, the
// list and the dates, so two files saved side by side can be told apart.
export function supplierItemsFileName(
  supplier: SupplierOption,
  order: SupplierItemOrder,
  range: AnalyticsRange,
): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const name = slug(supplier.name) || String(supplier.supplierId);
  const list = slug(SUPPLIER_ITEM_ORDER_LABELS[order]);
  return `${name}-${list}-${range.from}-to-${range.to}.pdf`;
}
