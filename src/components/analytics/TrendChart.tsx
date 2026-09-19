"use client";

import { BarChart } from "@mui/x-charts/BarChart";
import { LineChart } from "@mui/x-charts/LineChart";
import type { ChartView } from "@/constants/analytics";
import { CHART_HEIGHT } from "./AnalyticsPrimitives";
import StackedAreaChart from "./StackedAreaChart";

export interface TrendSeries {
  id: string;
  label: string;
  data: number[];
}

// One trend over the range, drawn three ways from the same series: bars per
// bucket (side by side when there are several series), the series stacked
// into one area so the top edge is their total, or the lines it opened with.
// Colours come from the library's default order, the same in every view, so
// switching the picture never repaints what a colour meant.
export default function TrendChart({
  labels,
  series,
  view,
  valueFormatter,
  axisFormatter,
}: {
  labels: string[];
  series: TrendSeries[];
  view: ChartView;
  valueFormatter?: (v: number | null) => string;
  // For the value axis, where a compact figure fits the rail better.
  axisFormatter?: (v: number) => string;
}) {
  const yAxis = axisFormatter ? [{ valueFormatter: axisFormatter }] : undefined;

  if (view === "bars") {
    return (
      <BarChart
        height={CHART_HEIGHT}
        xAxis={[{ data: labels, scaleType: "band" }]}
        yAxis={yAxis}
        series={series.map((s) => ({
          id: s.id,
          label: s.label,
          data: s.data,
          valueFormatter,
        }))}
      />
    );
  }

  if (view === "stacked") {
    return (
      <StackedAreaChart
        labels={labels}
        series={series}
        valueFormatter={valueFormatter}
        axisFormatter={axisFormatter}
      />
    );
  }

  return (
    <LineChart
      height={CHART_HEIGHT}
      xAxis={[{ data: labels, scaleType: "point" }]}
      yAxis={yAxis}
      series={series.map((s) => ({
        id: s.id,
        label: s.label,
        data: s.data,
        valueFormatter,
      }))}
    />
  );
}
