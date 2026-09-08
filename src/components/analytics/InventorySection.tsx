"use client";

import { Box, Stack, Typography } from "@mui/material";
import { useAnalyticsSection } from "@/hooks/useAnalyticsSection";
import { formatQty } from "@/utils/format";
import { rangeSummary } from "@/utils/date-range";
import DateRangeControl from "@/components/ui/DateRangeControl";
import CollapsibleSection from "@/components/ui/CollapsibleSection";
import ItemLookupCard from "./ItemLookupCard";
import ShelfValueCard from "./ShelfValueCard";
import {
  ChartCard,
  ChartGrid,
  HorizontalBars,
  KpiCard,
  KpiGrid,
  SectionPlaceholder,
  money,
} from "./AnalyticsPrimitives";
import type {
  AnalyticsRange,
  InventoryAnalytics,
  ItemsAnalytics,
} from "@/types/entities";

// Stock and the products that move it, in one place.
//
// The KPIs and the two warning lists are a snapshot: a stock level is a position,
// not a flow, so no date range can apply to them. The two sales cards are the
// opposite, and they share one range picked at the top of the section rather
// than the fixed 90-day window this used to hardcode.
//
// Those sales figures come off the invoice lines, not off stock movements. A
// movement only knows that stock left the shelf; a line knows what was charged
// and, when the goods come back, carries the money back too. Reading the lines
// is what lets a return net out of the item's figures instead of showing up as
// a second sale.
export default function InventorySection({
  initialRange,
}: {
  initialRange: AnalyticsRange;
}) {
  // Two fetches, because this one section is half position and half period.
  // Both start when it is opened, and it stays a placeholder until both land.
  const {
    data,
    loading: stockLoading,
    error: stockError,
    load: loadStock,
  } = useAnalyticsSection<InventoryAnalytics>("inventory", initialRange);
  const {
    range,
    data: items,
    loading: itemsLoading,
    error: itemsError,
    setRange,
    load: loadItems,
  } = useAnalyticsSection<ItemsAnalytics>("items", initialRange);

  const topSold = (items?.topSold ?? []).map((row) => ({
    label: row.name,
    value: row.netUnits,
  }));

  return (
    <CollapsibleSection
      title="Inventory"
      subtitle={`Stock now, sales ${rangeSummary(range).toLowerCase()}`}
      loading={stockLoading || itemsLoading}
      onExpand={() => {
        loadStock();
        loadItems();
      }}
      controls={<DateRangeControl range={range} onChange={setRange} />}
    >
      {data && items ? (
        <>
          <KpiGrid>
            <KpiCard label="Total items" value={String(data.totalItems)} />
            <KpiCard
              label="Stock value"
              value={money(data.stockCost)}
              hint={
                data.consignedCost != null && data.consignedCost !== 0
                  ? `includes ${money(data.consignedCost)} a partner earns on`
                  : undefined
              }
            />
            <KpiCard label="Low stock" value={String(data.lowStockCount)} />
            <KpiCard
              label="Out of stock"
              value={String(data.outOfStockCount)}
            />
            <KpiCard
              label="Expiring (30d)"
              value={String(data.expiringSoonCount)}
            />
          </KpiGrid>
          <ShelfValueCard data={data} />
          <ChartGrid>
            <ChartCard title="Top 10 items sold">
              {topSold.length > 0 ? (
                <HorizontalBars
                  items={topSold}
                  formatter={(v) => formatQty(v)}
                />
              ) : (
                <Box sx={{ py: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Nothing sold in these dates.
                  </Typography>
                </Box>
              )}
            </ChartCard>
            <ItemLookupCard range={range} />
            <ChartCard title="Low-stock items">
              {data.lowStockItems.length > 0 ? (
                <Stack spacing={1} sx={{ py: 1 }}>
                  {data.lowStockItems.map((it) => (
                    <Stack
                      key={it.itemId}
                      direction="row"
                      sx={{ justifyContent: "space-between" }}
                    >
                      <Typography variant="body2" noWrap sx={{ mr: 2 }}>
                        {it.name}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="error.main"
                        sx={{ flexShrink: 0 }}
                      >
                        {it.currentStock}
                        {it.unit ? ` ${it.unit}` : ""} / reorder at{" "}
                        {it.reorderLevel}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              ) : (
                <Box sx={{ py: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    No items are below their reorder level.
                  </Typography>
                </Box>
              )}
            </ChartCard>
            <ChartCard title="Out-of-stock items">
              {data.outOfStockItems.length > 0 ? (
                <Stack spacing={1} sx={{ py: 1 }}>
                  {data.outOfStockItems.map((it) => (
                    <Stack
                      key={it.itemId}
                      direction="row"
                      sx={{ justifyContent: "space-between" }}
                    >
                      <Typography variant="body2" noWrap sx={{ mr: 2 }}>
                        {it.name}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="error.main"
                        sx={{ flexShrink: 0 }}
                      >
                        0{it.unit ? ` ${it.unit}` : ""}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              ) : (
                <Box sx={{ py: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Everything is in stock.
                  </Typography>
                </Box>
              )}
            </ChartCard>
          </ChartGrid>
        </>
      ) : (
        <SectionPlaceholder error={stockError ?? itemsError} />
      )}
    </CollapsibleSection>
  );
}
