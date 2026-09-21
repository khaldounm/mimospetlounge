"use client";

import { useState } from "react";
import Link from "@/components/ui/AppLink";
import { Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import DescriptionIcon from "@mui/icons-material/Description";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
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
import { SUPPLIER_ITEM_ORDER_LABELS } from "@/constants/analytics";
import SupplierItemsDialog, {
  type SupplierItemsTarget,
} from "./SupplierItemsDialog";
import type { AnalyticsRange, PurchasesAnalytics } from "@/types/entities";

export default function PurchasesSection({
  initialRange,
}: {
  initialRange: AnalyticsRange;
}) {
  const { range, data, loading, error, setRange, load } =
    useAnalyticsSection<PurchasesAnalytics>("purchases", initialRange);
  const trendHasData = data?.trend.some((t) => t.billed > 0 || t.paid > 0);

  // The "products by supplier" box: which supplier is picked, and which of
  // its two lists is open. The picker holds the id as the select's string
  // value; the supplier itself is looked up when a list is opened, so the
  // dialog can carry its name without another request.
  const [supplierId, setSupplierId] = useState("");
  const [itemsTarget, setItemsTarget] = useState<SupplierItemsTarget | null>(
    null,
  );
  const pickedSupplier =
    data?.suppliers.find((s) => String(s.supplierId) === supplierId) ?? null;

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
            {/* Which of a supplier's products move and which do not, over
                this section's range. Nothing is fetched until a list is
                opened: the picker is fed from the section's own reply. */}
            <ChartCard title="Products by supplier">
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Pick a supplier to see which of its products sold the most units
                in each category over {rangeSummary(range).toLowerCase()}, and
                which sold the fewest.
              </Typography>
              <TextField
                select
                label="Supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                fullWidth
                size="small"
                helperText={
                  data.suppliers.length === 0
                    ? "No supplier has products filed under it yet."
                    : "Only suppliers with products filed under them."
                }
              >
                {data.suppliers.map((s) => (
                  <MenuItem key={s.supplierId} value={String(s.supplierId)}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button
                  variant="contained"
                  color="success"
                  disableElevation
                  startIcon={<TrendingUpIcon />}
                  disabled={!pickedSupplier}
                  onClick={() =>
                    pickedSupplier &&
                    setItemsTarget({ supplier: pickedSupplier, order: "top" })
                  }
                >
                  {SUPPLIER_ITEM_ORDER_LABELS.top}
                </Button>
                <Button
                  variant="contained"
                  color="warning"
                  disableElevation
                  startIcon={<TrendingDownIcon />}
                  disabled={!pickedSupplier}
                  onClick={() =>
                    pickedSupplier &&
                    setItemsTarget({
                      supplier: pickedSupplier,
                      order: "bottom",
                    })
                  }
                >
                  {SUPPLIER_ITEM_ORDER_LABELS.bottom}
                </Button>
              </Stack>
            </ChartCard>
          </ChartGrid>

          <SupplierItemsDialog
            target={itemsTarget}
            range={range}
            onClose={() => setItemsTarget(null)}
          />

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
