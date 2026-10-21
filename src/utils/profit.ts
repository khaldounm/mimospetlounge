import { COST_BREAKDOWN_LIMIT } from "@/constants/analytics";
import type { ProfitAnalytics } from "@/types/entities";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The profit section with the VAT on supplier bills charged as a cost.
 *
 * The server sends profit without it and the VAT beside it, so turning VAT on
 * or off is a subtraction here rather than another fetch of the same figures.
 * Every figure that shows a total moves with it: the period's profit, each
 * bucket's profit, and the cost breakdown, which gains VAT as a slice of its
 * own under the same cap the server applies.
 */
export function withPurchaseVat(data: ProfitAnalytics): ProfitAnalytics {
  const byCategory =
    data.periodVat > 0
      ? [
          ...data.byCategory,
          { label: "VAT on purchases", value: data.periodVat },
        ]
          .sort((a, b) => b.value - a.value)
          .slice(0, COST_BREAKDOWN_LIMIT)
      : data.byCategory;

  return {
    ...data,
    periodProfit: round2(data.periodProfit - data.periodVat),
    trend: data.trend.map((t) => ({ ...t, profit: round2(t.profit - t.vat) })),
    byCategory,
  };
}
