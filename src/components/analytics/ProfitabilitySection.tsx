"use client";

import { useState } from "react";
import { Typography } from "@mui/material";
import { useAnalyticsSection } from "@/hooks/useAnalyticsSection";
import { DEFAULT_CHART_VIEW, type ChartView } from "@/constants/analytics";
import { rangeSummary } from "@/utils/date-range";
import DateRangeControl from "@/components/ui/DateRangeControl";
import CollapsibleSection from "@/components/ui/CollapsibleSection";
import ChartViewToggle from "./ChartViewToggle";
import ProfitBreakdownChart from "./ProfitBreakdownChart";
import {
  ChartCard,
  ChartGrid,
  EmptyChart,
  HorizontalBars,
  KpiCard,
  KpiGrid,
  SectionPlaceholder,
  money,
} from "./AnalyticsPrimitives";
import type { AnalyticsRange, ProfitAnalytics } from "@/types/entities";

export default function ProfitabilitySection({
  initialRange,
}: {
  initialRange: AnalyticsRange;
}) {
  const { range, data, loading, error, setRange, load } =
    useAnalyticsSection<ProfitAnalytics>("profit", initialRange);
  const trendHasData = data?.trend.some(
    (t) => t.revenue > 0 || t.cogs > 0 || t.partnerCost > 0 || t.costs > 0,
  );
  // Which picture the breakdown draws. A local choice: both views are drawn
  // from the same data already on hand, so switching never refetches.
  const [chartView, setChartView] = useState<ChartView>(DEFAULT_CHART_VIEW);

  return (
    <CollapsibleSection
      title="Profitability"
      subtitle={rangeSummary(range)}
      loading={loading}
      onExpand={load}
      controls={<DateRangeControl range={range} onChange={setRange} />}
    >
      {data ? (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Net profit = revenue collected, minus the cost of clinic-owned items
            sold (COGS), minus payouts owed to partners on their consigned
            items, minus operating (running) costs. Buying stock is not a loss
            until the item sells; consigned stock is funded by partners, so it
            is not clinic cash.
          </Typography>
          <KpiGrid>
            <KpiCard label="Revenue" value={money(data.periodRevenue)} />
            <KpiCard
              label="Cost of goods sold"
              value={money(data.periodCogs)}
            />
            <KpiCard
              label="Partner earnings"
              value={money(data.periodPartnerCost)}
            />
            <KpiCard label="Operating costs" value={money(data.periodCosts)} />
            <KpiCard label="Net profit" value={money(data.periodProfit)} />
          </KpiGrid>

          {(data.periodClinicUse > 0 || data.periodWriteOffs > 0) && (
            <>
              <Typography variant="overline" color="text.secondary">
                Stock that left without a sale
              </Typography>
              <KpiGrid>
                <KpiCard
                  label="Used in clinic"
                  value={money(data.periodClinicUse)}
                />
                <KpiCard
                  label="Written off"
                  value={money(data.periodWriteOffs)}
                />
              </KpiGrid>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 2, display: "block" }}
              >
                Shown for visibility and <strong>not</strong> subtracted from
                net profit above. Consumables are already expensed as running
                costs when they are bought, so charging them again on the day
                they are used would count the same stock twice. Valued at each
                item&apos;s latest purchase cost.
              </Typography>
            </>
          )}
          <ChartGrid>
            <ChartCard
              title="Profit breakdown"
              full
              action={
                <ChartViewToggle value={chartView} onChange={setChartView} />
              }
            >
              {trendHasData ? (
                <ProfitBreakdownChart trend={data.trend} view={chartView} />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>
            <ChartCard title="Cost breakdown">
              {data.byCategory.length > 0 ? (
                <HorizontalBars items={data.byCategory} formatter={money} />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>
          </ChartGrid>
        </>
      ) : (
        <SectionPlaceholder error={error} />
      )}
    </CollapsibleSection>
  );
}
