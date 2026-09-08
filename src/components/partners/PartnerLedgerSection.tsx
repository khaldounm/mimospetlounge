"use client";

import {
  Alert,
  Paper,
  TableContainer,
  TablePagination,
  Typography,
} from "@mui/material";
import CollapsibleSection from "@/components/ui/CollapsibleSection";
import type { PartnerLedger } from "@/hooks/usePartnerLedger";

interface Props<T> {
  title: string;
  subtitle?: string;
  ledger: PartnerLedger<T>;
  /** The table itself. Rendered only once a response has arrived. */
  children: React.ReactNode;
  /** Shown in place of the table when the range holds nothing. */
  empty: React.ReactNode;
}

// The frame every partner ledger shares: a collapsed header that loads its page
// on first open, and a pager underneath. Only the table between them differs,
// so it is the only thing each section has to supply.
export default function PartnerLedgerSection<T>({
  title,
  subtitle,
  ledger,
  children,
  empty,
}: Props<T>) {
  const showEmpty = ledger.loaded && ledger.total === 0;

  return (
    <CollapsibleSection
      title={title}
      subtitle={subtitle}
      loading={ledger.loading}
      onExpand={ledger.open}
    >
      {ledger.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {ledger.error}
        </Alert>
      )}

      {showEmpty ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          {empty}
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          {children}
        </TableContainer>
      )}

      {/* Only worth a pager when there is more than one page of rows. The
          count is the whole range, not the page, so it arrives with the first
          response and never needs a second request. */}
      {ledger.total > ledger.pageSize && (
        <TablePagination
          component="div"
          count={ledger.total}
          page={ledger.page}
          onPageChange={(_e, next) => ledger.setPage(next)}
          rowsPerPage={ledger.pageSize}
          rowsPerPageOptions={[]}
        />
      )}
    </CollapsibleSection>
  );
}
