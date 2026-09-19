"use client";

import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import { CHART_VIEWS, type ChartView } from "@/constants/analytics";

// The Bars / Stacked / Lines switch at the right of a trend card's heading.
// The same control on every trend, so the section reads as one system.
export default function ChartViewToggle({
  value,
  onChange,
}: {
  value: ChartView;
  onChange: (next: ChartView) => void;
}) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      onChange={(_, next: ChartView | null) => next && onChange(next)}
      aria-label="Chart type"
    >
      {CHART_VIEWS.map((v) => (
        <ToggleButton key={v.key} value={v.key}>
          {v.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
