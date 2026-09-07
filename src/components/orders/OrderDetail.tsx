"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  IconButton,
  Link,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { apiRequest } from "@/utils/api-client";
import { formatDate, formatMoney } from "@/utils/format";
import { suggestedReorderQuantity } from "@/utils/inventory";
import {
  DEFAULT_VAT_RATE,
  NO_SUPPLIER_LABEL,
  ORDER_STATUS_COLOR,
  UNCATEGORISED_ORDER_LABEL,
} from "@/constants/order";
import { INVENTORY_CATEGORIES } from "@/constants/inventory";
import type {
  InventoryItemDTO,
  PurchaseOrderDTO,
  SupplierContactDTO,
  SupplierDTO,
} from "@/types/entities";
import InventoryItemFormDialog from "@/components/inventory/InventoryItemFormDialog";
import ReceiveOrderDialog from "./ReceiveOrderDialog";
import SendOrderDialog from "./SendOrderDialog";
import SupplierReturnDialog from "./SupplierReturnDialog";

interface Props {
  initialOrder: PurchaseOrderDTO;
  items: InventoryItemDTO[];
  suppliers: SupplierDTO[];
  /** Contacts of this order's supplier, for the WhatsApp send. */
  supplierContacts: SupplierContactDTO[];
  canWrite: boolean;
  canReceive: boolean;
  /** Admin only. Gates the cost box on the inline "new item" dialog. */
  canSeeCost: boolean;
}

// One editable money row in the totals block. Uncontrolled so typing never
// round-trips, committing only on blur when the value actually changed.
function ChargeRow({
  label,
  value,
  editable,
  span,
  hint,
  applyValue,
  onCommit,
}: {
  label: string;
  value: string | null;
  editable: boolean;
  span: number;
  hint?: string;
  /** When set, the hint becomes a button that fills the field with this. */
  applyValue?: string;
  onCommit: (value: string) => void;
}) {
  const clickableHint = editable && applyValue !== undefined;
  return (
    <TableRow>
      <TableCell colSpan={span} align="right">
        {label}
        {hint && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block" }}
          >
            {clickableHint ? (
              <Link
                component="button"
                type="button"
                variant="caption"
                underline="hover"
                onClick={() => onCommit(applyValue)}
              >
                {hint}
              </Link>
            ) : (
              hint
            )}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right">
        {editable ? (
          <TextField
            // Uncontrolled so typing never round-trips, but remounted when the
            // committed value changes, so applying the hint updates what is on
            // screen rather than leaving a stale figure in the box.
            key={value ?? ""}
            type="number"
            size="small"
            defaultValue={value ?? ""}
            onBlur={(e) => {
              if (e.target.value !== (value ?? "")) onCommit(e.target.value);
            }}
            slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
            sx={{ width: 120 }}
          />
        ) : (
          formatMoney(value ?? 0)
        )}
      </TableCell>
      {editable && <TableCell />}
    </TableRow>
  );
}

export default function OrderDetail({
  initialOrder,
  items,
  suppliers,
  supplierContacts,
  canWrite,
  canReceive,
  canSeeCost,
}: Props) {
  const router = useRouter();
  const [order, setOrder] = useState(initialOrder);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<InventoryItemDTO | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  // Memoized so the fallback empty array is stable across renders and does not
  // invalidate the picker below on every pass.
  const lines = useMemo(() => order.lines ?? [], [order.lines]);
  // A Partial order is no longer editable: part of it is already booked into
  // stock, so changing an ordered quantity or cost would rewrite history. It can
  // still take deliveries, which is what receivable covers.
  const editable = order.status === "Draft" || order.status === "Placed";
  const receivable = editable || order.status === "Partial";
  // Stock is on the shelf from this order, so some of it can go back.
  const delivered = order.status === "Partial" || order.status === "Received";
  const canEdit = canWrite && editable;

  // Items already on the order are filtered out of the picker: adding one again
  // bumps its quantity, which is confusing to trigger from an "add item" box.
  const pickable = useMemo(() => {
    const onOrder = new Set(lines.map((l) => l.itemId));
    return items.filter((i) => !onOrder.has(i.itemId));
  }, [items, lines]);

  // A delivery can be booked against an order that has nothing on it yet. That
  // is the walk-in: the supplier is at the counter with goods nobody ordered,
  // and the items get created inside the receipt as the boxes come out. Gating
  // on hasOutstanding alone (false for zero lines) left a fresh order with no
  // way forward at all, since the only in-flow item creator lives in there.
  const canDeliver = order.hasOutstanding || lines.length === 0;

  // Both walk-in actions need to know who the goods came from. Receiving books
  // the stock and the bill against the supplier (the server refuses without
  // one), and a product created here is filed under the rep who brought it, so
  // creating it on a supplier-less order quietly makes an orphan that lands
  // back on this same pile next time it is reordered. Blocked at the button
  // rather than at the save, since the picker that fixes it is right above.
  const needsSupplier = order.supplierId == null;

  const missingCost = lines.filter((l) => l.unitCost == null).length;

  // What VAT would come to at the order's rate. Offered as a hint rather than
  // written automatically, so the figure on the actual bill always wins.
  //
  // Rounded to whole cents exactly once, and both the hint and the value the
  // apply link writes read from that. Formatting the raw product two different
  // ways does not agree: 20.50 at 11% is 2.255, which Intl renders as $2.26
  // while toFixed(2) yields "2.25", because the float sits just under the
  // halfway point. That made the label contradict the button by a cent.
  const suggestedTaxString = (
    Math.round(
      Number(order.taxableBase) * Number(order.taxRate ?? DEFAULT_VAT_RATE),
    ) / 100
  ).toFixed(2);

  // Every mutation returns the whole order, so the view is always the server's
  // truth rather than a locally patched guess.
  async function mutate(
    url: string,
    options: { method?: string; body?: unknown },
  ) {
    setError(null);
    setBusy(true);
    try {
      const res = await apiRequest<{ order: PurchaseOrderDTO }>(url, options);
      setOrder(res.order);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const patchOrder = (body: Record<string, unknown>) =>
    mutate(`/api/orders/${order.orderId}`, { method: "PATCH", body });

  const patchLine = (lineId: number, body: Record<string, unknown>) =>
    mutate(`/api/orders/${order.orderId}/lines/${lineId}`, {
      method: "PATCH",
      body,
    });

  async function addItem(item: InventoryItemDTO) {
    const ok = await mutate(`/api/orders/${order.orderId}/lines`, {
      method: "POST",
      body: {
        itemId: item.itemId,
        quantityOrdered: suggestedReorderQuantity(item),
      },
    });
    if (ok) setPicked(null);
  }

  async function removeLine(lineId: number) {
    await mutate(`/api/orders/${order.orderId}/lines/${lineId}`, {
      method: "DELETE",
    });
  }

  async function transition(action: "place" | "cancel" | "close-short") {
    if (action === "cancel" && !window.confirm("Cancel this order?")) return;
    if (
      action === "close-short" &&
      !window.confirm(
        "Close this order short? It settles at what actually arrived, and the shortfall stays on record.",
      )
    ) {
      return;
    }
    await mutate(`/api/orders/${order.orderId}/${action}`, { method: "POST" });
  }

  async function deleteDraft() {
    if (!window.confirm("Delete this draft? Its lines go with it.")) return;
    setError(null);
    setBusy(true);
    try {
      await apiRequest(`/api/orders/${order.orderId}`, { method: "DELETE" });
      router.push("/orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setBusy(false);
    }
  }

  // Generate the purchase order PDF and download it. Same document the supplier
  // is sent, so what gets printed, emailed or handed over is the one artefact.
  // The renderer is loaded on demand so it stays out of the initial bundle.
  async function downloadPdf() {
    setPdfBusy(true);
    setError(null);
    try {
      const [{ pdf }, { default: OrderPdfDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./OrderPdfDocument"),
      ]);
      const blob = await pdf(<OrderPdfDocument order={order} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${order.reference || `PO-${order.orderId}`}.pdf`;
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

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 0.5 }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Typography variant="h4">
            {order.reference || `Order #${order.orderId}`}
          </Typography>
          <Chip
            size="small"
            color={ORDER_STATUS_COLOR[order.status]}
            label={order.status}
          />
        </Stack>
        <Stack direction="row" spacing={1}>
          {/* The order as a document, independent of how it reaches the
              supplier. Works with no messaging provider configured, so it is
              also the fallback whenever WhatsApp is not set up. */}
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            disabled={pdfBusy || busy}
            onClick={() => void downloadPdf()}
          >
            {pdfBusy ? "Preparing…" : "Download PDF"}
          </Button>
          {/* Sending is what actually reaches the supplier, so it is offered on
              any live order: a draft being sent for a quote, a placed one being
              chased, or a received one sent again as a copy. */}
          {canWrite &&
            order.supplierId != null &&
            order.status !== "Cancelled" && (
              <Button
                variant="outlined"
                color="success"
                startIcon={<WhatsAppIcon />}
                disabled={busy}
                onClick={() => setSendOpen(true)}
              >
                Send via WhatsApp
              </Button>
            )}
          {canEdit && order.status === "Draft" && (
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => void transition("place")}
            >
              Place order
            </Button>
          )}
          {canWrite && canReceive && receivable && canDeliver && (
            // A disabled MUI button fires no mouse events, so the tooltip needs
            // a wrapper of its own or the reason never shows.
            <Tooltip
              title={
                needsSupplier
                  ? "Pick this order's supplier first, so the stock is recorded against who it came from."
                  : ""
              }
            >
              <span>
                <Button
                  variant="contained"
                  color="success"
                  disabled={busy || needsSupplier}
                  onClick={() => setReceiveOpen(true)}
                >
                  {order.status === "Partial" ? "Receive rest" : "Receive"}
                </Button>
              </span>
            </Tooltip>
          )}
          {canWrite && order.status === "Partial" && (
            <Button
              color="warning"
              disabled={busy}
              onClick={() => void transition("close-short")}
            >
              Close short
            </Button>
          )}
          {/* Only once something has actually arrived: you cannot send back
              what was never delivered. A return is its own document, so this
              leaves the order the supplier invoiced exactly as it is. */}
          {canWrite && delivered && (
            <Button
              color="warning"
              disabled={busy}
              onClick={() => setReturnOpen(true)}
            >
              Return to supplier
            </Button>
          )}
          {canEdit && (
            <Button
              color="warning"
              disabled={busy}
              onClick={() => void transition("cancel")}
            >
              Cancel order
            </Button>
          )}
          {canWrite && order.status === "Draft" && (
            <Button
              color="error"
              disabled={busy}
              onClick={() => void deleteDraft()}
            >
              Delete
            </Button>
          )}
        </Stack>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Started {formatDate(order.createdAt)}
        {order.orderedOn ? ` · placed ${formatDate(order.orderedOn)}` : ""}
        {order.receivedOn ? ` · received ${formatDate(order.receivedOn)}` : ""}
        {order.createdByName ? ` · by ${order.createdByName}` : ""}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {sent && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSent(null)}>
          {`Order sent to ${sent} on WhatsApp.`}
        </Alert>
      )}

      {needsSupplier && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This order has no supplier yet. Pick one below to place it, receive it
          or add a new product to it, so the stock and the bill are recorded
          against who they came from. Setting each item&apos;s usual supplier
          from Inventory keeps future orders off this pile.
        </Alert>
      )}

      {editable && missingCost > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {missingCost} line(s) still have no unit cost. Receiving needs a cost
          on every line, since it becomes the item&apos;s last cost and is what
          the profit report charges when the stock sells.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField
            select
            label="Supplier"
            size="small"
            value={order.supplierId != null ? String(order.supplierId) : ""}
            onChange={(e) =>
              void patchOrder({ supplierId: e.target.value || null })
            }
            disabled={!canEdit || busy}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">{NO_SUPPLIER_LABEL}</MenuItem>
            {suppliers.map((s) => (
              <MenuItem key={s.supplierId} value={String(s.supplierId)}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Category"
            size="small"
            value={order.category ?? ""}
            onChange={(e) =>
              void patchOrder({ category: e.target.value || null })
            }
            disabled={!canEdit || busy}
            helperText="Which rep this sheet goes to"
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">{UNCATEGORISED_ORDER_LABEL}</MenuItem>
            {INVENTORY_CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Their reference"
            size="small"
            defaultValue={order.reference ?? ""}
            onBlur={(e) => {
              if (e.target.value !== (order.reference ?? "")) {
                void patchOrder({ reference: e.target.value });
              }
            }}
            disabled={!canEdit || busy}
            placeholder="Supplier's order or invoice number"
            fullWidth
          />
        </Stack>
      </Paper>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell>
              <TableCell align="right">In stock</TableCell>
              <TableCell align="right">Quantity</TableCell>
              <TableCell align="right">Delivered</TableCell>
              <TableCell align="right">Unit cost</TableCell>
              <TableCell align="right">Line total</TableCell>
              {canEdit && <TableCell align="right" />}
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canEdit ? 7 : 6} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    Nothing on this order yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              lines.map((l) => (
                <TableRow key={l.lineId} hover>
                  <TableCell>
                    {l.itemName}
                    {l.unit && (
                      <Typography variant="caption" color="text.secondary">
                        {` (${l.unit})`}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {l.currentStock}
                    {l.currentStock <= l.reorderLevel && l.reorderLevel > 0 && (
                      <Chip
                        size="small"
                        color="warning"
                        label="Low"
                        sx={{ ml: 1 }}
                      />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {canEdit ? (
                      <TextField
                        type="number"
                        size="small"
                        defaultValue={l.quantityOrdered}
                        onBlur={(e) => {
                          if (e.target.value !== l.quantityOrdered) {
                            void patchLine(l.lineId, {
                              quantityOrdered: e.target.value,
                            });
                          }
                        }}
                        slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
                        sx={{ width: 110 }}
                      />
                    ) : (
                      l.quantityOrdered
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {l.quantityReceived}
                    {Number(l.quantityOutstanding) > 0 &&
                      Number(l.quantityReceived) > 0 && (
                        <Typography
                          variant="caption"
                          color="warning.main"
                          sx={{ display: "block" }}
                        >
                          {l.quantityOutstanding} still due
                        </Typography>
                      )}
                  </TableCell>
                  <TableCell align="right">
                    {canEdit ? (
                      <TextField
                        type="number"
                        size="small"
                        defaultValue={l.unitCost ?? ""}
                        onBlur={(e) => {
                          if (e.target.value !== (l.unitCost ?? "")) {
                            void patchLine(l.lineId, {
                              unitCost: e.target.value,
                            });
                          }
                        }}
                        slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
                        error={l.unitCost == null}
                        sx={{ width: 120 }}
                      />
                    ) : (
                      formatMoney(l.unitCost)
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {formatMoney(l.lineTotal)}
                  </TableCell>
                  {canEdit && (
                    <TableCell align="right">
                      <Tooltip title="Remove from order">
                        <IconButton
                          size="small"
                          disabled={busy}
                          onClick={() => void removeLine(l.lineId)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5} align="right">
                Subtotal
              </TableCell>
              <TableCell align="right">{formatMoney(order.subtotal)}</TableCell>
              {canEdit && <TableCell />}
            </TableRow>
            <ChargeRow
              label="Discount"
              value={order.discountAmount}
              editable={canEdit}
              span={5}
              onCommit={(v) => void patchOrder({ discountAmount: v })}
            />
            <ChargeRow
              label="Delivery"
              value={order.shippingAmount}
              editable={canEdit}
              span={5}
              onCommit={(v) => void patchOrder({ shippingAmount: v })}
            />
            <ChargeRow
              // An amount, not a rate: the supplier's own rounding has to be
              // matchable. The label says so, and the hint below fills in what
              // the rate comes to so nobody has to retype it.
              label="VAT amount"
              value={order.taxAmount}
              editable={canEdit}
              span={5}
              hint={
                canEdit
                  ? `Apply ${order.taxRate ?? DEFAULT_VAT_RATE}% of ${formatMoney(order.taxableBase)} = ${formatMoney(suggestedTaxString)}`
                  : undefined
              }
              applyValue={canEdit ? suggestedTaxString : undefined}
              onCommit={(v) => void patchOrder({ taxAmount: v })}
            />
            <TableRow>
              <TableCell colSpan={5} align="right">
                <Typography sx={{ fontWeight: 700 }}>Total</Typography>
              </TableCell>
              <TableCell align="right">
                <Typography sx={{ fontWeight: 700 }}>
                  {formatMoney(order.total)}
                </Typography>
              </TableCell>
              {canEdit && <TableCell />}
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>

      {canEdit && (
        <Stack direction="row" spacing={2} sx={{ mt: 2, alignItems: "center" }}>
          <Autocomplete
            options={pickable}
            value={picked}
            onChange={(_e, value) => setPicked(value)}
            getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(a, b) => a.itemId === b.itemId}
            renderOption={(optionProps, option) => {
              // MUI derives its default option key from getOptionLabel, and
              // item names are not unique (there are genuinely two "Cosmo
              // sterilized cat salmon-3kg"), so that collides. Drop MUI's key,
              // use the id, and show the unit so the two can be told apart.
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { key, ...rest } = optionProps;
              return (
                <li key={option.itemId} {...rest}>
                  {option.name}
                  {option.unit && (
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                    >
                      {` (${option.unit})`}
                    </Typography>
                  )}
                </li>
              );
            }}
            renderInput={(inputParams) => (
              <TextField {...inputParams} label="Add an item" size="small" />
            )}
            sx={{ width: 320 }}
          />
          <Button
            variant="outlined"
            disabled={!picked || busy}
            onClick={() => picked && void addItem(picked)}
          >
            Add
          </Button>
          {/* The picker can only offer what the catalogue already holds, and a
              rep who walks in with something new to try is exactly the case it
              cannot express. Creating the product needs inventory:write, which
              is the same permission receiving needs, so it rides on canReceive
              rather than on canWrite. */}
          {canReceive && (
            <Tooltip
              title={
                needsSupplier
                  ? "Pick this order's supplier first, so the new product is filed against the rep who brought it."
                  : ""
              }
            >
              <span>
                <Button
                  startIcon={<AddIcon />}
                  disabled={busy || needsSupplier}
                  onClick={() => setAddingItem(true)}
                >
                  New item
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
      )}

      <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
        <TextField
          label="Notes"
          defaultValue={order.notes ?? ""}
          onBlur={(e) => {
            if (e.target.value !== (order.notes ?? "")) {
              void patchOrder({ notes: e.target.value });
            }
          }}
          disabled={!canEdit || busy}
          multiline
          minRows={2}
          fullWidth
        />
      </Paper>

      {/* Outside every form on the page: the item dialog carries a <form> of
          its own, and React events propagate up the component tree rather than
          the DOM, so nesting it inside one makes its Save submit that too. */}
      <InventoryItemFormDialog
        open={addingItem}
        canViewSuppliers
        canSeeCost={canSeeCost}
        canCreateSuppliers={false}
        defaults={{ category: order.category, supplierId: order.supplierId }}
        // The order is what will put these units on the shelf, when it is
        // received. An opening stock here as well would count them twice.
        allowOpeningStock={false}
        onClose={() => setAddingItem(false)}
        // Straight onto the order at the usual reorder quantity, the same as
        // picking an existing item. The line's quantity and cost are editable
        // in the table above, which is where the real figures get keyed.
        onSaved={(created) => void addItem(created)}
      />

      <SupplierReturnDialog
        open={returnOpen}
        orderId={order.orderId}
        onClose={() => setReturnOpen(false)}
        // The return is a NEW document, so go to it rather than staying here:
        // it still has to be sent before any stock moves.
        onCreated={(created) => router.push(`/orders/${created.orderId}`)}
      />
      <ReceiveOrderDialog
        open={receiveOpen}
        order={order}
        canSeeCost={canSeeCost}
        onClose={() => setReceiveOpen(false)}
        onReceived={(next) => {
          setOrder(next);
          router.refresh();
        }}
        // An item put on the order from inside the receipt is saved there and
        // then. Waiting for the delivery to be submitted left a cancelled
        // receipt looking like it had thrown the new product away, when the
        // line was on the order the whole time. The refresh also puts the new
        // product into the picker above.
        onOrderChanged={(next) => {
          setOrder(next);
          router.refresh();
        }}
      />
      <SendOrderDialog
        open={sendOpen}
        order={order}
        contacts={supplierContacts}
        onClose={() => setSendOpen(false)}
        onSent={({ contactName, placed, order: next }) => {
          setSent(placed ? `${contactName}, and marked placed` : contactName);
          setOrder(next);
          router.refresh();
        }}
      />
    </Box>
  );
}
