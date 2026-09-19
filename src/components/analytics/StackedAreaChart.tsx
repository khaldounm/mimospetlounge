"use client";

import { useId } from "react";
import { useTheme } from "@mui/material/styles";
import { LineChart, lineClasses } from "@mui/x-charts/LineChart";
import { chartsGridClasses } from "@mui/x-charts/ChartsGrid";
import { AREA_COLORS } from "@/constants/analytics";
import { CHART_HEIGHT } from "./AnalyticsPrimitives";

export interface StackedAreaSeries {
  id: string;
  label: string;
  data: number[];
}

// How much of the band's colour shows at the top of its wash, and at the
// bottom. The line above carries the full colour; the fill is a hint of it.
const WASH_TOP = 0.42;
const WASH_BOTTOM = 0.04;

// Series piled into one area so the top edge is their total, each band a
// translucent wash fading downward under a 2px line in its own colour. The
// gradient is per band and clipped to the band's own box, so every band
// fades from its line to the one below it rather than to the axis.
export default function StackedAreaChart({
  labels,
  series,
  valueFormatter,
  axisFormatter,
}: {
  labels: string[];
  series: StackedAreaSeries[];
  valueFormatter?: (v: number | null) => string;
  axisFormatter?: (v: number) => string;
}) {
  const theme = useTheme();
  const colors = AREA_COLORS[theme.palette.mode];
  // One gradient per band, ids scoped to this chart so two charts on the
  // same page cannot paint from each other's defs.
  const uid = useId().replace(/:/g, "");
  const gradientId = (id: string) => `area-${uid}-${id}`;

  const fills = Object.fromEntries(
    series.map((s) => [
      `& .${lineClasses.area}[data-series="${s.id}"]`,
      { fill: `url(#${gradientId(s.id)})` },
    ]),
  );

  return (
    <LineChart
      height={CHART_HEIGHT}
      xAxis={[{ data: labels, scaleType: "point" }]}
      yAxis={axisFormatter ? [{ valueFormatter: axisFormatter }] : undefined}
      grid={{ horizontal: true }}
      series={series.map((s, i) => ({
        id: s.id,
        label: s.label,
        data: s.data,
        color: colors[i % colors.length],
        area: true,
        stack: "total",
        showMark: false,
        valueFormatter,
      }))}
      sx={{
        [`& .${lineClasses.line}`]: { strokeWidth: 2 },
        [`& .${chartsGridClasses.line}`]: {
          stroke: theme.palette.divider,
          strokeDasharray: "4 4",
        },
        ...fills,
      }}
    >
      <defs>
        {series.map((s, i) => {
          const color = colors[i % colors.length];
          return (
            <linearGradient
              key={s.id}
              id={gradientId(s.id)}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={color} stopOpacity={WASH_TOP} />
              <stop offset="100%" stopColor={color} stopOpacity={WASH_BOTTOM} />
            </linearGradient>
          );
        })}
      </defs>
    </LineChart>
  );
}
