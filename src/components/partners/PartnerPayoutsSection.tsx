"use client";

import {
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { apiRequest } from "@/utils/api-client";
import { formatDate, formatMoney } from "@/utils/format";
import { rangeSummary } from "@/utils/date-range";
import type { PartnerLedger } from "@/hooks/usePartnerLedger";
import type { AnalyticsRange, PartnerPayoutDTO } from "@/types/entities";
import PartnerLedgerSection from "./PartnerLedgerSection";

interface Props {
  partnerId: number;
  ledger: PartnerLedger<PartnerPayoutDTO>;
  range: AnalyticsRange;
  canWrite: boolean;
  /** Deleting a payout moves the balance and this list. Refetches both. */
  onChanged: () => void;
}

// Payouts recorded inside the range. Range-scoped like the sales beside it, so
// both tables answer the same period. The balance above them stays cumulative:
// what is owed is a position, not something a date range can narrow.
export default function PartnerPayoutsSection({
  partnerId,
  ledger,
  range,
  canWrite,
  onChanged,
}: Props) {
  async function remove(payout: PartnerPayoutDTO) {
    if (!window.confirm(`Delete the ${formatMoney(payout.amount)} payout?`)) {
      return;
    }
    await apiRequest(`/api/partners/${partnerId}/payouts/${payout.payoutId}`, {
      method: "DELETE",
    });
    onChanged();
  }

  return (
    <PartnerLedgerSection
      title="Payouts"
      subtitle={rangeSummary(range)}
      ledger={ledger}
      empty={`No payouts recorded in ${rangeSummary(range).toLowerCase()}.`}
    >
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Date</TableCell>
            <TableCell align="right">Amount</TableCell>
            <TableCell>Method</TableCell>
            <TableCell>Reference</TableCell>
            <TableCell>Added by</TableCell>
            {canWrite && <TableCell align="right">Actions</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {ledger.rows.map((p) => (
            <TableRow key={p.payoutId} hover>
              <TableCell>{formatDate(p.paidOn)}</TableCell>
              <TableCell align="right">{formatMoney(p.amount)}</TableCell>
              <TableCell>{p.method ?? "-"}</TableCell>
              <TableCell>{p.reference ?? "-"}</TableCell>
              <TableCell>{p.createdByName ?? "-"}</TableCell>
              {canWrite && (
                <TableCell align="right">
                  <Tooltip title="Delete">
                    <IconButton size="small" onClick={() => void remove(p)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </PartnerLedgerSection>
  );
}
