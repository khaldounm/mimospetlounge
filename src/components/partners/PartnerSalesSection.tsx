"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@mui/material";
import { formatDateTime, formatMoney } from "@/utils/format";
import { rangeSummary } from "@/utils/date-range";
import type { PartnerLedger } from "@/hooks/usePartnerLedger";
import type { AnalyticsRange, PartnerEarningDTO } from "@/types/entities";
import PartnerLedgerSection from "./PartnerLedgerSection";

interface Props {
  ledger: PartnerLedger<PartnerEarningDTO>;
  range: AnalyticsRange;
  /** Their last sale of all time, for the empty state. See PartnerDTO. */
  lastMovementAt: string | null | undefined;
}

// Every sale that moved this partner's stock inside the range, newest first.
// Owed is capital plus their share for that sale.
export default function PartnerSalesSection({
  ledger,
  range,
  lastMovementAt,
}: Props) {
  // An empty range is the normal case on a quiet day, so it must not read like
  // a partner who has never sold anything. Where their last sale actually was
  // is the difference, and it is the one thing here that ignores the dates.
  const empty = lastMovementAt
    ? `Nothing sold in ${rangeSummary(range).toLowerCase()}. Their most recent sale was ${formatDateTime(lastMovementAt)}, so widen the dates to see it.`
    : "No sales yet. Owed amounts accrue as this partner's items are sold on issued invoices.";

  return (
    <PartnerLedgerSection
      title="Every sale"
      subtitle={rangeSummary(range)}
      ledger={ledger}
      empty={empty}
    >
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Date</TableCell>
            <TableCell>Invoice</TableCell>
            <TableCell>Item</TableCell>
            <TableCell align="right">Qty</TableCell>
            <TableCell align="right">Owed</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {ledger.rows.map((e) => (
            <TableRow key={e.transactionId} hover>
              <TableCell>{formatDateTime(e.performedAt)}</TableCell>
              <TableCell>
                {e.invoiceNumber ?? "-"}
                {e.type !== "Sold" ? " (void)" : ""}
              </TableCell>
              <TableCell>{e.itemName}</TableCell>
              <TableCell align="right">
                {Math.abs(Number(e.quantity))}
              </TableCell>
              <TableCell
                align="right"
                sx={{ color: Number(e.payable) < 0 ? "error.main" : undefined }}
              >
                {formatMoney(e.payable)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </PartnerLedgerSection>
  );
}
