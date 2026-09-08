"use client";

import { useState } from "react";
import {
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import { useAnalyticsSection } from "@/hooks/useAnalyticsSection";
import { formatRangeLabel, rangeSummary } from "@/utils/date-range";
import DateRangeControl from "@/components/ui/DateRangeControl";
import CollapsibleSection from "@/components/ui/CollapsibleSection";
import {
  CHART_HEIGHT,
  ChartCard,
  DeltaChip,
  EmptyChart,
  KpiCard,
  KpiGrid,
  SectionPlaceholder,
  money,
} from "./AnalyticsPrimitives";
import type {
  AnalyticsRange,
  CategoriesAnalytics,
  CategoryTrendGroup,
} from "@/types/entities";

type Mode = "mom" | "yoy";

function GroupTable({ group }: { group: CategoryTrendGroup }) {
  return (
    <ChartCard title={group.label} full>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Category</TableCell>
            <TableCell align="right">This period</TableCell>
            <TableCell align="right">Comparison</TableCell>
            <TableCell align="right">Change</TableCell>
            <TableCell align="right">%</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {group.rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <TableCell align="right">{money(row.current)}</TableCell>
              <TableCell align="right">{money(row.prior)}</TableCell>
              <TableCell align="right">{money(row.delta)}</TableCell>
              <TableCell align="right">
                <DeltaChip
                  delta={row.delta}
                  prior={row.prior}
                  percent={row.percent}
                />
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>
              {money(group.current)}
            </TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>
              {money(group.prior)}
            </TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>
              {money(group.delta)}
            </TableCell>
            <TableCell align="right">
              <DeltaChip
                delta={group.delta}
                prior={group.prior}
                percent={group.percent}
              />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </ChartCard>
  );
}

// Billed revenue by category, this period against the same dates a month or a
// year earlier. Both comparisons arrive in one payload, so the toggle is a
// local state change and never refetches.
export default function CategoriesSection({
  initialRange,
}: {
  initialRange: AnalyticsRange;
}) {
  const { range, data, loading, error, setRange, load } =
    useAnalyticsSection<CategoriesAnalytics>("categories", initialRange);
  const [mode, setMode] = useState<Mode>("mom");
  const comparison = data?.[mode] ?? null;
  const hasData = (comparison?.groups.length ?? 0) > 0;

  return (
    <CollapsibleSection
      title="Category performance"
      subtitle={rangeSummary(range)}
      loading={loading}
      onExpand={load}
      controls={
        <Stack spacing={2}>
          <DateRangeControl range={range} onChange={setRange} />
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <ToggleButtonGroup
              size="small"
              exclusive
              value={mode}
              onChange={(_, next: Mode | null) => next && setMode(next)}
            >
              <ToggleButton value="mom">Month on month</ToggleButton>
              <ToggleButton value="yoy">Year on year</ToggleButton>
            </ToggleButtonGroup>
            {comparison && (
              <Typography variant="body2" color="text.secondary">
                Compared against {formatRangeLabel(comparison.priorRange)}
              </Typography>
            )}
          </Stack>
        </Stack>
      }
    >
      {comparison ? (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Billed revenue, not cash collected: a payment settles an invoice
            rather than a line, so it cannot be split by category. These figures
            will not match the Collected total in Revenue.
          </Typography>

          <KpiGrid>
            <KpiCard
              label="Billed this period"
              value={money(comparison.total.current)}
            />
            <KpiCard
              label="Comparison period"
              value={money(comparison.total.prior)}
            />
            <KpiCard label="Change" value={money(comparison.total.delta)} />
            <KpiCard
              label="Growth"
              value={
                comparison.total.percent === null
                  ? "-"
                  : `${comparison.total.percent > 0 ? "+" : ""}${comparison.total.percent}%`
              }
            />
          </KpiGrid>

          {!hasData ? (
            <EmptyChart />
          ) : (
            <Stack spacing={2} sx={{ mt: 2 }}>
              <ChartCard title="Business lines, this period vs comparison" full>
                <BarChart
                  height={CHART_HEIGHT}
                  xAxis={[
                    {
                      data: comparison.groups.map((g) => g.label),
                      scaleType: "band",
                    },
                  ]}
                  series={[
                    {
                      label: "This period",
                      data: comparison.groups.map((g) => g.current),
                      valueFormatter: (v) => money(v ?? 0),
                    },
                    {
                      label: "Comparison",
                      data: comparison.groups.map((g) => g.prior),
                      valueFormatter: (v) => money(v ?? 0),
                    },
                  ]}
                />
              </ChartCard>
              {comparison.groups.map((group) => (
                <GroupTable key={group.key} group={group} />
              ))}
            </Stack>
          )}
        </>
      ) : (
        <SectionPlaceholder error={error} />
      )}
    </CollapsibleSection>
  );
}
