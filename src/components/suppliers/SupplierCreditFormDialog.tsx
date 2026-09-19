"use client";

import { useMemo, useState } from "react";
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
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import AddIcon from "@mui/icons-material/Add";
import { apiRequest } from "@/utils/api-client";
import { formatMoney, toDateOnly } from "@/utils/format";
import { payableOrderLabel } from "@/utils/payable-order";
import type {
  PayableOrderOption,
  SupplierDTO,
  SupplierPaymentDTO,
} from "@/types/entities";

interface Props {
  open: boolean;
  supplierId: number;
  supplierName: string;
  balance: string;
  /**
   * Received orders with something left to pay. An open order has no bill to
   * credit against yet, and a settled one is not offered again.
   */
  payableOrders: PayableOrderOption[];
  onClose: () => void;
  onSaved: (
    supplier: SupplierDTO | null,
    payments: SupplierPaymentDTO[],
  ) => void;
}

export default function SupplierCreditFormDialog({
  open,
  onClose,
  ...rest
}: Props) {
  // Remount per open so the allocations start empty rather than carrying the
  // last note's split into a new one.
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {open && <CreditForm onClose={onClose} {...rest} />}
    </Dialog>
  );
}

type FormProps = Omit<Props, "open">;

interface Allocation {
  // Local row id. The order can be blank (against the account) and two rows can
  // briefly hold the same order while being typed, so neither is a usable key.
  id: number;
  orderId: string;
  amount: string;
}

// Records a credit note and decides where it goes. The clinic is handed one
// document for a lump sum and spends it across the account at the counter: some
// against a named bill, whatever is left against another or against the account
// itself.
//
// The allocations have to add up to the note. Deriving the total from them
// instead would let a mis-keyed line quietly redefine what the supplier gave,
// so the two are entered separately and reconciled on screen before saving.
function CreditForm({
  supplierId,
  supplierName,
  balance,
  payableOrders,
  onClose,
  onSaved,
}: FormProps) {
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(() => toDateOnly(new Date()) ?? "");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Allocation[]>([
    { id: 1, orderId: "", amount: "" },
  ]);
  const [nextId, setNextId] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const total = Number(amount) || 0;
  const allocated = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const remaining = total - allocated;
  const balanced = Math.abs(remaining) < 0.005;

  const duplicateOrder = useMemo(() => {
    const named = rows.map((r) => r.orderId).filter((id) => id !== "");
    return new Set(named).size !== named.length;
  }, [rows]);

  function update(id: number, patch: Partial<Allocation>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        // Picking a bill fills that row with whatever is still unallocated, or
        // what is still owed on the order, whichever is smaller: crediting more
        // against a bill than is left on it is the mistake this is here to
        // avoid.
        if (patch.orderId !== undefined && patch.orderId !== "") {
          const picked = payableOrders.find(
            (o) => String(o.orderId) === patch.orderId,
          );
          if (picked && next.amount === "") {
            const others = prev
              .filter((o) => o.id !== id)
              .reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
            const left = Math.max(total - others, 0);
            next.amount = String(
              Math.min(Number(picked.outstanding), left) || "",
            );
          }
        }
        return next;
      }),
    );
  }

  function addRow() {
    // A new row starts with whatever is still unallocated, since the usual
    // reason to add one is to place the remainder.
    setRows((prev) => [
      ...prev,
      {
        id: nextId,
        orderId: "",
        amount: remaining > 0 ? String(Math.round(remaining * 100) / 100) : "",
      },
    ]);
    setNextId((n) => n + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!(total > 0)) {
      setError("Enter what the credit note is for.");
      return;
    }
    if (!balanced) {
      setError(
        remaining > 0
          ? `${formatMoney(remaining)} of this credit note has nowhere to go. Put it against another bill or the account.`
          : `The allocations come to ${formatMoney(allocated)}, which is more than the note.`,
      );
      return;
    }
    setSaving(true);
    try {
      const res = await apiRequest<{
        supplier: SupplierDTO | null;
        payments: SupplierPaymentDTO[];
      }>(`/api/suppliers/${supplierId}/credits`, {
        method: "POST",
        body: {
          amount,
          paidOn,
          reference,
          notes,
          allocations: rows.map((r) => ({
            orderId: r.orderId,
            amount: r.amount,
          })),
        },
      });
      onSaved(res.supplier, res.payments);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogTitle>Record a credit from {supplierName}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Currently owed: <strong>{formatMoney(balance)}</strong>. A credit note
          reduces what you owe without any money leaving the clinic, so it is
          reported separately from what you have paid.
        </DialogContentText>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Credit note total"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
              required
              fullWidth
              autoFocus
            />
            <TextField
              label="Dated"
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              required
              fullWidth
            />
          </Stack>
          <TextField
            label="Credit note number"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="The supplier's document number"
            helperText="Repeated on every part of the note, which is what ties them together on the statement"
            fullWidth
          />

          <Box>
            <Stack
              direction="row"
              sx={{ alignItems: "center", justifyContent: "space-between" }}
            >
              <Typography sx={{ fontWeight: 600 }}>Where it goes</Typography>
              {/* Only once there is a note to allocate. On an untouched form
                  nothing is allocated and nothing is left over, which is
                  arithmetically balanced and would read as "Fully allocated"
                  before anything has been entered. */}
              {total > 0 && (
                <Chip
                  size="small"
                  color={balanced ? "success" : "warning"}
                  variant="outlined"
                  label={
                    balanced
                      ? "Fully allocated"
                      : remaining > 0
                        ? `${formatMoney(remaining)} left to place`
                        : `${formatMoney(-remaining)} over`
                  }
                />
              )}
            </Stack>
            <Stack spacing={1.5} sx={{ mt: 1.5 }}>
              {rows.map((row) => (
                <Stack key={row.id} direction="row" spacing={1}>
                  <TextField
                    select
                    size="small"
                    label="Against"
                    value={row.orderId}
                    onChange={(e) =>
                      update(row.id, { orderId: e.target.value })
                    }
                    sx={{ flex: 1 }}
                  >
                    <MenuItem value="">The account</MenuItem>
                    {payableOrders.map((o) => (
                      <MenuItem key={o.orderId} value={String(o.orderId)}>
                        {payableOrderLabel(o)}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    label="Amount"
                    type="number"
                    value={row.amount}
                    onChange={(e) => update(row.id, { amount: e.target.value })}
                    slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
                    sx={{ width: 130 }}
                  />
                  <IconButton
                    aria-label="Remove this allocation"
                    onClick={() =>
                      setRows((prev) => prev.filter((r) => r.id !== row.id))
                    }
                    disabled={rows.length === 1}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={addRow}
              sx={{ mt: 1 }}
            >
              Split further
            </Button>
            {duplicateOrder && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                The same bill appears on two lines. Combine those into one.
              </Alert>
            )}
          </Box>

          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What the credit was for"
            multiline
            minRows={2}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={saving || duplicateOrder}
        >
          {saving ? "Saving…" : "Record credit"}
        </Button>
      </DialogActions>
    </form>
  );
}
