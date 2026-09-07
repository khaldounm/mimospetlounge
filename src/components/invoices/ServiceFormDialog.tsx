"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import { apiRequest } from "@/utils/api-client";
import PayoutPreview from "@/components/ui/PayoutPreview";
import ServiceCostBuilder, { type CostRow } from "./ServiceCostBuilder";
import { recordTypeForCategory } from "@/constants/clinical";
import type { PartnerDTO, ServiceDTO } from "@/types/entities";

interface Props {
  open: boolean;
  service?: ServiceDTO | null;
  // Every category already in use, so the picker offers the clinic's own words
  // (Dental, Diagnostics, Surgery) rather than the four clinical record types.
  // Free text is still allowed: a growing clinic invents categories, and the
  // form says what a new one means instead of refusing it.
  categoryOptions: string[];
  // Whether this user may set who performs the service and on what terms. False
  // hides the section outright: the DTO has already stripped the figures, so
  // there would be nothing to show and nothing the save could carry.
  canEditDeal: boolean;
  // Whether this user may set what the service costs. Same reasoning as
  // canEditDeal: without it the DTO carries no cost, so there is nothing to
  // edit and nothing the save could send.
  canEditCost: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function ServiceFormDialog({ open, onClose, ...rest }: Props) {
  // Remount the form (via key) each time the dialog opens instead of syncing
  // props into state with an effect. State is initialized directly from props.
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {open && (
        <ServiceForm
          key={rest.service?.serviceId ?? "new"}
          onClose={onClose}
          {...rest}
        />
      )}
    </Dialog>
  );
}

type FormProps = Omit<Props, "open">;

// The saved components, as editable rows. An item line keeps its unit cost so
// the on-screen total is right before anything is re-searched: lineCost divided
// by quantity recovers it, and a zero quantity cannot occur (the DB CHECK
// forbids it).
function toRows(service: ServiceDTO | null | undefined): CostRow[] {
  return (service?.costComponents ?? []).map((c) => ({
    key: String(c.componentId),
    kind: c.itemId != null ? ("item" as const) : ("flat" as const),
    itemId: c.itemId,
    itemName: c.itemName ?? "",
    quantity: c.quantity ?? "",
    unitCost:
      c.itemId != null && c.quantity
        ? String(Number(c.lineCost) / Number(c.quantity))
        : null,
    label: c.label ?? "",
    amount: c.amount ?? "",
  }));
}

function ServiceForm({
  service,
  categoryOptions,
  canEditDeal,
  canEditCost,
  onClose,
  onSaved,
}: FormProps) {
  const editing = Boolean(service);
  const [name, setName] = useState(service?.name ?? "");
  const [category, setCategory] = useState(service?.category ?? "");
  const [price, setPrice] = useState(service?.price ?? "");
  const [isActive, setIsActive] = useState(service?.isActive ?? true);
  const [description, setDescription] = useState(service?.description ?? "");
  const [partnerId, setPartnerId] = useState(
    service?.partnerId != null ? String(service.partnerId) : "",
  );
  const [costPct, setCostPct] = useState(service?.partnerCostPct ?? "");
  const [profitPct, setProfitPct] = useState(service?.partnerProfitPct ?? "");
  // Until a rate is typed, both track the picked partner's defaults, so
  // switching partners follows the new deal rather than keeping the old one's.
  const [rateTouched, setRateTouched] = useState(
    service?.partnerCostPct != null || service?.partnerProfitPct != null,
  );
  const [partners, setPartners] = useState<PartnerDTO[]>([]);
  const [costRows, setCostRows] = useState<CostRow[]>(() => toRows(service));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canEditDeal) return;
    let alive = true;
    apiRequest<{ partners: PartnerDTO[] }>("/api/partners?active=1")
      .then((data) => {
        if (alive) setPartners(data.partners);
      })
      // Non-fatal: the picker just stays empty if partners cannot load.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canEditDeal]);

  function handlePartnerChange(value: string) {
    setPartnerId(value);
    if (!value) {
      setCostPct("");
      setProfitPct("");
      setRateTouched(false);
      return;
    }
    if (rateTouched) return;
    const picked = partners.find((p) => String(p.partnerId) === value);
    setCostPct(picked ? picked.defaultCostPct : "");
    setProfitPct(picked ? picked.defaultProfitPct : "");
  }

  // What would actually apply: the override when typed, otherwise the partner
  // default. A blank override means "use the default", so previewing the raw
  // field would read it as 0% and understate the partner's cut.
  const picked = partners.find((p) => String(p.partnerId) === partnerId);
  const effectiveCostPct =
    costPct !== "" ? costPct : (picked?.defaultCostPct ?? "0");
  const effectiveProfitPct =
    profitPct !== "" ? profitPct : (picked?.defaultProfitPct ?? "0");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      // The deal fields are omitted entirely, not sent blank, when this user
      // cannot set them: the API rejects a request that so much as mentions
      // them without partners:write.
      const body = {
        name,
        category,
        price,
        isActive,
        description,
        ...(canEditDeal
          ? { partnerId, partnerCostPct: costPct, partnerProfitPct: profitPct }
          : {}),
        // Sent whole or not at all: the API replaces the recipe when the field
        // is present and leaves it alone when it is absent. Incomplete rows are
        // dropped rather than rejected, so a half-added line the user never
        // finished does not block saving a price change.
        ...(canEditCost
          ? {
              costComponents: costRows
                .filter((r) =>
                  r.kind === "item"
                    ? r.itemId != null && Number(r.quantity) > 0
                    : r.label.trim() !== "" && r.amount !== "",
                )
                .map((r) =>
                  r.kind === "item"
                    ? {
                        kind: "item" as const,
                        itemId: r.itemId,
                        quantity: r.quantity,
                      }
                    : {
                        kind: "flat" as const,
                        label: r.label,
                        amount: r.amount,
                      },
                ),
            }
          : {}),
      };
      if (editing) {
        await apiRequest(`/api/services/${service!.serviceId}`, {
          method: "PATCH",
          body,
        });
      } else {
        await apiRequest("/api/services", { method: "POST", body });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // The clinical record type is DERIVED from the category, never stored beside
  // it: one column, so the two can never disagree. Saying it here means the vet
  // sees where records and recalls will land at the moment they choose, and an
  // unmapped category announces itself now instead of quietly sending records to
  // "Unfiled" weeks later.
  const trimmedCategory = category.trim();
  const filesAs = recordTypeForCategory(trimmedCategory);
  const categoryHint = !trimmedCategory
    ? "Uncategorised. Records using it appear under Unfiled services."
    : filesAs
      ? `Clinical records using this file as ${filesAs}.`
      : `"${trimmedCategory}" is a new category. Records using it appear under Unfiled services until it is mapped.`;

  return (
    <form onSubmit={handleSubmit}>
      <DialogTitle>{editing ? "Edit service" : "New service"}</DialogTitle>
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
            <Autocomplete
              freeSolo
              options={categoryOptions}
              value={category}
              onChange={(_, v) => setCategory(v ?? "")}
              onInputChange={(_, v) => setCategory(v)}
              fullWidth
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Category"
                  helperText={categoryHint}
                />
              )}
            />
            <TextField
              label="Price"
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
              required
              fullWidth
            />
          </Stack>
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
          {canEditCost && (
            <ServiceCostBuilder
              rows={costRows}
              onChange={setCostRows}
              price={String(price)}
            />
          )}
          {canEditDeal && (
            <>
              <Stack direction="row" spacing={2}>
                <TextField
                  select
                  label="Performed by partner"
                  value={partnerId}
                  onChange={(e) => handlePartnerChange(e.target.value)}
                  helperText="Optional. The vet or other partner who takes a cut."
                  fullWidth
                >
                  <MenuItem value="">None (clinic keeps it all)</MenuItem>
                  {partners.map((p) => (
                    <MenuItem key={p.partnerId} value={String(p.partnerId)}>
                      {p.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Cost share"
                  type="number"
                  value={costPct}
                  onChange={(e) => {
                    setCostPct(e.target.value);
                    setRateTouched(true);
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
                  value={profitPct}
                  onChange={(e) => {
                    setProfitPct(e.target.value);
                    setRateTouched(true);
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
                  <PayoutPreview
                    costPct={effectiveCostPct}
                    profitPct={effectiveProfitPct}
                    noun="service"
                  />
                  <Alert severity="info" sx={{ py: 0 }}>
                    The deal is recorded now and starts paying out once services
                    carry a cost, which is the next step.
                  </Alert>
                </>
              )}
            </>
          )}
          <FormControlLabel
            control={
              <Switch
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
            }
            label="Active (available for new invoices)"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </form>
  );
}
