"use client";

import Link from "@/components/ui/AppLink";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { formatMoney } from "@/utils/format";
import { rangeSummary } from "@/utils/date-range";
import type { PartnerLedger } from "@/hooks/usePartnerLedger";
import type {
  AnalyticsRange,
  PartnerItemPerformanceDTO,
} from "@/types/entities";
import PartnerLedgerSection from "./PartnerLedgerSection";

interface Props {
  ledger: PartnerLedger<PartnerItemPerformanceDTO>;
  range: AnalyticsRange;
}

// How each of the partner's lines performed over the range. Every item they
// source is listed, including ones that sold nothing, since a line sitting
// still is exactly what the clinic wants to spot. That is also why this is the
// longest table on the page and the last one to load.
export default function PartnerItemsSection({ ledger, range }: Props) {
  return (
    <PartnerLedgerSection
      title="By item"
      subtitle={`${rangeSummary(range)}${ledger.loaded ? ` · ${ledger.total} item${ledger.total === 1 ? "" : "s"}` : ""}`}
      ledger={ledger}
      empty="No items are sourced from this partner yet."
    >
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Item</TableCell>
            <TableCell align="right">In stock</TableCell>
            <TableCell align="right">Capital held</TableCell>
            <TableCell align="right">Sold</TableCell>
            <TableCell align="right">Revenue</TableCell>
            <TableCell align="right">Cost</TableCell>
            <TableCell align="right">Gross profit</TableCell>
            <TableCell align="right">Their share</TableCell>
            <TableCell align="right">Clinic share</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {ledger.rows.map((row) => {
            const idle = Number(row.unitsSold) === 0;
            return (
              <TableRow key={row.itemId} hover>
                <TableCell>
                  <Link href={`/inventory/${row.itemId}`}>{row.itemName}</Link>
                  {row.unit && (
                    <Typography variant="caption" color="text.secondary">
                      {` (${row.unit})`}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">{row.currentStock}</TableCell>
                <TableCell align="right">
                  {formatMoney(row.capitalOnShelf)}
                </TableCell>
                <TableCell
                  align="right"
                  sx={{ color: idle ? "text.disabled" : undefined }}
                >
                  {row.unitsSold}
                </TableCell>
                <TableCell align="right">{formatMoney(row.revenue)}</TableCell>
                <TableCell align="right">
                  {formatMoney(row.costOfSales)}
                </TableCell>
                <TableCell align="right">
                  {formatMoney(row.grossProfit)}
                </TableCell>
                <TableCell align="right">
                  {formatMoney(row.partnerShare)}
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    color:
                      Number(row.clinicShare) < 0 ? "error.main" : undefined,
                  }}
                >
                  {formatMoney(row.clinicShare)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </PartnerLedgerSection>
  );
}
