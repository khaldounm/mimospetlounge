"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/AppLink";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import PaymentsIcon from "@mui/icons-material/Payments";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { apiRequest } from "@/utils/api-client";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatSecondaryMoney,
} from "@/utils/format";
import { formatRangeLabel } from "@/utils/date-range";
import { clientStatementFileName } from "@/utils/whatsapp";
import DateRangeControl from "@/components/ui/DateRangeControl";
import type {
  AnalyticsRange,
  ClientStatementDTO,
  ClientStatementLineDTO,
} from "@/types/entities";
import AccountPaymentDialog from "./AccountPaymentDialog";

interface Props {
  statement: ClientStatementDTO;
  fxRate: number;
  canPay: boolean;
  canSend: boolean;
  canOpenInvoices: boolean;
}

// Two ways to read the same ledger. Summary is the one-line-per-document view a
// client checks a total against; detailed opens every invoice out into what was
// actually bought, which is the view that answers "what was this charge for?"
// without anyone digging out the original slip.
type View = "summary" | "detailed";

const NUM = { fontVariantNumeric: "tabular-nums" } as const;

export default function ClientStatement({
  statement,
  fxRate,
  canPay,
  canSend,
  canOpenInvoices,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<View>("summary");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [waBusy, setWaBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { range, lines } = statement;
  const owed = Number(statement.accountBalance);
  const detailed = view === "detailed";

  // The period lives in the URL rather than in state, so a statement can be
  // linked to and come back identical.
  function changeRange(next: AnalyticsRange) {
    startTransition(() => {
      router.push(
        `/clients/${statement.clientId}/statement?from=${next.from}&to=${next.to}`,
      );
    });
  }

  function showFullHistory() {
    startTransition(() => {
      router.push(`/clients/${statement.clientId}/statement`);
    });
  }

  // The PDF is the same component the server renders for the WhatsApp
  // attachment, so what staff download and what the client receives are the
  // same document. The renderer is loaded on demand to keep it out of the page
  // bundle.
  async function downloadPdf() {
    setPdfBusy(true);
    setError(null);
    try {
      const [{ pdf }, { default: ClientStatementPdfDocument }] =
        await Promise.all([
          import("@react-pdf/renderer"),
          import("./ClientStatementPdfDocument"),
        ]);
      const blob = await pdf(
        <ClientStatementPdfDocument
          statement={statement}
          detailed={detailed}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = clientStatementFileName(statement);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setPdfBusy(false);
    }
  }

  async function sendWhatsApp() {
    setError(null);
    setSuccess(null);
    setWaBusy(true);
    try {
      // The period and the level of detail go with it, so the client receives
      // the statement staff were looking at rather than a different one.
      await apiRequest(
        `/api/clients/${statement.clientId}/statement/whatsapp`,
        {
          method: "POST",
          body: { from: range.from, to: range.to, detailed },
        },
      );
      setConfirmSend(false);
      setSuccess(`Statement sent to ${statement.clientName} via WhatsApp.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send via WhatsApp",
      );
    } finally {
      setWaBusy(false);
    }
  }

  return (
    <Box>
      <Button
        component={Link}
        href={`/clients/${statement.clientId}`}
        startIcon={<ArrowBackIcon />}
        variant="text"
        sx={{ ml: -1, mb: 1 }}
      >
        {statement.clientName}
      </Button>

      {/* The headline. A client asking about their account wants one number,
          and staff reading it over the phone want it at the top of the page,
          not folded into a table. */}
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2.5, sm: 3 },
          mb: 2,
          borderLeftWidth: 4,
          borderLeftColor: owed > 0 ? "warning.main" : "secondary.main",
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}
        >
          <Box>
            <Typography variant="overline" color="text.secondary">
              Statement of account
            </Typography>
            <Typography variant="h3" sx={{ ...NUM, mt: 0.5 }}>
              {formatMoney(Math.abs(owed))}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {owed > 0
                ? "Outstanding"
                : owed < 0
                  ? "In credit"
                  : "Account settled"}
              {" as at "}
              {formatDate(statement.asAt)}
              {owed !== 0
                ? ` · ${formatSecondaryMoney(Math.abs(owed), fxRate)}`
                : ""}
            </Typography>
          </Box>

          <Stack
            direction="row"
            spacing={1.5}
            useFlexGap
            sx={{ flexWrap: "wrap" }}
          >
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => void downloadPdf()}
              disabled={pdfBusy}
            >
              {pdfBusy ? "Preparing..." : "Download PDF"}
            </Button>
            {canSend && (
              <Button
                variant="outlined"
                color="success"
                startIcon={<WhatsAppIcon />}
                onClick={() => setConfirmSend(true)}
                disabled={waBusy}
              >
                {waBusy ? "Sending..." : "Send on WhatsApp"}
              </Button>
            )}
            {canPay && owed > 0 && (
              <Button
                variant="contained"
                color="success"
                startIcon={<PaymentsIcon />}
                onClick={() => setPayOpen(true)}
              >
                Record payment
              </Button>
            )}
          </Stack>
        </Stack>
      </Paper>

      {error && !confirmSend && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert
          severity="success"
          sx={{ mb: 2 }}
          onClose={() => setSuccess(null)}
        >
          {success}
        </Alert>
      )}

      {!statement.ties && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          The documents listed here come to{" "}
          {formatMoney(statement.closingBalance)}, but the account carries{" "}
          {formatMoney(statement.accountBalance)}, a difference of{" "}
          {formatMoney(Math.abs(Number(statement.unreconciled)))}. That gap is
          balance brought over from the old system that no invoice on file
          explains. The account balance is what is owed; check it against the
          old records before sending this to the client.
        </Alert>
      )}

      <Stack
        direction={{ xs: "column", lg: "row" }}
        spacing={1.5}
        sx={{ mb: 2, alignItems: { lg: "center" } }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          onChange={(_, next: View | null) => next && setView(next)}
        >
          <ToggleButton value="summary" sx={{ textTransform: "none" }}>
            Summary
          </ToggleButton>
          <ToggleButton value="detailed" sx={{ textTransform: "none" }}>
            Detailed
          </ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flexGrow: 1 }}>
          <DateRangeControl
            range={range}
            onChange={changeRange}
            disabled={pending}
          />
        </Box>
        <Button
          variant="text"
          onClick={showFullHistory}
          disabled={pending}
          sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
        >
          Full history
        </Button>
      </Stack>
      {pending && <LinearProgress sx={{ mb: 2 }} />}

      <Box
        sx={{
          display: "grid",
          gap: 2,
          mb: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            md: "repeat(4, 1fr)",
          },
        }}
      >
        <Figure
          label="Brought forward"
          value={formatMoney(statement.broughtForward)}
          hint={`Before ${formatDate(range.from)}`}
        />
        <Figure
          label="Invoiced"
          value={formatMoney(statement.invoiced)}
          hint={formatRangeLabel(range)}
        />
        <Figure
          label="Paid"
          value={formatMoney(statement.paid)}
          hint={formatRangeLabel(range)}
        />
        <Figure
          label="Balance"
          value={formatMoney(statement.accountBalance)}
          hint={`As at ${formatDate(statement.asAt)}`}
          accent
        />
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" sx={{ minWidth: 720 }}>
          <TableHead>
            <TableRow
              sx={{
                "& th": {
                  bgcolor: "background.default",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                },
              }}
            >
              <TableCell>Date</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Reference</TableCell>
              <TableCell>Details</TableCell>
              <TableCell align="right">Charges</TableCell>
              <TableCell align="right">Payments</TableCell>
              <TableCell align="right">Balance</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {/* Where the period starts from. Without it the first balance in
                the column looks like it came from nowhere. */}
            <TableRow
              sx={{ "& td": { bgcolor: "action.hover", fontWeight: 600 } }}
            >
              <TableCell>{formatDate(range.from)}</TableCell>
              <TableCell colSpan={5}>Balance brought forward</TableCell>
              <TableCell align="right" sx={NUM}>
                {formatMoney(statement.broughtForward)}
              </TableCell>
            </TableRow>

            {lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    Nothing was billed or paid in this period.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              lines.map((line, i) => (
                <LedgerRow
                  key={`${line.kind}-${line.reference}-${i}`}
                  line={line}
                  detailed={detailed}
                  linkable={canOpenInvoices}
                />
              ))
            )}

            <TableRow
              sx={{
                "& td": {
                  borderTop: 2,
                  borderTopColor: "divider",
                  fontWeight: 600,
                },
              }}
            >
              <TableCell colSpan={4}>Movement over the period</TableCell>
              <TableCell align="right" sx={NUM}>
                {formatMoney(statement.invoiced)}
              </TableCell>
              <TableCell align="right" sx={NUM}>
                {formatMoney(statement.paid)}
              </TableCell>
              <TableCell align="right" sx={NUM}>
                {formatMoney(statement.closingBalance)}
              </TableCell>
            </TableRow>

            {/* Stated separately from the running total, and only when the two
                disagree, so a figure the documents do not explain is never
                folded silently into one that reads as derived. */}
            {!statement.ties && (
              <TableRow>
                <TableCell colSpan={6}>
                  Adjustment carried from our previous records
                </TableCell>
                <TableCell align="right" sx={NUM}>
                  {formatMoney(-Number(statement.unreconciled))}
                </TableCell>
              </TableRow>
            )}

            <TableRow
              sx={{
                "& td": {
                  bgcolor: "action.hover",
                  fontWeight: 700,
                  fontSize: "0.95rem",
                },
              }}
            >
              <TableCell colSpan={6}>
                {owed < 0 ? "Balance in credit" : "Balance due"}
              </TableCell>
              <TableCell align="right" sx={NUM}>
                {formatMoney(statement.accountBalance)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 1.5 }}
      >
        {statement.clinicName} · Generated{" "}
        {formatDateTime(statement.generatedAt)} · All amounts in{" "}
        {statement.currency}
        {statement.openingEntry
          ? `. Opening balance of ${formatMoney(statement.openingEntry.amount)} as at ${formatDate(statement.openingEntry.asOfDate)} is already included in the balance, never added to it.`
          : "."}
      </Typography>

      <AccountPaymentDialog
        open={payOpen}
        clientId={statement.clientId}
        clientName={statement.clientName}
        balance={String(owed)}
        fxRate={fxRate}
        onClose={() => setPayOpen(false)}
        onSaved={() => router.refresh()}
      />

      {/* Sending an account history off the premises is worth one deliberate
          step, and the confirmation is where the client's number is checked. */}
      <Dialog open={confirmSend} onClose={() => setConfirmSend(false)}>
        <DialogTitle>Send statement?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The {detailed ? "detailed" : "summary"} statement for{" "}
            {formatRangeLabel(range)} will be sent to {statement.clientName}
            {statement.clientPhone ? ` on ${statement.clientPhone}` : ""} as a
            PDF over WhatsApp.
          </DialogContentText>
          {!statement.clientPhone && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              This client has no phone number on file.
            </Alert>
          )}
          {/* Kept inside the dialog: an alert behind the backdrop is one the
              person who just pressed Send cannot read. */}
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSend(false)} disabled={waBusy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="success"
            onClick={() => void sendWhatsApp()}
            disabled={waBusy || !statement.clientPhone}
          >
            {waBusy ? "Sending..." : "Send"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ---- Pieces ----

function Figure({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        height: "100%",
        ...(accent
          ? { borderColor: "secondary.main", borderLeftWidth: 3 }
          : {}),
      }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        sx={{ display: "block" }}
      >
        {label}
      </Typography>
      <Typography variant="h5" sx={{ ...NUM, fontWeight: 700, mt: 0.5 }}>
        {value}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        sx={{ display: "block", mt: 0.5 }}
      >
        {hint}
      </Typography>
    </Paper>
  );
}

const TYPE_LABEL: Record<ClientStatementLineDTO["kind"], string> = {
  opening: "Opening",
  invoice: "Invoice",
  payment: "Payment",
};

function LedgerRow({
  line,
  detailed,
  linkable,
}: {
  line: ClientStatementLineDTO;
  detailed: boolean;
  linkable: boolean;
}) {
  const showItems = detailed && line.items.length > 0;

  return (
    <>
      <TableRow
        hover
        sx={{
          // The item rows belong to the invoice above them, so the invoice keeps
          // its bottom rule only when nothing is hanging off it.
          ...(showItems ? { "& td": { borderBottom: "none" } } : {}),
        }}
      >
        <TableCell sx={{ whiteSpace: "nowrap" }}>
          {formatDate(line.date)}
        </TableCell>
        <TableCell>
          <Chip
            size="small"
            variant="outlined"
            label={TYPE_LABEL[line.kind]}
            color={line.kind === "payment" ? "success" : "default"}
          />
        </TableCell>
        <TableCell sx={{ whiteSpace: "nowrap", fontWeight: 500 }}>
          {line.href && linkable ? (
            <Link href={line.href}>{line.reference}</Link>
          ) : (
            line.reference
          )}
        </TableCell>
        <TableCell>
          <Typography variant="body2" component="span">
            {line.description}
          </Typography>
          {line.method && (
            <Typography variant="body2" component="span" color="text.secondary">
              {" · "}
              {line.method}
            </Typography>
          )}
          {line.appliedTo && (
            <Typography variant="body2" component="span" color="text.secondary">
              {" · against "}
              {line.appliedTo}
            </Typography>
          )}
        </TableCell>
        {/* A row prints on its own side of the ledger and stays blank on the
            other, zero total or not: a charge of nothing is a fact about the
            document, while "$0.00" under Payments is just a column of noise. */}
        <TableCell align="right" sx={NUM}>
          {line.kind === "payment" ? "" : formatMoney(line.charge)}
        </TableCell>
        <TableCell align="right" sx={{ ...NUM, color: "success.main" }}>
          {line.kind === "payment" ? formatMoney(line.payment) : ""}
        </TableCell>
        <TableCell align="right" sx={{ ...NUM, fontWeight: 600 }}>
          {formatMoney(line.balance)}
        </TableCell>
      </TableRow>

      {/* What was actually bought, indented under its invoice. Kept inside the
          same table so the money columns stay in line down the page, which is
          the whole reason a statement is read as a column rather than a list. */}
      {showItems &&
        line.items.map((item, i) => (
          <TableRow key={`${line.reference}-item-${i}`}>
            <TableCell sx={{ borderBottom: "none" }} />
            <TableCell sx={{ borderBottom: "none" }} />
            <TableCell
              colSpan={2}
              sx={{
                borderBottom: i === line.items.length - 1 ? undefined : "none",
                pl: 2,
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ borderLeft: 2, borderColor: "divider", pl: 1.5 }}
              >
                {item.description}
              </Typography>
            </TableCell>
            <TableCell
              align="right"
              sx={{
                ...NUM,
                borderBottom: i === line.items.length - 1 ? undefined : "none",
                color: "text.secondary",
                whiteSpace: "nowrap",
              }}
            >
              {item.looseLabel ?? trimQty(item.quantity)} ×{" "}
              {formatMoney(item.unitPrice)}
            </TableCell>
            <TableCell
              sx={{
                borderBottom: i === line.items.length - 1 ? undefined : "none",
              }}
            />
            <TableCell
              align="right"
              sx={{
                ...NUM,
                borderBottom: i === line.items.length - 1 ? undefined : "none",
                color: "text.secondary",
              }}
            >
              {formatMoney(item.lineTotal)}
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}

// Quantities are stored to three decimals for loose selling, but almost every
// line is a whole number of packs and "4.000 x $3.00" reads like a rounding bug.
function trimQty(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}
