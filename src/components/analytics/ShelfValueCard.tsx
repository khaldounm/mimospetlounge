"use client";

import { Box, Divider, Paper, Stack, Typography } from "@mui/material";
import { formatMoney } from "@/utils/format";
import type { InventoryAnalytics } from "@/types/entities";

function Row({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: number;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
      <Stack sx={{ minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={{ fontWeight: strong ? 600 : undefined }}
        >
          {label}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </Stack>
      <Typography
        variant="body2"
        sx={{
          fontWeight: strong ? 700 : 600,
          whiteSpace: "nowrap",
          color: value < 0 ? "error.main" : undefined,
        }}
      >
        {formatMoney(value)}
      </Typography>
    </Stack>
  );
}

// What the stock on the shelf is worth, costed and priced, with the margin
// between the two split by whose money it actually is.
//
// This card exists because one "stock value" number could not be reconciled
// against anything. That figure is clinic-funded stock only: consigned stock is
// the partner's cash, not the clinic's, so it is left out. Against a report that
// counts every item on the shelf it therefore comes up short by the whole
// consigned holding, and nothing on the screen explained the difference.
//
// Everything here is what WOULD happen if the stock sold at today's prices.
// None of it has been earned. The heading says so, because a card of money
// figures with no verb reads as money in hand.
export default function ShelfValueCard({ data }: { data: InventoryAnalytics }) {
  // All six travel together and are nulled together by the API for a caller
  // without orders:read. One check stands for the set.
  if (data.retailValue == null) return null;

  const consignedCost = data.consignedCost ?? 0;
  const clinicProfit = data.clinicProfit ?? 0;
  const partnerShare = data.partnerShare ?? 0;
  const partnerCostPart = data.partnerShareCostPart ?? 0;
  const missingCost = data.itemsMissingCost ?? 0;
  const missingPrice = data.itemsMissingPrice ?? 0;

  const caveats: string[] = [];
  if (missingCost > 0) {
    caveats.push(
      `${missingCost} item${missingCost === 1 ? "" : "s"} in stock with no cost recorded, counted at zero`,
    );
  }
  if (missingPrice > 0) {
    caveats.push(
      `${missingPrice} item${missingPrice === 1 ? "" : "s"} in stock with no sale price, counted at zero`,
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
        Stock on hand
      </Typography>
      <Typography variant="caption" color="text.secondary">
        What it cost, and what it would make if every item sold at today&apos;s
        price. Nothing here is earned yet.
      </Typography>

      <Stack spacing={1} sx={{ mt: 1.5 }}>
        <Row
          label="Cost value"
          value={data.stockCost}
          hint={
            consignedCost !== 0
              ? `your cash tied up in stock, including ${formatMoney(consignedCost)} of stock a partner earns on`
              : "your cash tied up in stock"
          }
          strong
        />
        <Divider />
        <Row
          label="Clinic profit"
          value={clinicProfit}
          hint="the margin you would keep"
        />
        {partnerShare !== 0 && (
          <Row
            label="Partner profit"
            value={partnerShare}
            hint={
              // A deal that returns the partner's outlay makes this line more
              // than their earnings, so it says so. At a 0% cost rate there is
              // nothing to say and the line is exactly what it is called.
              partnerCostPart !== 0
                ? `their cut of the consigned stock, including ${formatMoney(partnerCostPart)} of their outlay coming back`
                : "their cut of the margin on the consigned stock"
            }
          />
        )}
        <Divider />
        <Row
          label="Total"
          value={data.retailValue}
          hint="the whole shelf at its sale price"
          strong
        />
      </Stack>

      {caveats.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          {caveats.map((c) => (
            <Typography
              key={c}
              variant="caption"
              color="text.secondary"
              sx={{ display: "block" }}
            >
              {c}
            </Typography>
          ))}
        </Box>
      )}
    </Paper>
  );
}
