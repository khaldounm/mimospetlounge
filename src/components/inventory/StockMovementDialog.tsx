"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { apiRequest } from "@/utils/api-client";
import { announceInventoryChange } from "@/hooks/useInventoryChanges";
import {
  MANUAL_TX_TYPES,
  SIGNED_TX_TYPES,
  type InventoryTxType,
} from "@/types/enums";

interface Props {
  open: boolean;
  itemId: number;
  itemName: string;
  unit: string | null;
  /** orders:read. Gates the unit cost, which writes the item's last cost. */
  canSeeCost: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const HELP: Record<InventoryTxType, string> = {
  Received: "Adds stock.",
  Used: "Removes stock (e.g. used in a procedure).",
  Sold: "Removes stock sold to a client.",
  Adjusted: "Correction after a count. Use a negative number to reduce stock.",
  Expired: "Removes stock that has expired or is no longer sellable.",
  Damaged: "Raised from a return that came back unfit to sell.",
  Returned:
    "Raised from the invoice a customer is bringing goods back against.",
  ReturnedToSupplier:
    "Raised from the purchase order the goods are going back on.",
  Opening:
    "The stock this item was carried into the system with. Written once by " +
    "the import and never raised by hand.",
};

export default function StockMovementDialog({ open, onClose, ...rest }: Props) {
  // Remount the form (via key) each time the dialog opens instead of resetting
  // state with an effect. State starts from its defaults on mount.
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      {open && (
        <StockMovementForm key={rest.itemId} onClose={onClose} {...rest} />
      )}
    </Dialog>
  );
}

type FormProps = Omit<Props, "open">;

function StockMovementForm({
  itemId,
  itemName,
  unit,
  canSeeCost,
  onClose,
  onSaved,
}: FormProps) {
  const [type, setType] = useState<InventoryTxType>("Received");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Cost follows the same orders:read gate as the rest of the app, and the
  // server strips it either way. Someone without it books the delivery in and
  // the item keeps whatever it was last bought at.
  const isReceived = type === "Received";
  const askCost = isReceived && canSeeCost;
  // Only a signed type may be given a negative quantity; the rest take a
  // magnitude and get their direction from the type.
  const isSigned = SIGNED_TX_TYPES.includes(type);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiRequest(`/api/inventory/${itemId}/transactions`, {
        method: "POST",
        body: {
          type,
          quantity,
          unitCost: askCost ? unitCost : "",
          notes,
        },
      });
      // The order page shows this item's stock on its line.
      announceInventoryChange(itemId);
      onSaved();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to record movement",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogTitle>Record stock movement</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Item"
            value={itemName}
            slotProps={{ input: { readOnly: true } }}
            fullWidth
          />
          <TextField
            select
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as InventoryTxType)}
            helperText={
              isReceived && canSeeCost
                ? `${HELP[type]} Unit cost updates the item's last cost.`
                : HELP[type]
            }
            fullWidth
          >
            {MANUAL_TX_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={`Quantity${unit ? ` (${unit})` : ""}`}
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            slotProps={{
              htmlInput: isSigned
                ? { step: "0.01" }
                : { min: 0.01, step: "0.01" },
            }}
            required
            fullWidth
          />
          {askCost && (
            <TextField
              label="Unit cost"
              type="number"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
              required
              fullWidth
            />
          )}
          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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
        <Button type="submit" variant="contained" disabled={saving}>
          {saving ? "Saving…" : "Record"}
        </Button>
      </DialogActions>
    </form>
  );
}
