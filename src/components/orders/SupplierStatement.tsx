"use client";

import Link from "@/components/ui/AppLink";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PrintIcon from "@mui/icons-material/Print";
import { formatDate, formatDateTime, formatMoney } from "@/utils/format";
import { formatRangeLabel } from "@/utils/date-range";
import { printSupplierStatement } from "@/utils/print-statement";
import { AGING_BUCKETS } from "@/constants/statement";
import DateRangeControl from "@/components/ui/DateRangeControl";
import StatCard from "@/components/ui/StatCard";
import type { AnalyticsRange, StatementDTO } from "@/types/entities";

interface Props {
  statement: StatementDTO;
}

export default function SupplierStatement({ statement }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const { totals, range } = statement;

  // The period lives in the URL rather than in state, so a statement can be
  // linked to, reloaded, or attached to an audit trail and come back identical.
  function changeRange(next: AnalyticsRange) {
    startTransition(() => {
      router.push(`/orders/statement?from=${next.from}&to=${next.to}`);
    });
  }

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 0.5 }}
      >
        <Typography variant="h4">Supplier statement</Typography>
        <Stack direction="row" spacing={1}>
          <Button component={Link} href="/orders" variant="outlined">
            Back to orders
          </Button>
          <Button
            variant="contained"
            startIcon={<PrintIcon />}
            onClick={() => printSupplierStatement(statement)}
          >
            Print
          </Button>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        What was billed and what was paid over the period, per supplier, with
        the balance each account opened and closed on. A charge is recognised on
        the date its order was fully received or closed short.
      </Typography>

      <Box sx={{ mb: 2 }}>
        <DateRangeControl
          range={range}
          onChange={changeRange}
          disabled={pending}
        />
      </Box>
      {pending && <LinearProgress sx={{ mb: 2 }} />}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack
          direction="row"
          sx={{ flexWrap: "wrap", gap: 3, alignItems: "center" }}
        >
          <Detail label="Period" value={formatRangeLabel(range)} />
          <Detail label="Balances as at" value={formatDate(statement.asAt)} />
          <Detail label="Currency" value={statement.currency} />
          <Detail
            label="Generated"
            value={formatDateTime(statement.generatedAt)}
          />
          <Detail label="Accounts" value={String(totals.supplierCount)} />
        </Stack>
      </Paper>

      {!totals.ties && (
        <Alert severity="error" sx={{ mb: 2 }}>
          This statement does not reconcile. On at least one account the listed
          documents do not sum to the closing balance, which means something is
          missing. Do not rely on these figures until it is resolved.
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gap: 2,
          mb: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            md: `repeat(${Number(totals.credited) !== 0 ? 5 : 4}, 1fr)`,
          },
        }}
      >
        <StatCard
          label="Opening balance"
          value={formatMoney(totals.openingBalance)}
          hint="Owed when the period began"
        />
        <StatCard
          label="Charges"
          value={formatMoney(totals.billed)}
          hint="Orders received in the period"
        />
        <StatCard
          label="Payments"
          value={formatMoney(totals.paid)}
          hint="Cash out in the period"
        />
        {/* Only on a period that actually had one. A permanent zero here would
            be a column of explanation for something that never happens on most
            accounts. */}
        {Number(totals.credited) !== 0 && (
          <StatCard
            label="Credits"
            value={formatMoney(totals.credited)}
            hint="Settled by credit note, not cash"
          />
        )}
        <StatCard
          label="Closing balance"
          value={formatMoney(totals.closingBalance)}
          accent={Number(totals.closingBalance) > 0 ? "warning" : "success"}
          hint={
            Number(totals.credited) !== 0
              ? "Opening plus charges, less payments and credits"
              : "Opening plus charges less payments"
          }
        />
      </Box>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Aged payables as at {formatDate(statement.asAt)}
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {AGING_BUCKETS.map((b) => (
                <TableCell key={b.id} align="right">
                  {b.label}
                </TableCell>
              ))}
              <TableCell align="right">Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              {AGING_BUCKETS.map((b) => (
                <TableCell key={b.id} align="right">
                  {formatMoney(totals.aging[b.id] ?? "0")}
                </TableCell>
              ))}
              <TableCell align="right" sx={{ fontWeight: 700 }}>
                {formatMoney(totals.closingBalance)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ mb: 3, display: "block" }}
      >
        Payments are applied to the oldest charge first, so the buckets always
        sum to the closing balance.
      </Typography>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Accounts
      </Typography>

      {statement.suppliers.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4 }}>
          <Typography color="text.secondary" align="center">
            No supplier activity in this period, and no balances carried into
            it.
          </Typography>
        </Paper>
      ) : (
        statement.suppliers.map((s) => (
          <Accordion
            key={`${s.supplierId}-${range.from}-${range.to}`}
            disableGutters
            elevation={0}
            sx={{
              border: 1,
              borderColor: s.ties ? "divider" : "error.main",
              borderRadius: 2,
              mb: 1.5,
              "&:before": { display: "none" },
              "&:first-of-type": { borderRadius: 2 },
              "&:last-of-type": { borderRadius: 2 },
              "&.Mui-expanded": { mb: 1.5 },
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2 }}>
              <Stack
                direction="row"
                sx={{
                  width: "100%",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 2,
                  pr: 1,
                }}
              >
                <Typography sx={{ fontWeight: 600, minWidth: 160 }}>
                  <Link href={`/suppliers/${s.supplierId}`}>
                    {s.supplierName}
                  </Link>
                </Typography>
                {!s.ties && (
                  <Chip size="small" color="error" label="Does not reconcile" />
                )}
                <Box sx={{ flexGrow: 1 }} />
                <Figure label="Opening" value={s.openingBalance} />
                <Figure label="Charges" value={s.billed} />
                <Figure label="Payments" value={s.paid} />
                {Number(s.credited) !== 0 && (
                  <Figure label="Credits" value={s.credited} />
                )}
                <Figure label="Closing" value={s.closingBalance} bold />
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Reference</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell align="right">Charges</TableCell>
                      <TableCell align="right">Payments</TableCell>
                      <TableCell align="right">Balance</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell colSpan={5} sx={{ fontWeight: 600 }}>
                        Balance brought forward
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {formatMoney(s.openingBalance)}
                      </TableCell>
                    </TableRow>
                    {s.lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Typography
                            color="text.secondary"
                            sx={{ py: 1, fontStyle: "italic" }}
                          >
                            No activity in this period.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      s.lines.map((l, i) => (
                        <TableRow key={`${l.kind}-${l.reference}-${i}`} hover>
                          <TableCell>{formatDate(l.date)}</TableCell>
                          <TableCell>
                            {l.href ? (
                              <Link href={l.href}>{l.reference}</Link>
                            ) : (
                              l.reference
                            )}
                          </TableCell>
                          <TableCell>{l.description}</TableCell>
                          <TableCell align="right">
                            {Number(l.charge) ? formatMoney(l.charge) : ""}
                          </TableCell>
                          <TableCell align="right">
                            {Number(l.payment) ? formatMoney(l.payment) : ""}
                          </TableCell>
                          <TableCell align="right">
                            {formatMoney(l.balance)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={5} sx={{ fontWeight: 600 }}>
                        Balance carried forward
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>
                        {formatMoney(s.closingBalance)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>
              <Stack
                direction="row"
                sx={{ flexWrap: "wrap", gap: 3, px: 2, py: 1.5 }}
              >
                {AGING_BUCKETS.map((b) => (
                  <Detail
                    key={b.id}
                    label={b.label}
                    value={formatMoney(s.aging[b.id] ?? "0")}
                  />
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))
      )}
    </Box>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block" }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}

// Compact figure for the collapsed account header, so the four numbers that make
// up the statement identity read left to right without expanding anything.
function Figure({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <Box sx={{ textAlign: "right", minWidth: 96 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block" }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: bold ? 700 : 500 }}>
        {formatMoney(value)}
      </Typography>
    </Box>
  );
}
