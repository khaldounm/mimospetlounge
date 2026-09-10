"use client";

import { useState } from "react";
import {
  Alert,
  AlertTitle,
  Autocomplete,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import Link from "@/components/ui/AppLink";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useCostItemSearch } from "@/hooks/useCostItemSearch";
import { formatMoney } from "@/utils/format";

// A row being edited. `key` is a client-side identity so React can track a row
// that has no id yet, and so two blank rows stay distinct.
export interface CostRow {
  key: string;
  kind: "item" | "flat";
  itemId: number | null;
  itemName: string;
  // Held as typed text, not numbers: a half-typed "0." must survive a keystroke.
  quantity: string;
  unitCost: string | null;
  label: string;
  amount: string;
}

export function newItemRow(): CostRow {
  return {
    key: crypto.randomUUID(),
    kind: "item",
    itemId: null,
    itemName: "",
    quantity: "1",
    unitCost: null,
    label: "",
    amount: "",
  };
}

export function newFlatRow(): CostRow {
  return { ...newItemRow(), kind: "flat", quantity: "" };
}

// What one row contributes. Mirrors componentCost in lib/services, which is the
// authority: this is the on-screen estimate while the form is open, and it is
// recomputed server-side from the item's live cost on every read.
export function rowCost(r: CostRow): number {
  if (r.kind === "flat") return Number(r.amount) || 0;
  return (Number(r.quantity) || 0) * Number(r.unitCost ?? 0);
}

export function totalCost(rows: CostRow[]): number {
  return rows.reduce((sum, r) => sum + rowCost(r), 0);
}

// A stock line that prices at nothing, because the item carries no last cost.
//
// This is worth shouting about rather than noting quietly. The partner's cut is
// worked out as their share of price MINUS cost, so a cost of zero does not
// merely understate the service: it hands the partner a share of the entire
// sale price and the clinic pays out more than it agreed to. The figure looks
// perfectly reasonable on screen while being wrong in the clinic's disfavour,
// which is exactly the kind of error nobody catches.
export function rowHasNoCost(r: CostRow): boolean {
  return r.kind === "item" && r.itemId != null && Number(r.unitCost ?? 0) === 0;
}

function ItemRow({
  row,
  onChange,
  onRemove,
}: {
  row: CostRow;
  onChange: (r: CostRow) => void;
  onRemove: () => void;
}) {
  // A row that already names an item has nothing to search for until somebody
  // types in it. A blank row does, so opening the picker offers a starting list.
  const [searching, setSearching] = useState(row.itemId == null);
  const { options, loading } = useCostItemSearch(row.itemName, searching);
  const noCost = rowHasNoCost(row);

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
      <Autocomplete
        size="small"
        sx={{ flex: 1 }}
        options={options}
        loading={loading}
        // The server already matched on name, category and barcode; filtering
        // again here would hide a hit the typed text is not a prefix of.
        filterOptions={(o) => o}
        getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
        // Item names are not unique, so the label cannot be the key.
        getOptionKey={(o) => o.itemId}
        inputValue={row.itemName}
        onInputChange={(_e, v, reason) => {
          if (reason === "reset") return;
          setSearching(true);
          onChange({ ...row, itemName: v });
        }}
        onChange={(_e, v) =>
          onChange(
            v
              ? {
                  ...row,
                  itemId: v.itemId,
                  itemName: v.name,
                  unitCost: v.lastCost,
                }
              : { ...row, itemId: null, unitCost: null },
          )
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label="Item"
            placeholder="Search stock"
            error={noCost}
            helperText={noCost ? "No last cost: this adds $0.00" : undefined}
          />
        )}
      />
      <TextField
        size="small"
        label="Qty"
        type="number"
        value={row.quantity}
        onChange={(e) => onChange({ ...row, quantity: e.target.value })}
        slotProps={{ htmlInput: { min: 0, step: "0.001" } }}
        sx={{ width: 100 }}
      />
      <Box sx={{ width: 80, pt: 1, textAlign: "right" }}>
        <Typography
          variant="body2"
          color={noCost ? "error.main" : undefined}
          sx={{ fontWeight: noCost ? 700 : undefined }}
        >
          {formatMoney(rowCost(row))}
        </Typography>
      </Box>
      {/* Straight to the item, because that is where a cost can be judged: the
          stock on hand, the supplier and what was last paid are all on that
          page, and none of them are here. Deliberately a link and not an edit
          box: this figure prices the item everywhere in the app, so it is
          changed where that is visible. */}
      {noCost && (
        <Tooltip title="Set this item's cost in Inventory">
          <IconButton
            size="small"
            color="error"
            aria-label="Fix cost in Inventory"
            component={Link}
            href={`/inventory/${row.itemId}`}
            target="_blank"
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <IconButton size="small" aria-label="Remove cost row" onClick={onRemove}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

function FlatRow({
  row,
  onChange,
  onRemove,
}: {
  row: CostRow;
  onChange: (r: CostRow) => void;
  onRemove: () => void;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
      <TextField
        size="small"
        label="Cost"
        placeholder="What it is"
        value={row.label}
        onChange={(e) => onChange({ ...row, label: e.target.value })}
        sx={{ flex: 1 }}
      />
      <TextField
        size="small"
        label="Amount"
        type="number"
        value={row.amount}
        onChange={(e) => onChange({ ...row, amount: e.target.value })}
        slotProps={{
          htmlInput: { min: 0, step: "0.01" },
          input: {
            startAdornment: <InputAdornment position="start">$</InputAdornment>,
          },
        }}
        sx={{ width: 140 }}
      />
      <Box sx={{ width: 80, pt: 1 }} />
      <IconButton size="small" aria-label="Remove cost row" onClick={onRemove}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

// What one performance of the service costs the clinic, built from stock lines
// and flat amounts. Item lines are priced from the item's current cost rather
// than a figure captured here, so re-pricing stock re-prices the service.
export default function ServiceCostBuilder({
  rows,
  onChange,
  price,
}: {
  rows: CostRow[];
  onChange: (rows: CostRow[]) => void;
  price: string;
}) {
  const cost = totalCost(rows);
  const margin = (Number(price) || 0) - cost;
  const noCostRows = rows.filter(rowHasNoCost);

  function update(key: string, next: CostRow) {
    onChange(rows.map((r) => (r.key === key ? next : r)));
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2" color="text.secondary">
        What it costs to perform
      </Typography>

      {rows.map((row) =>
        row.kind === "item" ? (
          <ItemRow
            key={row.key}
            row={row}
            onChange={(next) => update(row.key, next)}
            onRemove={() => onChange(rows.filter((r) => r.key !== row.key))}
          />
        ) : (
          <FlatRow
            key={row.key}
            row={row}
            onChange={(next) => update(row.key, next)}
            onRemove={() => onChange(rows.filter((r) => r.key !== row.key))}
          />
        ),
      )}

      {noCostRows.length > 0 && (
        <Alert severity="error" icon={<WarningAmberIcon />}>
          <AlertTitle sx={{ fontWeight: 700 }}>
            {noCostRows.length === 1
              ? "1 item has no last cost"
              : `${noCostRows.length} items have no last cost`}
          </AlertTitle>
          {noCostRows.map((r) => r.itemName).join(", ")}{" "}
          {noCostRows.length === 1 ? "prices" : "price"} at{" "}
          <strong>$0.00</strong> here, so this service looks cheaper to perform
          than it is. If a partner performs it, their cut is worked out as a
          share of price minus cost, so a zero cost pays them a share of the
          whole sale price and the clinic loses the difference.
          <Box component="span" sx={{ display: "block", mt: 1 }}>
            If it is real stock, set its cost in Inventory (the red link on the
            row). If there is nothing on a shelf to use up, like an outside lab
            fee, take it off and add it as a <strong>Fixed cost</strong>
            instead: a stock line also takes the item off the shelf when the
            invoice is issued, and a fee should not.
          </Box>
        </Alert>
      )}

      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() => onChange([...rows, newItemRow()])}
        >
          Stock item
        </Button>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() => onChange([...rows, newFlatRow()])}
        >
          Fixed cost
        </Button>
      </Stack>

      {rows.length > 0 && (
        <Box
          sx={{
            p: 1.5,
            borderRadius: 1,
            bgcolor: "action.hover",
            border: 1,
            borderColor: "divider",
          }}
        >
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="body2" color="text.secondary">
              Cost to perform
            </Typography>
            <Typography
              variant="body2"
              color={noCostRows.length > 0 ? "error.main" : undefined}
              sx={{ fontWeight: 600 }}
            >
              {formatMoney(cost)}
              {noCostRows.length > 0 && " (understated)"}
            </Typography>
          </Stack>
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="body2" color="text.secondary">
              Margin at {formatMoney(Number(price) || 0)}
            </Typography>
            <Typography
              variant="body2"
              color={margin < 0 ? "error.main" : undefined}
              sx={{ fontWeight: 600 }}
            >
              {formatMoney(margin)}
            </Typography>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
