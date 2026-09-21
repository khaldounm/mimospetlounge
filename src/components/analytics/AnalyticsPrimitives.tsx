"use client";

import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import { formatMoney, formatShare } from "@/utils/format";
import type { NamedCount, NamedValue } from "@/types/entities";

export const CHART_HEIGHT = 280;

export const money = (v: number | null) => formatMoney(v ?? 0);

export function KpiCard({
  label,
  value,
  // Optional second line under the figure, for a card whose number needs
  // breaking down before it can be read correctly.
  hint,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        sx={{ display: "block" }}
      >
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.5 }}>
        {value}
      </Typography>
      {hint && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 0.5 }}
        >
          {hint}
        </Typography>
      )}
    </Paper>
  );
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: {
          xs: "repeat(2, 1fr)",
          sm: "repeat(3, 1fr)",
          md: "repeat(5, 1fr)",
        },
      }}
    >
      {children}
    </Box>
  );
}

// Two cards to a row by default. A section with three cards under a full-width
// one passes columns={3}, which only takes effect at lg: three charts side by
// side on a laptop are too narrow to read, so they stay two-up until there is
// room for the third.
export function ChartGrid({
  children,
  columns = 2,
}: {
  children: React.ReactNode;
  columns?: 2 | 3;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        mt: 2,
        gridTemplateColumns: {
          xs: "1fr",
          md: "1fr 1fr",
          ...(columns === 3 ? { lg: "repeat(3, 1fr)" } : {}),
        },
      }}
    >
      {children}
    </Box>
  );
}

export function ChartCard({
  title,
  children,
  full,
  // Sits at the right of the card heading, for a control that belongs to this
  // card rather than to the section (a download icon, say).
  action,
}: {
  title: string;
  children: React.ReactNode;
  full?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, gridColumn: full ? { md: "1 / -1" } : undefined }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

export function EmptyChart() {
  return (
    <Box
      sx={{
        height: CHART_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        No data in this range.
      </Typography>
    </Box>
  );
}

// Stands in for a section's figures while they are being fetched, and carries
// the message if the fetch fails. A section is computed when it is opened, so
// this is what the first moment after an expand looks like. The wrapper is
// already showing a progress bar, so this only has to hold the space and say
// why it is empty.
export function SectionPlaceholder({ error }: { error?: string | null }) {
  return (
    <Box
      sx={{
        minHeight: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Typography variant="body2" color={error ? "error" : "text.secondary"}>
        {error ?? "Working out the figures..."}
      </Typography>
    </Box>
  );
}

// Horizontal bar chart for ranked label/value lists (services, sold items).
export function HorizontalBars({
  items,
  formatter,
}: {
  items: NamedValue[];
  formatter: (v: number) => string;
}) {
  return (
    <BarChart
      layout="horizontal"
      height={CHART_HEIGHT}
      margin={{ left: 8 }}
      yAxis={[
        { data: items.map((i) => i.label), scaleType: "band", width: 120 },
      ]}
      series={[
        {
          data: items.map((i) => i.value),
          valueFormatter: (v) => formatter(v ?? 0),
        },
      ]}
    />
  );
}

export function toPieData(items: NamedCount[]) {
  return items.map((it, idx) => ({
    id: idx,
    value: it.count,
    label: it.label,
  }));
}

// A period-over-period movement, coloured by direction. A null percent means
// the prior window gave no base to grow from, and the two ways that happens read
// differently: nothing billed at all is genuinely "new", whereas a window that
// netted negative (a discount line, or returns outrunning sales) has a base that
// a percentage simply cannot describe. Calling the second one "new" would be a
// lie, so it gets "n/a".
export function DeltaChip({
  delta,
  prior,
  percent,
}: {
  delta: number;
  prior: number;
  percent: number | null;
}) {
  if (percent === null) {
    if (delta === 0) return <Chip size="small" variant="outlined" label="-" />;
    const isNew = prior === 0;
    return (
      <Chip
        size="small"
        variant="outlined"
        label={isNew ? "New" : "n/a"}
        color={isNew && delta > 0 ? "success" : "default"}
      />
    );
  }
  const up = percent > 0;
  return (
    <Chip
      size="small"
      variant="outlined"
      color={percent === 0 ? "default" : up ? "success" : "error"}
      label={`${up ? "+" : ""}${percent}%`}
    />
  );
}

// The bar column. Set as a minimum as well as a width: the name column takes
// every spare pixel, and a plain width on this one was squeezed to half.
export const SHARE_COLUMN_WIDTH = 225;

// A line's weight in a ranked list as a progress bar: filled in proportion to
// the top line, so the ranking reads at a glance, with the line's share of the
// whole (the category, or the supplier's range) printed over the middle of the
// bar. Two scales on purpose: a bar filled to the share would make the top
// line a sliver in a category of two hundred products, and say nothing.
//
// Green, the same as a growth chip: this is a positive quantity. Square at
// the start and barely rounded at the end, so the bars read as one aligned
// column rather than a stack of pills.
export function ShareBar({
  value,
  max,
  share,
}: {
  // How far the bar fills, against `max`. Null draws an empty track.
  value: number | null;
  max: number;
  // What the label says. Null shows no label.
  share: number | null;
}) {
  const width =
    value !== null && max > 0 && value > 0
      ? Math.min(Math.max((value / max) * 100, 2), 100)
      : 0;
  return (
    <Box
      sx={{
        position: "relative",
        height: 20,
        borderRadius: "0 3px 3px 0",
        bgcolor: "action.hover",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          width: `${width}%`,
          height: "100%",
          borderRadius: "0 3px 3px 0",
          bgcolor: "success.main",
          opacity: 0.4,
          transition: "width 350ms ease",
        }}
      />
      {share !== null && (
        <Typography
          variant="caption"
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // The label sits on the track as often as on the fill, so it
            // takes the green that contrasts with the page: the dark shade
            // on cream, the light shade on a near-black ground, where the
            // dark shade vanished.
            color: (t) =>
              t.palette.mode === "dark"
                ? t.palette.success.light
                : t.palette.success.dark,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {formatShare(share)}
        </Typography>
      )}
    </Box>
  );
}
