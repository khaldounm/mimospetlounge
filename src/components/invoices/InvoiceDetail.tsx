"use client";

import { useMemo, useState } from "react";
import Link from "@/components/ui/AppLink";
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
  Divider,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import PaymentsIcon from "@mui/icons-material/Payments";
import DownloadIcon from "@mui/icons-material/Download";
import PrintIcon from "@mui/icons-material/Print";
// import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import BlockIcon from "@mui/icons-material/Block";
import MedicalServicesIcon from "@mui/icons-material/MedicalServices";
import RefreshIcon from "@mui/icons-material/Refresh";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import { apiRequest } from "@/utils/api-client";
import {
  formatAccountBalance,
  formatDate,
  formatDateTime,
  formatMoney,
  formatSecondaryMoney,
} from "@/utils/format";
import { printInvoiceReceipt } from "@/utils/print-receipt";
// import { downloadReceiptImage } from "@/utils/receipt-image";
import { INVOICE_STATUS_COLOR } from "@/constants/invoice";
import { CLINIC_USE_COST_CATEGORY } from "@/constants/running-cost";
import { SECONDARY_CURRENCY } from "@/constants/clinic";
import type { InvoiceDTO } from "@/types/entities";
import InvoiceFormDialog from "./InvoiceFormDialog";
import LineItemDialog, {
  type ItemLineOption,
  type ServiceLineOption,
} from "./LineItemDialog";
import LineItemRow, {
  LINE_ITEM_CELL_SX,
  LINE_ITEM_TABLE_MIN_WIDTH,
  lineItemColumnWidths,
} from "./LineItemRow";
import PaymentDialog from "./PaymentDialog";
import InvoiceOfferBanner from "@/components/offers/InvoiceOfferBanner";
import ReturnDialog from "./ReturnDialog";
import ScanBar from "./ScanBar";

interface Props {
  invoice: InvoiceDTO;
  serviceOptions: ServiceLineOption[];
  itemOptions: ItemLineOption[];
  canWrite: boolean;
  canPay: boolean;
  // Whether this user may see, and set, who performed a service line. Admin
  // only, the same gate as the rest of a partner's deal.
  canSeeDeal: boolean;
  // LBP per 1 USD. The invoice's own frozen rate once issued, the current
  // clinic setting while it is still a draft.
  fxRate: number;
}

// How the discount is described depends on how it was typed. A flat discount
// shown as a percentage reads as a rounding error, and the reverse hides which
// figure was actually agreed at the counter.
function discountLabel(invoice: InvoiceDTO): string {
  return Number(invoice.discountAmount) > 0
    ? "Discount"
    : `Discount (${invoice.discountPct}%)`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between" }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography>{value}</Typography>
    </Stack>
  );
}

export default function InvoiceDetail({
  invoice: initialInvoice,
  serviceOptions,
  itemOptions,
  canWrite,
  canPay,
  canSeeDeal,
  fxRate,
}: Props) {
  const [invoice, setInvoice] = useState(initialInvoice);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [editInvoiceOpen, setEditInvoiceOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [waBusy, setWaBusy] = useState(false);

  const isDraft = invoice.status === "Draft";
  // Issuing does not clear vetHoldAt, so the raw column stays set on an invoice
  // that was issued over a hold. Gating on the status is what stops the banner
  // living on an issued invoice that nobody can clear it from: the hold route
  // refuses anything that is no longer a draft.
  const onVetHold = isDraft && invoice.vetHoldAt != null;
  const adjustment = Number(invoice.adjustment);
  // Consumed in the clinic, not sold. They sit in the same table as everything
  // else, flagged on the row, so one list is the whole of what happened at the
  // counter; what keeps them off the bill is isHidden, not where they are shown.
  const hasHiddenLines = invoice.lineItems.some((l) => l.isHidden);
  // Lines are only editable while the invoice is still a draft.
  const canEditLines = canWrite && isDraft;
  // Keyed for the row editor, which needs the item's loose setup to know
  // whether the amount is typed in packs or by the kilo.
  const itemById = useMemo(
    () => new Map(itemOptions.map((o) => [o.itemId, o])),
    [itemOptions],
  );
  const cols = lineItemColumnWidths(canEditLines);
  // The client's whole-account balance, which spans every invoice they have and
  // not just this one. It rides on the invoice DTO now, because the printed
  // copies and the WhatsApp message need it too.
  const accountSummary =
    invoice.clientBalance != null
      ? formatAccountBalance(invoice.clientBalance)
      : null;
  const paid = Number(invoice.amountPaid) > 0;
  const balanceDue = Number(invoice.balance);

  const canIssue = canWrite && isDraft && invoice.lineItems.length > 0;
  const canVoid =
    canWrite &&
    !paid &&
    (invoice.status === "Draft" || invoice.status === "Issued");
  // Not `> 0`: a return that has not been refunded yet has a NEGATIVE balance,
  // and that is exactly the document the counter needs to settle by handing
  // cash back. Zero is settled in either direction.
  const canRecordPayment =
    canPay &&
    (invoice.status === "Issued" || invoice.status === "Partial") &&
    balanceDue !== 0;

  function applyInvoice(next: InvoiceDTO) {
    setInvoice(next);
  }

  // Generate a clean, standalone invoice PDF and download it. The PDF renderer
  // is loaded on demand so it stays out of the initial page bundle.
  async function downloadPdf() {
    setPdfBusy(true);
    setError(null);
    try {
      const [{ pdf }, { default: InvoicePdfDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./InvoicePdfDocument"),
      ]);
      const blob = await pdf(<InvoicePdfDocument invoice={invoice} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoice.number}.pdf`;
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

  // Tiny Print: the pocket printer it fed is retired now that the counter has a
  // roll printer, so the CTA is hidden rather than removed. downloadReceiptImage
  // and receipt-image.ts are untouched and still work if it is ever wanted back.
  // async function saveReceipt() {
  //   setError(null);
  //   try {
  //     await downloadReceiptImage(invoice);
  //   } catch (err) {
  //     setError(
  //       err instanceof Error ? err.message : "Could not save the receipt",
  //     );
  //   }
  // }

  async function sendWhatsApp() {
    setError(null);
    setSuccess(null);
    setWaBusy(true);
    try {
      await apiRequest(`/api/invoices/${invoice.invoiceId}/whatsapp`, {
        method: "POST",
      });
      setSuccess("Invoice PDF sent via WhatsApp.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send via WhatsApp",
      );
    } finally {
      setWaBusy(false);
    }
  }

  async function transition(
    status: "Issued" | "Void",
    overrideVetHold = false,
  ) {
    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest<{ invoice: InvoiceDTO }>(
        `/api/invoices/${invoice.invoiceId}`,
        { method: "PATCH", body: { status, overrideVetHold } },
      );
      applyInvoice(data.invoice);
      setConfirmIssue(false);
      setConfirmVoid(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  // The hold is what reception sees before they close a sale the vet has not
  // finished adding to.
  async function setVetHold(hold: boolean) {
    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest<{ invoice: InvoiceDTO }>(
        `/api/invoices/${invoice.invoiceId}/vet-hold`,
        { method: "POST", body: { hold } },
      );
      applyInvoice(data.invoice);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not change the hold",
      );
    } finally {
      setBusy(false);
    }
  }

  // The counter's page is a snapshot from whenever it loaded, and nothing
  // pushes a hold set or released on another terminal. Every mutation already
  // returns the whole invoice, so the view self-heals as soon as the till does
  // anything; this is for the two moments where it has done nothing and the
  // answer still matters: waiting on the vet, and issuing.
  async function refreshInvoice(): Promise<InvoiceDTO | null> {
    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest<{ invoice: InvoiceDTO }>(
        `/api/invoices/${invoice.invoiceId}`,
      );
      applyInvoice(data.invoice);
      return data.invoice;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh");
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Re-read before the confirm dialog opens so the override is decided against
  // the hold as it stands now. Without this the dialog can offer "Issue anyway"
  // for a hold the vet already released, and the override would be recorded
  // against the cashier for a hold that was no longer there.
  async function openIssueConfirm() {
    await refreshInvoice();
    setConfirmIssue(true);
  }

  async function deleteLine(lineItemId: number) {
    setError(null);
    try {
      const data = await apiRequest<{ invoice: InvoiceDTO }>(
        `/api/invoices/${invoice.invoiceId}/line-items/${lineItemId}`,
        { method: "DELETE" },
      );
      applyInvoice(data.invoice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove line");
    }
  }

  return (
    <Box>
      <Stack
        direction="row"
        sx={{
          justifyContent: "space-between",
          alignItems: "flex-start",
          mb: 2,
          flexWrap: "wrap",
          gap: 1,
        }}
      >
        <Box>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography variant="h4">{invoice.number}</Typography>
            <Chip
              color={INVOICE_STATUS_COLOR[invoice.status]}
              label={invoice.status}
            />
            {invoice.isOverdue && <Chip color="error" label="Overdue" />}
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography color="text.secondary">
              Client:{" "}
              {invoice.clientId != null ? (
                <Link href={`/clients/${invoice.clientId}`}>
                  {invoice.clientName}
                </Link>
              ) : (
                invoice.clientName
              )}
            </Typography>
            {/* Whole-account balance, which is not the same number as this
                invoice's balance: it spans every invoice the client has. */}
            {accountSummary && (
              <Tooltip title="Across the client's whole account, not just this invoice">
                <Chip
                  size="small"
                  variant="outlined"
                  color={accountSummary.owes ? "warning" : "default"}
                  label={accountSummary.text}
                />
              </Tooltip>
            )}
          </Stack>
          {invoice.issuedAt && (
            <Typography variant="body2" color="text.secondary">
              Issued {formatDateTime(invoice.issuedAt)}
            </Typography>
          )}
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
            {pdfBusy ? "Preparing…" : "Download PDF"}
          </Button>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={() => printInvoiceReceipt(invoice)}
          >
            Print invoice
          </Button>
          {/* <Button
            variant="outlined"
            startIcon={<ReceiptLongIcon />}
            onClick={() => void saveReceipt()}
          >
            Tiny Print
          </Button> */}
          <Button
            variant="outlined"
            color="success"
            startIcon={<WhatsAppIcon />}
            onClick={() => void sendWhatsApp()}
            disabled={waBusy}
          >
            {waBusy ? "Sending…" : "Send via WhatsApp"}
          </Button>
          {canWrite && isDraft && (
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={() => setEditInvoiceOpen(true)}
            >
              Edit
            </Button>
          )}
          {canWrite && isDraft && !onVetHold && (
            <Button
              variant="outlined"
              color="warning"
              startIcon={<MedicalServicesIcon />}
              onClick={() => void setVetHold(true)}
              disabled={busy}
            >
              Hold for vet
            </Button>
          )}
          {canIssue && (
            <Button
              variant="contained"
              color={onVetHold ? "warning" : "primary"}
              onClick={() => void openIssueConfirm()}
              disabled={busy}
            >
              {onVetHold ? "Issue anyway" : "Issue"}
            </Button>
          )}
          {canRecordPayment && (
            <Button
              variant="contained"
              color={balanceDue < 0 ? "warning" : "success"}
              startIcon={<PaymentsIcon />}
              onClick={() => setPaymentOpen(true)}
            >
              {balanceDue < 0 ? "Refund" : "Record payment"}
            </Button>
          )}
          {canVoid && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<BlockIcon />}
              onClick={() => setConfirmVoid(true)}
            >
              Void
            </Button>
          )}
        </Stack>
      </Stack>

      {onVetHold && (
        <Alert
          severity="warning"
          icon={<MedicalServicesIcon />}
          sx={{ mb: 2 }}
          action={
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", flexShrink: 0, whiteSpace: "nowrap" }}
            >
              {/* For the till waiting on the vet. The hold is released on the
                  vet's own screen, and nothing tells this page about it, so
                  the counter needs a way to ask without losing the page. */}
              <Button
                color="inherit"
                size="small"
                startIcon={<RefreshIcon />}
                onClick={() => void refreshInvoice()}
                disabled={busy}
              >
                {busy ? "Checking…" : "Check again"}
              </Button>
              {canWrite && (
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => void setVetHold(false)}
                  disabled={busy}
                >
                  Done, release it
                </Button>
              )}
            </Stack>
          }
        >
          {invoice.attendingVetName
            ? `${invoice.attendingVetName} is still working on this invoice`
            : "A vet is still working on this invoice"}
          {invoice.vetHoldAt
            ? ` (since ${formatDateTime(invoice.vetHoldAt)})`
            : ""}
          . More lines may still be coming.
        </Alert>
      )}

      {/* A walk-in belongs to no account, so there is nothing to hold an offer
          and nothing for this to say. */}
      {invoice.clientId != null && (
        <InvoiceOfferBanner
          invoice={invoice}
          canWrite={canWrite}
          onApplied={applyInvoice}
        />
      )}

      {invoice.isWalkIn && !isDraft && balanceDue > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          This is a walk-in with {formatMoney(invoice.balance)} outstanding.
          There is no account behind it, so nobody can be billed or chased for
          this later.
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
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

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack
            direction="row"
            sx={{
              justifyContent: "space-between",
              alignItems: "center",
              mb: 1,
            }}
          >
            <Typography variant="h6">Line items</Typography>
            {canWrite && isDraft && (
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => setAddLineOpen(true)}
                >
                  Add service or manual line
                </Button>
                {/* A return goes on the same document as whatever the customer
                    is taking instead, because that is one transaction at the
                    counter. */}
                <Button
                  size="small"
                  color="warning"
                  startIcon={<AssignmentReturnIcon />}
                  onClick={() => setReturnOpen(true)}
                >
                  Take a return
                </Button>
              </Stack>
            )}
          </Stack>
          {/* Scanning is the primary way lines get onto a draft, and the same
              field finds a service or an unbarcoded item by name. The dialog
              above is for a manual line, a price override or clinic use. */}
          {canWrite && isDraft && (
            <ScanBar
              invoiceId={invoice.invoiceId}
              itemOptions={itemOptions}
              serviceOptions={serviceOptions}
              onInvoiceUpdated={applyInvoice}
            />
          )}
          <TableContainer component={Paper}>
            {/* Fixed layout: the columns keep their proportions whatever a
                product is called, so the numbers stay in a straight line down
                the page and a long name wraps rather than shoving them. */}
            <Table
              size="small"
              sx={{
                tableLayout: "fixed",
                minWidth: LINE_ITEM_TABLE_MIN_WIDTH,
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell
                    sx={{ ...LINE_ITEM_CELL_SX, width: cols.description }}
                  >
                    Description
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ ...LINE_ITEM_CELL_SX, width: cols.quantity }}
                  >
                    Qty
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ ...LINE_ITEM_CELL_SX, width: cols.unitPrice }}
                  >
                    Unit price
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ ...LINE_ITEM_CELL_SX, width: cols.total }}
                  >
                    Total
                  </TableCell>
                  {canEditLines && (
                    <TableCell
                      align="right"
                      sx={{ ...LINE_ITEM_CELL_SX, width: cols.controls }}
                    />
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {invoice.lineItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canEditLines ? 5 : 4} align="center">
                      <Typography color="text.secondary" sx={{ py: 2 }}>
                        No line items yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  /* Editing happens in the row itself. A price correction at a
                     busy counter is a click and a number, not a dialog. */
                  invoice.lineItems.map((l) => {
                    const item =
                      l.itemId != null ? itemById.get(l.itemId) : undefined;
                    return (
                      <LineItemRow
                        key={l.lineItemId}
                        invoiceId={invoice.invoiceId}
                        line={l}
                        item={item}
                        // Only worth saying on a draft. Stock comes off the
                        // shelf at issue, so on an issued invoice every line
                        // that emptied a shelf would light up for a sale that
                        // already went through. A return line is putting stock
                        // back, so it is not selling anything it does not have.
                        outOfStock={
                          isDraft &&
                          item != null &&
                          item.currentStock <= 0 &&
                          Number(l.quantity) > 0
                        }
                        editable={canEditLines}
                        onSaved={applyInvoice}
                        onDelete={() => void deleteLine(l.lineItemId)}
                        onError={setError}
                      />
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {hasHiddenLines && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1, display: "block" }}
            >
              Lines marked <strong>Clinic use</strong> were consumed during the
              visit rather than sold. They stay off the printed invoice and out
              of the total; issuing takes them off the shelf and files what they
              cost as a running cost under {CLINIC_USE_COST_CATEGORY}.
            </Typography>
          )}

          <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>
            Payments
          </Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Method</TableCell>
                  <TableCell>Reference</TableCell>
                  <TableCell align="right">Tendered</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invoice.payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography color="text.secondary" sx={{ py: 2 }}>
                        No payments recorded.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  invoice.payments.map((p) => (
                    <TableRow key={p.paymentId} hover>
                      <TableCell>{formatDateTime(p.paidAt)}</TableCell>
                      <TableCell>{p.method ?? "-"}</TableCell>
                      <TableCell>{p.reference ?? "-"}</TableCell>
                      {/* What was physically handed over, in the currency it
                          came in. The Amount column is always its USD value,
                          which is what settled the invoice. */}
                      <TableCell align="right">
                        {p.currency === "USD"
                          ? formatMoney(p.amountOriginal)
                          : `${SECONDARY_CURRENCY.symbol} ${Number(
                              p.amountOriginal,
                            ).toLocaleString("en-US")}`}
                      </TableCell>
                      <TableCell align="right">
                        {formatMoney(p.amount)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack spacing={1}>
              <Row label="Subtotal" value={formatMoney(invoice.subtotal)} />
              <Row
                label={discountLabel(invoice)}
                value={`-${formatMoney(invoice.discountValue)}`}
              />
              <Row
                label={`Tax (${invoice.taxPct}%)`}
                value={formatMoney(invoice.taxAmount)}
              />
              {/* Only shown when there is one. A zero adjustment is the normal
                  case and a permanent "Adjustment $0.00" is just noise. */}
              {adjustment !== 0 && (
                <Row
                  label="Adjustment"
                  value={`${adjustment > 0 ? "+" : "-"}${formatMoney(
                    Math.abs(adjustment),
                  )}`}
                />
              )}
              <Divider />
              <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                <Typography variant="h6">Total</Typography>
                <Typography variant="h6">
                  {formatMoney(invoice.total)}
                </Typography>
              </Stack>
              {/* USD is the ledger currency; the lira figure is a reading of
                  it at the invoice's rate, never a stored total. */}
              <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
                <Typography variant="body2" color="text.secondary">
                  {formatSecondaryMoney(invoice.total, fxRate)}
                </Typography>
              </Stack>
              <Row label="Paid" value={formatMoney(invoice.amountPaid)} />
              <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                <Typography sx={{ fontWeight: "bold" }}>Balance</Typography>
                <Typography sx={{ fontWeight: "bold" }}>
                  {formatMoney(invoice.balance)}
                </Typography>
              </Stack>
              <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
                <Typography variant="body2" color="text.secondary">
                  {formatSecondaryMoney(invoice.balance, fxRate)}
                </Typography>
              </Stack>
              <Row
                label="Rate used"
                value={`${fxRate.toLocaleString("en-US")} / $1`}
              />
              {invoice.dueDate && (
                <Row label="Due date" value={formatDate(invoice.dueDate)} />
              )}
              {invoice.notes && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Notes
                  </Typography>
                  <Typography variant="body2">{invoice.notes}</Typography>
                </Box>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <LineItemDialog
        open={addLineOpen}
        invoiceId={invoice.invoiceId}
        serviceOptions={serviceOptions}
        itemOptions={itemOptions}
        canSeeDeal={canSeeDeal}
        onClose={() => setAddLineOpen(false)}
        onSaved={applyInvoice}
      />
      <InvoiceFormDialog
        open={editInvoiceOpen}
        invoice={invoice}
        onClose={() => setEditInvoiceOpen(false)}
        onSaved={applyInvoice}
      />
      <ReturnDialog
        open={returnOpen}
        invoiceId={invoice.invoiceId}
        clientId={invoice.clientId}
        onClose={() => setReturnOpen(false)}
        onSaved={applyInvoice}
      />
      <PaymentDialog
        open={paymentOpen}
        invoiceId={invoice.invoiceId}
        balance={invoice.balance}
        accountBalance={invoice.clientBalance}
        fxRate={fxRate}
        onClose={() => setPaymentOpen(false)}
        onSaved={applyInvoice}
      />

      <Dialog open={confirmIssue} onClose={() => setConfirmIssue(false)}>
        <DialogTitle>Issue this invoice?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Issuing freezes the totals and line items. Items sold come off the
            shelf and anything being returned goes back on it, except lines
            marked write-off. This cannot be undone except by voiding.
          </DialogContentText>
          {onVetHold && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {invoice.attendingVetName ?? "A vet"} still has this invoice on
              hold. Issuing now goes over that, and the override is recorded.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmIssue(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void transition("Issued", onVetHold)}
            disabled={busy}
            color={onVetHold ? "warning" : "primary"}
          >
            {busy ? "Issuing…" : onVetHold ? "Issue anyway" : "Issue"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmVoid} onClose={() => setConfirmVoid(false)}>
        <DialogTitle>Void this invoice?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Voiding cancels the invoice. If it was issued, any sold stock is
            returned to inventory. Invoices with payments cannot be voided.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmVoid(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            color="error"
            onClick={() => void transition("Void")}
            disabled={busy}
          >
            {busy ? "Voiding…" : "Void"}
          </Button>
        </DialogActions>
      </Dialog>

      <Divider sx={{ mt: 4 }} />
    </Box>
  );
}
