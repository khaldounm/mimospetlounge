"use client";

import Link from "@/components/ui/AppLink";
import { Button, Stack, Typography } from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import DescriptionIcon from "@mui/icons-material/Description";
import { useAnalyticsSection } from "@/hooks/useAnalyticsSection";
import { rangeQuery, rangeSummary } from "@/utils/date-range";
import DateRangeControl from "@/components/ui/DateRangeControl";
import CollapsibleSection from "@/components/ui/CollapsibleSection";
import {
  CHART_HEIGHT,
  ChartCard,
  ChartGrid,
  EmptyChart,
  HorizontalBars,
  KpiCard,
  KpiGrid,
  SectionPlaceholder,
  money,
} from "./AnalyticsPrimitives";
import type { AnalyticsRange, PurchasesAnalytics } from "@/types/entities";

export default function PurchasesSection({
  initialRange,
}: {
  initialRange: AnalyticsRange;
}) {
  const { range, data, loading, error, setRange, load } =
    useAnalyticsSection<PurchasesAnalytics>("purchases", initialRange);
  const trendHasData = data?.trend.some((t) => t.billed > 0 || t.paid > 0);

  return (
    <CollapsibleSection
      title="Purchases"
      subtitle={rangeSummary(range)}
      loading={loading}
      onExpand={load}
      controls={<DateRangeControl range={range} onChange={setRange} />}
    >
      {data ? (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            What the clinic was billed by suppliers and what it actually paid
            them. These figures are <strong>not</strong> part of net profit and
            never reduce it: stock cost reaches the profit report as COGS on the
            day the item sells, so counting a purchase here as well would charge
            the same stock twice. Read this alongside Profitability, not inside
            it.
          </Typography>

          <KpiGrid>
            <KpiCard label="Billed" value={money(data.periodBilled)} />
            <KpiCard label="Paid" value={money(data.periodPaid)} />
            <KpiCard
              label="Orders delivered"
              value={String(data.periodOrderCount)}
            />
            {/* The headline is the whole debt, opening balances included. The two
              figures under it are the parts it was built from, each shown whole:
              they are not shares of the total and will not add up to it, because
              the total nets them together per supplier first. */}
            <KpiCard
              label="Owed now"
              value={money(data.owedNow)}
              hint={
                <>
                  Opening balance <strong>{money(data.owedOpening)}</strong>.
                  <br />
                  This year balance: <strong>{money(data.owedThisYear)}</strong>
                </>
              }
            />
            <KpiCard
              label="In progress now"
              value={money(data.inProgressNow)}
            />
          </KpiGrid>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mb: 2, display: "block" }}
          >
            Billed, Paid and Orders delivered cover{" "}
            {rangeSummary(range).toLowerCase()}. Owed now and In progress now
            are the position as it stands today, not for the period. Owed now
            counts the balances the supplier accounts were opened with, so it
            does not tie to Billed less Paid. Its opening and this-year figures
            are each shown in full and will not add up to it: a supplier who has
            overpaid this year absorbs their own opening balance rather than
            adding to what is owed.
            {data.creditNow > 0 &&
              ` A further ${money(data.creditNow)} is held in credit, paid with no bill recorded against it.`}
          </Typography>

          <ChartGrid>
            <ChartCard title="Billed against paid" full>
              {trendHasData ? (
                <BarChart
                  height={CHART_HEIGHT}
                  xAxis={[
                    { data: data.trend.map((t) => t.label), scaleType: "band" },
                  ]}
                  series={[
                    {
                      data: data.trend.map((t) => t.billed),
                      label: "Billed",
                      valueFormatter: (v) => money(v ?? 0),
                    },
                    {
                      data: data.trend.map((t) => t.paid),
                      label: "Paid",
                      valueFormatter: (v) => money(v ?? 0),
                    },
                  ]}
                />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>
            <ChartCard title="Top suppliers by spend">
              {data.bySupplier.length > 0 ? (
                <HorizontalBars items={data.bySupplier} formatter={money} />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>
          </ChartGrid>

          <Stack direction="row" sx={{ mt: 2 }}>
            <Button
              component={Link}
              href={`/orders/statement?${rangeQuery(range)}`}
              variant="outlined"
              size="small"
              startIcon={<DescriptionIcon />}
            >
              Open the statement for this period
            </Button>
          </Stack>
        </>
      ) : (
        <SectionPlaceholder error={error} />
      )}
    </CollapsibleSection>
  );
}
