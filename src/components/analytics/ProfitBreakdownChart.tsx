"use client";

import { useTheme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";
import { BarPlot } from "@mui/x-charts/BarChart";
import { LinePlot, MarkPlot } from "@mui/x-charts/LineChart";
import { ChartsDataProvider } from "@mui/x-charts/ChartsDataProvider";
import { ChartsWrapper } from "@mui/x-charts/ChartsWrapper";
import { ChartsSurface } from "@mui/x-charts/ChartsSurface";
import { ChartsLegend } from "@mui/x-charts/ChartsLegend";
import { ChartsTooltip } from "@mui/x-charts/ChartsTooltip";
import { ChartsXAxis } from "@mui/x-charts/ChartsXAxis";
import { ChartsYAxis } from "@mui/x-charts/ChartsYAxis";
import { ChartsGrid } from "@mui/x-charts/ChartsGrid";
import { ChartsReferenceLine } from "@mui/x-charts/ChartsReferenceLine";
import { ChartsAxisHighlight } from "@mui/x-charts/ChartsAxisHighlight";
import { rainbowSurgePalette } from "@mui/x-charts/colorPalettes";
import type { ChartView } from "@/constants/analytics";
import { formatMoneyCompact } from "@/utils/format";
import { CHART_HEIGHT, money } from "./AnalyticsPrimitives";
import StackedAreaChart from "./StackedAreaChart";
import type { ProfitAnalytics } from "@/types/entities";

type Trend = ProfitAnalytics["trend"];

// One colour per entity, the same in every view, so switching the picture
// never repaints what a colour meant. Taken from the library's own default
// palette in the order the lines view assigns them, so the lines view looks
// exactly as it always has.
function seriesColors(mode: "light" | "dark") {
  const [revenue, cogs, partner, costs, profit] = rainbowSurgePalette(mode);
  return { revenue, cogs, partner, costs, profit };
}

// Money in as one bar, money out stacked downward under it in its three
// parts, and net profit as a line across the top: a day reads as "in, out,
// what was left" with no arithmetic, and a losing day is a line below the
// zero rule rather than one curve dipping under another. Bars rather than
// lines because the buckets are days: a day with no sales is an honest gap,
// not a curve sliding through zero.
//
// Costs are plotted as negatives so they hang below the axis, and formatted
// back to positive in the tooltip, which is how a cost is read.
function ProfitBreakdownBars({ trend }: { trend: Trend }) {
  const theme = useTheme();
  const colors = seriesColors(theme.palette.mode);
  const cost = (v: number | null) => money(v == null ? 0 : -v);
  return (
    <ChartsDataProvider
      height={CHART_HEIGHT}
      series={[
        {
          type: "bar",
          id: "revenue",
          label: "Revenue",
          data: trend.map((t) => t.revenue),
          stack: "in",
          color: colors.revenue,
          valueFormatter: (v) => money(v),
        },
        {
          type: "bar",
          id: "cogs",
          label: "COGS",
          data: trend.map((t) => -t.cogs),
          stack: "out",
          stackOffset: "diverging",
          color: colors.cogs,
          valueFormatter: cost,
        },
        {
          type: "bar",
          id: "partner",
          label: "Partner earnings",
          data: trend.map((t) => -t.partnerCost),
          stack: "out",
          stackOffset: "diverging",
          color: colors.partner,
          valueFormatter: cost,
        },
        {
          type: "bar",
          id: "costs",
          label: "Operating costs",
          data: trend.map((t) => -t.costs),
          stack: "out",
          stackOffset: "diverging",
          color: colors.costs,
          valueFormatter: cost,
        },
        {
          type: "line",
          id: "profit",
          label: "Net profit",
          data: trend.map((t) => t.profit),
          // Straight between the points: a smoothed curve draws money on
          // days none was made.
          curve: "linear",
          showMark: true,
          color: theme.palette.text.primary,
          valueFormatter: (v) => money(v),
        },
      ]}
      xAxis={[
        {
          id: "days",
          data: trend.map((t) => t.label),
          scaleType: "band",
          // The costs and the revenue share a slot: one column of bars per
          // day, rather than four side by side.
          categoryGapRatio: 0.35,
        },
      ]}
      yAxis={[
        {
          id: "money",
          valueFormatter: (v: number) => formatMoneyCompact(v),
        },
      ]}
    >
      <ChartsWrapper>
        <ChartsLegend />
        <ChartsSurface>
          <ChartsGrid horizontal />
          <BarPlot />
          <ChartsReferenceLine
            y={0}
            lineStyle={{ stroke: theme.palette.text.secondary }}
          />
          <LinePlot />
          <MarkPlot />
          <ChartsAxisHighlight x="band" />
          <ChartsXAxis axisId="days" />
          <ChartsYAxis axisId="money" />
        </ChartsSurface>
        <ChartsTooltip />
      </ChartsWrapper>
    </ChartsDataProvider>
  );
}

// Where each day's revenue went, as stacked areas: COGS, partner earnings,
// operating costs and net profit piled on top of each other, so the top edge
// of the stack IS the revenue and each band is the slice of it that went that
// way. Everything is in the tooltip, so no extra revenue line is drawn over a
// shape that already says it.
function ProfitBreakdownStacked({ trend }: { trend: Trend }) {
  return (
    <StackedAreaChart
      labels={trend.map((t) => t.label)}
      series={[
        { id: "cogs", label: "COGS", data: trend.map((t) => t.cogs) },
        {
          id: "partner",
          label: "Partner earnings",
          data: trend.map((t) => t.partnerCost),
        },
        {
          id: "costs",
          label: "Operating costs",
          data: trend.map((t) => t.costs),
        },
        { id: "profit", label: "Net profit", data: trend.map((t) => t.profit) },
      ]}
      valueFormatter={(v) => money(v)}
      axisFormatter={(v) => formatMoneyCompact(v)}
    />
  );
}

// The five-line chart the section opened with, as it is on prod.
function ProfitBreakdownLines({ trend }: { trend: Trend }) {
  return (
    <LineChart
      height={CHART_HEIGHT}
      xAxis={[{ data: trend.map((t) => t.label), scaleType: "point" }]}
      series={[
        {
          data: trend.map((t) => t.revenue),
          label: "Revenue",
          valueFormatter: (v) => money(v),
        },
        {
          data: trend.map((t) => t.cogs),
          label: "COGS",
          valueFormatter: (v) => money(v),
        },
        {
          data: trend.map((t) => t.partnerCost),
          label: "Partner earnings",
          valueFormatter: (v) => money(v),
        },
        {
          data: trend.map((t) => t.costs),
          label: "Operating costs",
          valueFormatter: (v) => money(v),
        },
        {
          data: trend.map((t) => t.profit),
          label: "Net profit",
          valueFormatter: (v) => money(v),
        },
      ]}
    />
  );
}

export default function ProfitBreakdownChart({
  trend,
  view,
}: {
  trend: Trend;
  view: ChartView;
}) {
  if (view === "bars") return <ProfitBreakdownBars trend={trend} />;
  if (view === "stacked") return <ProfitBreakdownStacked trend={trend} />;
  return <ProfitBreakdownLines trend={trend} />;
}
