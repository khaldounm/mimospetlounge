"use client";

import { useState } from "react";
import { FormControlLabel, Switch, Typography } from "@mui/material";
import { useAnalyticsSection } from "@/hooks/useAnalyticsSection";
import { DEFAULT_CHART_VIEW, type ChartView } from "@/constants/analytics";
import { rangeSummary } from "@/utils/date-range";
import { withPurchaseVat } from "@/utils/profit";
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
  const {
    range,
    data: fetched,
    loading,
    error,
    setRange,
    load,
  } = useAnalyticsSection<ProfitAnalytics>("profit", initialRange);
  // Whether the VAT on supplier bills counts as a cost. Off reads profit as
  // it always has. The server sends the VAT either way, so the switch is a
  // subtraction in the browser, never a refetch.
  const [includeVat, setIncludeVat] = useState(false);
  const data = fetched && includeVat ? withPurchaseVat(fetched) : fetched;
  const trendHasData = data?.trend.some(
    (t) =>
      t.revenue > 0 ||
      t.cogs > 0 ||
      t.partnerCost > 0 ||
      t.costs > 0 ||
      (includeVat && t.vat > 0),
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
          <FormControlLabel
            control={
              <Switch
                checked={includeVat}
                onChange={(e) => setIncludeVat(e.target.checked)}
              />
            }
            label="Include VAT on purchases"
          />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Net profit = revenue collected, minus the cost of clinic-owned items
            sold (COGS), minus payouts owed to partners on their consigned
            items, minus operating (running) costs
            {includeVat && ", minus the VAT on supplier bills"}. Buying stock is
            not a loss until the item sells; consigned stock is funded by
            partners, so it is not clinic cash.
            {includeVat &&
              " VAT is counted on the date of each bill, not when the stock sells."}
          </Typography>
          <KpiGrid columns={includeVat ? 6 : 5}>
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
            {includeVat && (
              <KpiCard label="VAT on purchases" value={money(data.periodVat)} />
            )}
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
                Shown for visibility and <strong>not</strong>
                {/* A string, because the dev build drops a plain space after a
                    closing tag here and printed "notsubtracted". */}
                {" subtracted from net profit above. "}
                Consumables are already expensed as running costs when they are
                bought, so charging them again on the day they are used would
                count the same stock twice. Valued at each item&apos;s latest
                purchase cost.
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
                <ProfitBreakdownChart
                  trend={data.trend}
                  view={chartView}
                  showVat={includeVat}
                />
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
