"use client";

import { useState } from "react";
import {
  Box,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  Switch,
  TableCell,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  alpha,
  type SxProps,
  type Theme,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { apiRequest } from "@/utils/api-client";
import { useWriteQueue } from "@/hooks/useWriteQueue";
import { formatMoney } from "@/utils/format";
import {
  formatLineQuantity,
  looseConfigOf,
  looseLine,
  looseToPacks,
  minLooseQuantity,
  packsToLoose,
} from "@/utils/inventory";
import type { InvoiceDTO, InvoiceLineItemDTO } from "@/types/entities";
import type { ItemLineOption } from "./LineItemDialog";

// Fixed column widths, shared with the table header so the two cannot drift.
// The table is laid out `fixed`, so these hold whatever the content is: a long
// product name wraps inside its column instead of shouldering the number
// columns out of alignment.
//
// The three editable columns split their space 54 / 21 / 25. Price is still the
// wider of the two numbers: it carries cents and gets typed over far more often
// than a quantity. Quantity takes more than the digits need because a pack that
// is also sold loose carries its unit picker inside the field.
//
// Everything is a plain percentage, and every column has one, because a fixed
// table layout ignores a `calc()` width that mixes a percentage with a length
// and silently falls back to dividing the row evenly. So the columns that are
// not typed into take a flat share and the rest is split by the ratio above.
//
// The table carries a minWidth instead, and its container scrolls: below that
// the number columns would be too narrow to type a price into.
export const LINE_ITEM_TABLE_MIN_WIDTH = 680;

// Table cells default to 16px of padding a side, which is 32px taken out of
// every column. On the narrow number columns that left the input barely wider
// than the digits in it, so the cells are tightened and the fields get the
// width the percentages above actually allocate.
export const LINE_ITEM_CELL_SX = { px: 0.5 } as const;

export function lineItemColumnWidths(editable: boolean) {
  // Total always gets a share; the controls column only exists on a draft.
  const total = 11;
  const controls = editable ? 11 : 0;
  const typed = 100 - total - controls;
  const share = (fraction: number) => `${(typed * fraction).toFixed(2)}%`;
  return {
    description: share(0.54),
    quantity: share(0.21),
    unitPrice: share(0.25),
    total: `${total}%`,
    controls: `${controls}%`,
  };
}

type Field = "description" | "quantity" | "unitPrice";

interface Props {
  invoiceId: number;
  line: InvoiceLineItemDTO;
  // The item behind an inventory line, when there is one. It carries the loose
  // setup, which decides whether the amount is typed in packs or by the kilo.
  item?: ItemLineOption;
  // Lines are only editable on a draft, and only by someone who can write.
  editable: boolean;
  // Set only when the invoice sells more of this line's item than the shelf
  // holds, and then it is what the shelf holds. Decided by the invoice, which
  // is the only thing that sees every line drawing on the same item, and the
  // only thing that knows the stock figure is still worth reading: stock does
  // not move until the invoice is issued, so on anything past a draft the count
  // has already gone down and the warning would be a lie.
  inStock?: number;
  onSaved: (invoice: InvoiceDTO) => void;
  onDelete: () => void;
  onError: (message: string) => void;
}

// A return reads as an ordinary line with a minus in front of it, which is easy
// to skim past on a busy counter, so the row says what it is.
//
// Selling stock that is not there gets the whole row rather than a mark in one
// cell: the counter reads the invoice by scanning down it while the queue moves,
// and a badge in a single column is exactly what gets skipped. `&&` doubles the
// selector so the tint outranks TableRow's own hover colour instead of losing
// the row under the cursor, which is the row being looked at.
function rowSx(
  line: InvoiceLineItemDTO,
  outOfStock: boolean,
): SxProps<Theme> | undefined {
  const returned =
    Number(line.quantity) < 0 ? { "& td": { color: "warning.dark" } } : null;
  if (!outOfStock) return returned ?? undefined;
  const tint = (t: Theme, weight: number) =>
    alpha(t.palette.warning.main, weight);
  return {
    ...returned,
    "&&": { backgroundColor: (t: Theme) => tint(t, 0.16) },
    "&&:hover": { backgroundColor: (t: Theme) => tint(t, 0.24) },
  };
}

export default function LineItemRow(props: Props) {
  return props.editable ? (
    <EditableRow {...props} />
  ) : (
    <ReadOnlyRow {...props} />
  );
}

function ReadOnlyRow({ line, inStock }: Props) {
  const cols = lineItemColumnWidths(false);
  return (
    <TableRow hover sx={rowSx(line, inStock != null)}>
      <TableCell sx={{ ...LINE_ITEM_CELL_SX, width: cols.description }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>{line.description}</Box>
          {inStock != null && <ShortStockTag inStock={inStock} />}
          {line.isHidden && <ClinicUseTag />}
        </Stack>
      </TableCell>
      <TableCell
        align="right"
        sx={{ ...LINE_ITEM_CELL_SX, width: cols.quantity }}
      >
        {formatLineQuantity(line)}
      </TableCell>
      <TableCell
        align="right"
        sx={{ ...LINE_ITEM_CELL_SX, width: cols.unitPrice }}
      >
        {formatMoney(line.unitPrice)}
      </TableCell>
      <TableCell align="right" sx={{ ...LINE_ITEM_CELL_SX, width: cols.total }}>
        {line.isHidden ? <NotCharged /> : formatMoney(line.lineTotal)}
      </TableCell>
    </TableRow>
  );
}

// Says what the orange means. Colour alone is a poor carrier for one fact in a
// dense table, and it is the fact the counter has to act on.
function ShortStockTag({ inStock }: { inStock: number }) {
  return (
    <Typography
      variant="caption"
      color="warning.dark"
      sx={{ flexShrink: 0, whiteSpace: "nowrap", fontWeight: 600 }}
    >
      {inStock > 0 ? `Only ${inStock} in stock` : "No stock"}
    </Typography>
  );
}

function ClinicUseTag() {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
      Clinic use
    </Typography>
  );
}

function NotCharged() {
  return (
    // Held on one line: wrapping to "Not / charged" makes a clinic-use row
    // taller than every other row, which is the alignment this layout exists to
    // fix. Smaller than the figures it stands in for, because it is a note
    // rather than an amount.
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ whiteSpace: "nowrap" }}
    >
      Not charged
    </Typography>
  );
}

/**
 * A line that is always open for editing: no pencil, no save tick, no dialog.
 *
 * The counter corrects a price mid-sale, so the fastest possible path is the
 * field already being a field. Typing edits a draft and leaving the field
 * commits it; anything not being typed in still tracks the invoice, so a scan
 * that bumps this line's quantity shows up here without wiping what is
 * half-typed in another cell.
 */
function EditableRow({
  invoiceId,
  line,
  item,
  inStock,
  onSaved,
  onDelete,
  onError,
}: Props) {
  // Only the fields actually touched. Everything else reads from the invoice.
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>({});
  const [saving, setSaving] = useState(false);
  // Writes queue rather than race. Switching the unit blurs the amount field,
  // so a typed amount and the switch that follows it are two requests a few
  // milliseconds apart, and each response carries the whole recomputed invoice:
  // in parallel the slower one would land last and undo the other.
  const enqueue = useWriteQueue();
  const cols = lineItemColumnWidths(true);

  const isItem = line.itemId != null;
  const looseConfig = item ? looseConfigOf(item) : null;
  // Whether this line is sold loose is fixed when it is added. Editing the
  // amount keeps it loose; the server re-derives the pack quantity and price
  // together so the two can never be saved disagreeing.
  const loose = line.looseQty != null && looseConfig != null;
  // What a whole one of these is called. Items are not required to carry a unit
  // and a blank option would read as a bug, so anything unnamed is a "Pack".
  const packUnit = item?.unit?.trim() || "Pack";

  const saved: Record<Field, string> = {
    description: line.description,
    quantity: loose ? (line.looseQty ?? "") : line.quantity,
    unitPrice: line.unitPrice,
  };
  const valueOf = (field: Field) => draft[field] ?? saved[field];

  // Same arithmetic the server will run, so the total moves as the price is
  // typed rather than after it is saved.
  const preview = (() => {
    if (line.isHidden) return null;
    const quantity = Number(valueOf("quantity"));
    if (!Number.isFinite(quantity)) return null;
    if (loose && looseConfig) return looseLine(quantity, looseConfig);
    const unitPrice = Number(valueOf("unitPrice"));
    if (!Number.isFinite(unitPrice)) return null;
    return { lineTotal: quantity * unitPrice };
  })();

  function commit(body: Record<string, unknown>, clear: Field[]) {
    setSaving(true);
    enqueue(async () => {
      try {
        const data = await apiRequest<{ invoice: InvoiceDTO }>(
          `/api/invoices/${invoiceId}/line-items/${line.lineItemId}`,
          { method: "PATCH", body },
        );
        onSaved(data.invoice);
        // Hand these fields back to the invoice now that it agrees with them.
        setDraft((d) => {
          const next = { ...d };
          for (const field of clear) delete next[field];
          return next;
        });
      } catch (err) {
        // The draft is deliberately kept: whoever typed it should get the
        // chance to correct it rather than watch it snap back to the old figure.
        onError(err instanceof Error ? err.message : "Failed to save line");
      } finally {
        setSaving(false);
      }
    });
  }

  // Leaving a field saves it, and only if it actually changed: tabbing across a
  // row must not fire four requests.
  //
  // The value comes from the input itself rather than from `draft`, which is a
  // render behind: a keystroke followed immediately by a blur would otherwise be
  // read through the closure that still has the old draft and dropped.
  function commitField(field: Field, value: string) {
    if (value === saved[field]) return;
    if (field === "quantity" && loose) {
      commit({ looseQty: value }, ["quantity", "unitPrice"]);
      return;
    }
    commit({ [field]: value }, [field]);
  }

  // Swap the line between whole packs and the loose unit, in place, with no
  // dialog: scanning the bag is the same scan either way, and which of the two
  // the customer is buying is decided here.
  //
  // The amount carries across as a straight conversion, so the money does not
  // move on its own when the unit does: a 15kg bag becomes 15 kg, and 3 kg
  // becomes a fifth of a bag. Whoever switched then types what they meant, and
  // the server re-derives quantity and price together from whichever was sent.
  function changeUnit(next: "pack" | "loose") {
    if (!looseConfig || next === (loose ? "loose" : "pack")) return;
    // Read off the field rather than the line: the blur that the click on this
    // select just fired may still be in flight with a newer amount.
    const shown = Number(valueOf("quantity"));
    if (next === "loose") {
      const amount =
        Number.isFinite(shown) && shown > 0
          ? packsToLoose(shown, looseConfig)
          : minLooseQuantity(looseConfig);
      commit({ looseQty: String(amount) }, ["quantity", "unitPrice"]);
      return;
    }
    const packs = Number.isFinite(shown)
      ? looseToPacks(shown, looseConfig)
      : null;
    commit({ quantity: String(packs ?? line.quantity) }, [
      "quantity",
      "unitPrice",
    ]);
  }

  function fieldProps(field: Field) {
    return {
      value: valueOf(field),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setDraft((d) => ({ ...d, [field]: e.target.value })),
      onBlur: (e: React.FocusEvent<HTMLInputElement>) =>
        commitField(field, e.target.value),
      onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.target.select(),
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Enter commits by leaving the field, Escape throws the edit away.
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft((d) => {
            const next = { ...d };
            delete next[field];
            return next;
          });
        }
      },
      size: "small" as const,
      fullWidth: true,
      disabled: saving,
    };
  }

  // A pack that is also sold by the kilo picks its unit here, inside the amount
  // field, so the two read as the one answer they are. Items sold only whole
  // keep the plain field they always had.
  const unitAdornment = looseConfig ? (
    <InputAdornment position="end" sx={{ ml: 0.25 }}>
      <Select
        value={loose ? "loose" : "pack"}
        onChange={(e) => changeUnit(e.target.value as "pack" | "loose")}
        variant="standard"
        // The picker sits inside the amount field, so it is inside that field's
        // FormControl and would otherwise grey itself out every time the amount
        // saves. Writes queue, so it stays live and the click always lands.
        disabled={false}
        SelectDisplayProps={{ "aria-label": "Unit" }}
        sx={{
          fontSize: "0.75rem",
          // The standard variant's rule would draw a line under the picker
          // inside a field that already has its own border.
          "&::before, &::after": { display: "none" },
          "& .MuiSelect-select": { py: 0, pl: 0 },
        }}
      >
        <MenuItem value="pack" sx={{ fontSize: "0.8125rem" }}>
          {packUnit}
        </MenuItem>
        <MenuItem value="loose" sx={{ fontSize: "0.8125rem" }}>
          {looseConfig.unit}
        </MenuItem>
      </Select>
    </InputAdornment>
  ) : null;

  return (
    <TableRow sx={rowSx(line, inStock != null)}>
      <TableCell sx={{ ...LINE_ITEM_CELL_SX, width: cols.description }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <TextField {...fieldProps("description")} />
          {inStock != null && <ShortStockTag inStock={inStock} />}
        </Stack>
      </TableCell>
      <TableCell sx={{ ...LINE_ITEM_CELL_SX, width: cols.quantity }}>
        <TextField
          {...fieldProps("quantity")}
          type="number"
          slotProps={{
            htmlInput: {
              min: loose && looseConfig ? minLooseQuantity(looseConfig) : 0.001,
              step: "0.001",
              style: { textAlign: "right" },
            },
            ...(unitAdornment
              ? { input: { endAdornment: unitAdornment } }
              : {}),
          }}
        />
      </TableCell>
      <TableCell sx={{ ...LINE_ITEM_CELL_SX, width: cols.unitPrice }}>
        <TextField
          {...fieldProps("unitPrice")}
          type="number"
          // A clinic-use line is never charged, and a loose line's per-pack
          // price is derived from the amount rather than typed.
          disabled={saving || line.isHidden || loose}
          slotProps={{
            htmlInput: {
              min: 0,
              step: "0.01",
              style: { textAlign: "right" },
            },
            input: {
              startAdornment: (
                <InputAdornment position="start">$</InputAdornment>
              ),
            },
          }}
        />
      </TableCell>
      <TableCell align="right" sx={{ ...LINE_ITEM_CELL_SX, width: cols.total }}>
        {line.isHidden ? (
          <NotCharged />
        ) : (
          <Typography variant="body2">
            {formatMoney(preview ? preview.lineTotal : Number(line.lineTotal))}
          </Typography>
        )}
      </TableCell>
      {/* The clinic-use switch sits where a save tick used to, which is what
          lets every row be the same height: there is one control block per row
          rather than one that appears only while editing. */}
      <TableCell
        align="right"
        sx={{ ...LINE_ITEM_CELL_SX, width: cols.controls }}
      >
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ alignItems: "center", justifyContent: "flex-end" }}
        >
          {/* Only stock can be consumed: a service has nothing to take off a
              shelf and no cost to expense. Services still reserve the width so
              the delete buttons stay in one line down the table. */}
          {isItem ? (
            <Tooltip title="Used in the clinic, not charged">
              <Switch
                size="small"
                checked={line.isHidden}
                disabled={saving}
                onChange={(e) => commit({ isHidden: e.target.checked }, [])}
                slotProps={{
                  input: {
                    "aria-label": "Used in the clinic, not charged",
                  },
                }}
              />
            </Tooltip>
          ) : (
            <Box sx={{ width: 38 }} />
          )}
          <IconButton
            size="small"
            aria-label="Remove line"
            onClick={onDelete}
            disabled={saving}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      </TableCell>
    </TableRow>
  );
}
