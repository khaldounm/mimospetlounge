"use client";

import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import { LineChart } from "@mui/x-charts/LineChart";
import { useAnalyticsSection } from "@/hooks/useAnalyticsSection";
import { rangeSummary } from "@/utils/date-range";
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
import type {
  AnalyticsRange,
  RevenueAnalytics,
  ServiceVolumeRow,
} from "@/types/entities";

// Every service billed inside the range and how often it was done. A table
// rather than a chart because the question is "what did we do, and how many
// times", which is a list the counter reads down, not a shape: no top-N, and
// the whole list scrolls inside the card so it keeps its neighbours' height.
function ServicesPerformed({ rows }: { rows: ServiceVolumeRow[] }) {
  const totalTimes = rows.reduce((sum, r) => sum + r.times, 0);
  return (
    <ChartCard
      title="Services performed"
      action={
        rows.length > 0 ? (
          <Typography variant="caption" color="text.secondary">
            {rows.length} service{rows.length === 1 ? "" : "s"},{" "}
            {round1(totalTimes)} performed
          </Typography>
        ) : null
      }
    >
      {rows.length > 0 ? (
        <Box sx={{ maxHeight: CHART_HEIGHT, overflowY: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              {/* stickyHeader paints head cells in background.default, which is
                  the page cream rather than the card, so the row is repainted
                  to match the Paper it sits in. */}
              <TableRow sx={{ "& th": { bgcolor: "background.paper" } }}>
                <TableCell>Service</TableCell>
                <TableCell align="right">Times</TableCell>
                <TableCell align="right">Revenue</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell align="right">{round1(row.times)}</TableCell>
                  <TableCell align="right">{money(row.revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ) : (
        <EmptyChart />
      )}
    </ChartCard>
  );
}

// Quantity is a decimal column, so a whole count has to read as "3", not
// "3.0", while a half-unit line still shows what it was.
function round1(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default function RevenueSection({
  initialRange,
}: {
  initialRange: AnalyticsRange;
}) {
  const { range, data, loading, error, setRange, load } =
    useAnalyticsSection<RevenueAnalytics>("revenue", initialRange);
  const trendHasData = data?.trend.some(
    (t) => t.collected > 0 || t.outstanding > 0,
  );

  return (
    <CollapsibleSection
      title="Revenue & financial"
      subtitle={rangeSummary(range)}
      loading={loading}
      onExpand={load}
      controls={<DateRangeControl range={range} onChange={setRange} />}
    >
      {data ? (
        <>
          <KpiGrid>
            <KpiCard label="Collected" value={money(data.periodCollected)} />
            <KpiCard label="Invoiced" value={money(data.periodInvoiced)} />
            <KpiCard
              label="Outstanding (now)"
              value={money(data.outstandingTotal)}
            />
            <KpiCard label="Avg invoice" value={money(data.avgInvoiceValue)} />
            <KpiCard label="Void rate" value={`${data.voidRate}%`} />
          </KpiGrid>
          <ChartGrid columns={3}>
            <ChartCard title="Revenue trend" full>
              {trendHasData ? (
                <LineChart
                  height={CHART_HEIGHT}
                  xAxis={[
                    {
                      data: data.trend.map((t) => t.label),
                      scaleType: "point",
                    },
                  ]}
                  series={[
                    {
                      data: data.trend.map((t) => t.collected),
                      label: "Collected",
                      valueFormatter: (v) => money(v),
                    },
                    {
                      data: data.trend.map((t) => t.outstanding),
                      label: "Outstanding",
                      valueFormatter: (v) => money(v),
                    },
                  ]}
                />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>
            <ChartCard title="Outstanding by age (as of today)">
              <BarChart
                height={CHART_HEIGHT}
                xAxis={[
                  {
                    data: ["Current", "1-30d", "31-60d", "61+ d"],
                    scaleType: "band",
                  },
                ]}
                series={[
                  {
                    data: [
                      data.aging.current,
                      data.aging.d1to30,
                      data.aging.d31to60,
                      data.aging.d61plus,
                    ],
                    label: "Balance",
                    valueFormatter: (v) => money(v),
                  },
                ]}
              />
            </ChartCard>
            <ChartCard title="Top services by revenue">
              {data.byService.length > 0 ? (
                <HorizontalBars items={data.byService} formatter={money} />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>
            <ServicesPerformed rows={data.serviceVolume} />
          </ChartGrid>
        </>
      ) : (
        <SectionPlaceholder error={error} />
      )}
    </CollapsibleSection>
  );
}
