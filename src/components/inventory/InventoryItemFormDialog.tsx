"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  FormControlLabel,
  Switch,
  TextField,
  Tooltip,
} from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import QrCode2Icon from "@mui/icons-material/QrCode2";
// import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { apiRequest } from "@/utils/api-client";
import PayoutPreview from "@/components/ui/PayoutPreview";
import { INVENTORY_CATEGORIES } from "@/constants/inventory";
import { isValidEan13 } from "@/utils/barcode";
// import { downloadBarcodeLabelImage } from "@/utils/barcode-label";
import type {
  InventoryItemDTO,
  PartnerDTO,
  SupplierDTO,
} from "@/types/entities";
import SupplierFormDialog from "@/components/suppliers/SupplierFormDialog";
import BarcodeLabelDialog from "./BarcodeLabelDialog";

// Sentinel option that opens the inline "new supplier" dialog instead of
// selecting a value, so a missing supplier can be added without leaving the form.
const ADD_SUPPLIER = "__add__";

interface Props {
  open: boolean;
  item?: InventoryItemDTO | null;
  canViewSuppliers: boolean;
  /** Admin only. Gates the cost box, which the server gates again. */
  canSeeCost: boolean;
  canCreateSuppliers: boolean;
  // Pre-filled on a new item only, for a form opened from somewhere that
  // already knows part of the answer. Goods receipt is the case: the order says
  // which shelf and which supplier, so asking again would be asking twice.
  defaults?: { category?: string | null; supplierId?: number | null };
  // Whether the form offers to seed stock at creation. Off wherever the caller
  // is about to book a stock movement of its own: goods receipt puts the units
  // on the shelf when the delivery is received, and an opening stock typed here
  // as well would count the same carton twice.
  allowOpeningStock?: boolean;
  onClose: () => void;
  // The saved item comes back so a caller that needs it (goods receipt puts it
  // straight onto the order) does not have to go looking for what it just made.
  onSaved: (item: InventoryItemDTO) => void;
}

export default function InventoryItemFormDialog({
  open,
  onClose,
  ...rest
}: Props) {
  // Remount the form (via key) each time the dialog opens instead of syncing
  // props into state with an effect. State is initialized directly from props.
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {open && (
        <InventoryItemForm
          key={rest.item?.itemId ?? "new"}
          onClose={onClose}
          {...rest}
        />
      )}
    </Dialog>
  );
}

type FormProps = Omit<Props, "open">;

function InventoryItemForm({
  item,
  canViewSuppliers,
  canSeeCost,
  canCreateSuppliers,
  defaults,
  allowOpeningStock = true,
  onClose,
  onSaved,
}: FormProps) {
  const editing = Boolean(item);
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(
    item?.category ?? defaults?.category ?? "",
  );
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [barcode, setBarcode] = useState(item?.barcode ?? "");
  const [reorderLevel, setReorderLevel] = useState(
    item ? String(item.reorderLevel) : "0",
  );
  const [openingStock, setOpeningStock] = useState("");
  const [salePrice, setSalePrice] = useState(item?.salePrice ?? "");
  const [lastCost, setLastCost] = useState(item?.lastCost ?? "");
  const [partnerId, setPartnerId] = useState(
    item?.partnerId != null ? String(item.partnerId) : "",
  );
  const [partnerCostPct, setPartnerCostPct] = useState(
    item?.partnerCostPct ?? "",
  );
  const [partnerProfitPct, setPartnerProfitPct] = useState(
    item?.partnerProfitPct ?? "",
  );
  // Whether either rate was typed by hand. An existing per-item override counts
  // as hand-set so editing the item does not silently overwrite it. Until
  // touched, both rates track the picked partner's defaults.
  const [shareTouched, setShareTouched] = useState(
    (item?.partnerCostPct != null && item.partnerCostPct !== "") ||
      (item?.partnerProfitPct != null && item.partnerProfitPct !== ""),
  );
  const [partners, setPartners] = useState<PartnerDTO[]>([]);
  const [supplierId, setSupplierId] = useState(
    item?.supplierId != null
      ? String(item.supplierId)
      : defaults?.supplierId != null
        ? String(defaults.supplierId)
        : "",
  );
  const [suppliers, setSuppliers] = useState<SupplierDTO[]>([]);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [expiryDate, setExpiryDate] = useState(item?.expiryDate ?? "");
  // Loose selling. Switched on per item, so most of the catalogue never sees
  // these fields at all.
  const [tracksExpiry, setTracksExpiry] = useState(item?.tracksExpiry ?? false);
  const [sellsLoose, setSellsLoose] = useState(item?.looseUnit != null);
  const [looseUnit, setLooseUnit] = useState(item?.looseUnit ?? "");
  const [loosePerUnit, setLoosePerUnit] = useState(item?.loosePerUnit ?? "");
  const [loosePrice, setLoosePrice] = useState(item?.loosePrice ?? "");

  // What the pack price works out at per loose unit, shown so staff can see the
  // markup they are setting rather than guessing at it.
  const looseComparison = (() => {
    const price = Number(salePrice);
    const per = Number(loosePerUnit);
    if (!(price > 0) || !(per > 0)) return null;
    return `$${(price / per).toFixed(2)} per ${looseUnit || "unit"}`;
  })();
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);

  // Load active partners for the "sourced from" picker (consignment stock).
  useEffect(() => {
    let alive = true;
    apiRequest<{ partners: PartnerDTO[] }>("/api/partners?active=1")
      .then((data) => {
        if (alive) setPartners(data.partners);
      })
      .catch(() => {
        // Non-fatal: the picker just stays empty if partners cannot load.
      });
    return () => {
      alive = false;
    };
  }, []);

  // Load active suppliers for the "usual supplier" picker. Skipped entirely for
  // staff without purchasing access, who never see the field.
  useEffect(() => {
    if (!canViewSuppliers) return;
    let alive = true;
    apiRequest<{ suppliers: SupplierDTO[] }>("/api/suppliers?active=1")
      .then((data) => {
        if (alive) setSuppliers(data.suppliers);
      })
      .catch(() => {
        // Non-fatal: the picker just stays empty if suppliers cannot load.
      });
    return () => {
      alive = false;
    };
  }, [canViewSuppliers]);

  // Picking the sentinel opens the inline create dialog and leaves the current
  // selection alone, so cancelling out does not clear an existing supplier.
  function handleSupplierChange(value: string) {
    if (value === ADD_SUPPLIER) {
      setSupplierDialogOpen(true);
      return;
    }
    setSupplierId(value);
  }

  function handleSupplierCreated(supplier: SupplierDTO) {
    setSuppliers((prev) =>
      [...prev, supplier].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setSupplierId(String(supplier.supplierId));
  }

  // Track the picked partner's default share until the user overrides it, so
  // switching partners follows the newly-picked default (rather than keeping the
  // previous partner's). Clearing the partner resets both rates and the override.
  function handlePartnerChange(value: string) {
    setPartnerId(value);
    if (!value) {
      setPartnerCostPct("");
      setPartnerProfitPct("");
      setShareTouched(false);
      return;
    }
    if (!shareTouched) {
      const picked = partners.find((p) => String(p.partnerId) === value);
      setPartnerCostPct(picked ? picked.defaultCostPct : "");
      setPartnerProfitPct(picked ? picked.defaultProfitPct : "");
    }
  }

  async function generateBarcode() {
    setGenerating(true);
    setError(null);
    try {
      const { barcode: next } = await apiRequest<{ barcode: string }>(
        "/api/inventory/next-barcode",
      );
      setBarcode(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate barcode",
      );
    } finally {
      setGenerating(false);
    }
  }

  // The rates in force for the preview: the typed override when there is one,
  // otherwise the selected partner's default. Mirrors effectiveRates on the
  // server, which is what actually prices the sale.
  const pickedPartner = partners.find((p) => String(p.partnerId) === partnerId);
  const effectiveCostPct =
    partnerCostPct !== ""
      ? partnerCostPct
      : (pickedPartner?.defaultCostPct ?? "100");
  const effectiveProfitPct =
    partnerProfitPct !== ""
      ? partnerProfitPct
      : (pickedPartner?.defaultProfitPct ?? "0");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        name,
        category,
        unit,
        barcode,
        reorderLevel,
        salePrice,
        // Same reason as supplierId below: omitted for anyone who cannot see a
        // cost, so saving the form never writes over one they were not shown.
        ...(canSeeCost ? { lastCost } : {}),
        partnerId,
        partnerCostPct,
        partnerProfitPct,
        // Omitted entirely for staff without purchasing access, so saving the
        // form never clears a supplier they were not shown.
        ...(canViewSuppliers ? { supplierId } : {}),
        expiryDate,
        tracksExpiry,
        // All three or none: the server and the database both reject a half
        // configured item, so clearing the switch clears the trio.
        looseUnit: sellsLoose ? looseUnit : null,
        loosePerUnit: sellsLoose ? loosePerUnit : null,
        loosePrice: sellsLoose ? loosePrice : null,
        notes,
        // Opening stock only seeds a new item; edits move stock via movements.
        // Also skipped when the caller is about to book its own receipt.
        ...(editing || !allowOpeningStock ? {} : { openingStock }),
      };
      const res = editing
        ? await apiRequest<{ item: InventoryItemDTO }>(
            `/api/inventory/${item!.itemId}`,
            { method: "PATCH", body },
          )
        : await apiRequest<{ item: InventoryItemDTO }>("/api/inventory", {
            method: "POST",
            body,
          });
      onSaved(res.item);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    // The supplier dialog carries its own <form>, so it is rendered as a
    // sibling: nesting it would let its submit bubble up and save the item too.
    <>
      <form onSubmit={handleSubmit}>
        <DialogTitle>{editing ? "Edit item" : "New item"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              fullWidth
            />
            <Stack direction="row" spacing={2}>
              <TextField
                select
                label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                fullWidth
              >
                <MenuItem value="">None</MenuItem>
                {INVENTORY_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="e.g. box, vial, kg"
                fullWidth
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                fullWidth
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip title="Generate a unique internal barcode">
                          <span>
                            <IconButton
                              size="small"
                              edge="end"
                              onClick={() => void generateBarcode()}
                              disabled={generating}
                            >
                              <AutoFixHighIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <TextField
                label="Reorder level"
                type="number"
                value={reorderLevel}
                onChange={(e) => setReorderLevel(e.target.value)}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
                fullWidth
              />
            </Stack>
            {!editing && allowOpeningStock && (
              <TextField
                label="Opening stock"
                type="number"
                value={openingStock}
                onChange={(e) => setOpeningStock(e.target.value)}
                slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
                helperText={
                  canViewSuppliers
                    ? "Quantity on hand now (optional). Records a stock receipt at the cost above."
                    : "Quantity on hand now (optional). Records a stock receipt."
                }
                fullWidth
              />
            )}
            <Stack direction="row" spacing={2}>
              <TextField
                label="Sale price"
                type="number"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
                fullWidth
              />
              {/* Cost is the supplier price, so the field follows the same
                  Admin-only gate the DTO does. Without it the box would sit
                  there empty for clinical staff and invite them to type a
                  figure over a cost they cannot see. */}
              {canSeeCost && (
                <TextField
                  label="Last cost"
                  type="number"
                  value={lastCost}
                  onChange={(e) => setLastCost(e.target.value)}
                  slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
                  helperText="Auto-updated when stock is received"
                  fullWidth
                />
              )}
            </Stack>
            {canViewSuppliers && (
              <TextField
                select
                label="Usual supplier"
                value={supplierId}
                onChange={(e) => handleSupplierChange(e.target.value)}
                helperText="Optional. Groups this item when reordering."
                fullWidth
              >
                <MenuItem value="">Not assigned</MenuItem>
                {suppliers.map((s) => (
                  <MenuItem key={s.supplierId} value={String(s.supplierId)}>
                    {s.name}
                  </MenuItem>
                ))}
                {canCreateSuppliers && (
                  <MenuItem value={ADD_SUPPLIER}>+ Add new supplier…</MenuItem>
                )}
              </TextField>
            )}
            <Stack direction="row" spacing={2}>
              <TextField
                select
                label="Sourced from partner"
                value={partnerId}
                onChange={(e) => handlePartnerChange(e.target.value)}
                helperText="Optional. Consignment stock a partner funded."
                fullWidth
              >
                <MenuItem value="">None (clinic-owned)</MenuItem>
                {partners.map((p) => (
                  <MenuItem key={p.partnerId} value={String(p.partnerId)}>
                    {p.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Cost share"
                type="number"
                value={partnerCostPct}
                onChange={(e) => {
                  setPartnerCostPct(e.target.value);
                  setShareTouched(true);
                }}
                disabled={!partnerId}
                slotProps={{
                  htmlInput: { min: 0, max: 999.99, step: "0.01" },
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">%</InputAdornment>
                    ),
                  },
                }}
                helperText={
                  partnerId
                    ? "Overrides the partner default"
                    : "Pick a partner first"
                }
                fullWidth
              />
              <TextField
                label="Profit share"
                type="number"
                value={partnerProfitPct}
                onChange={(e) => {
                  setPartnerProfitPct(e.target.value);
                  setShareTouched(true);
                }}
                disabled={!partnerId}
                slotProps={{
                  htmlInput: { min: 0, max: 100, step: "0.01" },
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">%</InputAdornment>
                    ),
                  },
                }}
                helperText={
                  partnerId
                    ? "Overrides the partner default"
                    : "Pick a partner first"
                }
                fullWidth
              />
            </Stack>
            {partnerId && (
              <>
                {/* Preview the rates that would actually apply. A blank
                    override means "use the partner default", so passing the
                    raw field would read it as 0% and understate the payout. */}
                <PayoutPreview
                  costPct={effectiveCostPct}
                  profitPct={effectiveProfitPct}
                />
                <Alert severity="info" sx={{ py: 0 }}>
                  Set a Last cost so the split is accurate: both halves of the
                  payout are worked out from it.
                </Alert>
              </>
            )}
            <FormControlLabel
              control={
                <Switch
                  checked={tracksExpiry}
                  onChange={(e) => setTracksExpiry(e.target.checked)}
                />
              }
              label="Perishable, track expiry per delivery"
            />
            {tracksExpiry ? (
              <Alert severity="info" sx={{ py: 0 }}>
                Each delivery records its own lot and expiry, and sales take the
                soonest-expiring stock first. Whatever is on the shelf now
                counts as one undated batch until it sells through.
              </Alert>
            ) : (
              <TextField
                label="Expiry date"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={sellsLoose}
                  onChange={(e) => setSellsLoose(e.target.checked)}
                />
              }
              label="Also sold loose, by weight or volume"
            />
            {sellsLoose && (
              <>
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Loose unit"
                    value={looseUnit}
                    onChange={(e) => setLooseUnit(e.target.value)}
                    placeholder="kg"
                    helperText="What customers ask for"
                    required
                    fullWidth
                  />
                  <TextField
                    label="Per pack"
                    type="number"
                    value={loosePerUnit}
                    onChange={(e) => setLoosePerUnit(e.target.value)}
                    placeholder="20"
                    helperText={
                      looseUnit
                        ? `${looseUnit} in one ${unit || "pack"}`
                        : "How many in one pack"
                    }
                    slotProps={{ htmlInput: { min: 0, step: "0.001" } }}
                    required
                    fullWidth
                  />
                  <TextField
                    label="Loose price"
                    type="number"
                    value={loosePrice}
                    onChange={(e) => setLoosePrice(e.target.value)}
                    helperText={
                      looseUnit ? `Price per ${looseUnit}` : "Per unit"
                    }
                    slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
                    required
                    fullWidth
                  />
                </Stack>
                <Alert severity="info" sx={{ py: 0 }}>
                  Stock stays counted in packs. Loose price is its own figure
                  and is normally higher than the pack price divided
                  {looseComparison
                    ? `, which here would be ${looseComparison}`
                    : ""}
                  .
                </Alert>
              </>
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
          <Tooltip
            title={
              isValidEan13(barcode)
                ? "Print a barcode label"
                : "Generate a barcode first"
            }
          >
            <span>
              <Button
                type="button"
                startIcon={<QrCode2Icon />}
                onClick={() => setLabelOpen(true)}
                disabled={!isValidEan13(barcode)}
              >
                Print label
              </Button>
            </span>
          </Tooltip>
          {/* <Tooltip
          title={
            isValidEan13(barcode)
              ? "Download the label image for the Tiny Print app"
              : "Generate a barcode first"
          }
        >
          <span>
            <Button
              type="button"
              startIcon={<ReceiptLongIcon />}
              onClick={() => void downloadBarcodeLabelImage(barcode, name)}
              disabled={!isValidEan13(barcode)}
              sx={{ mr: "auto" }}
            >
              Tiny Print
            </Button>
          </span>
        </Tooltip> */}
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>

        <BarcodeLabelDialog
          open={labelOpen}
          barcode={barcode}
          name={name}
          onClose={() => setLabelOpen(false)}
        />
      </form>

      <SupplierFormDialog
        open={supplierDialogOpen}
        onClose={() => setSupplierDialogOpen(false)}
        onSaved={handleSupplierCreated}
      />
    </>
  );
}
