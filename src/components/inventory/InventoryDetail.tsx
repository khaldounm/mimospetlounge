"use client";

import { useState } from "react";
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
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import { apiRequest } from "@/utils/api-client";
import { formatDate, formatDateTime, formatMoney } from "@/utils/format";
import type {
  InventoryItemDTO,
  InventoryTransactionDTO,
} from "@/types/entities";
import AddToOrderDialog from "@/components/orders/AddToOrderDialog";
import InventoryItemFormDialog from "./InventoryItemFormDialog";
import StockMovementDialog from "./StockMovementDialog";

interface Props {
  item: InventoryItemDTO;
  initialTransactions: InventoryTransactionDTO[];
  canWrite: boolean;
  canViewSuppliers: boolean;
  /** Admin only. Cost is a harder gate than the supplier fields: see canSeeCost. */
  canSeeCost: boolean;
  canCreateSuppliers: boolean;
  /** orders:write. Gates pushing this item into a future order. */
  canOrder: boolean;
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body1">{value || "-"}</Typography>
    </Box>
  );
}

export default function InventoryDetail({
  item,
  initialTransactions,
  canWrite,
  canViewSuppliers,
  canSeeCost,
  canCreateSuppliers,
  canOrder,
}: Props) {
  const router = useRouter();
  const [transactions, setTransactions] = useState(initialTransactions);
  const [editOpen, setEditOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    // Pull fresh movements into local state; refresh the server-rendered card
    // so the updated stock level and low-stock chip stay in sync.
    const tx = await apiRequest<{ transactions: InventoryTransactionDTO[] }>(
      `/api/inventory/${item.itemId}/transactions`,
    );
    setTransactions(tx.transactions);
    router.refresh();
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await apiRequest(`/api/inventory/${item.itemId}`, { method: "DELETE" });
      router.push("/inventory");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Box>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography variant="h4">{item.name}</Typography>
            {item.isLowStock && <Chip color="warning" label="Low stock" />}
            {item.isExpired && <Chip color="error" label="Expired" />}
          </Stack>
          {item.category && (
            <Typography color="text.secondary">{item.category}</Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1}>
          {canOrder && (
            <Button
              variant="contained"
              color="secondary"
              startIcon={<ShoppingCartIcon />}
              onClick={() => setOrderOpen(true)}
            >
              Add to future order
            </Button>
          )}
          {canWrite && (
            <>
              <Button
                variant="contained"
                startIcon={<SwapVertIcon />}
                onClick={() => setMoveOpen(true)}
              >
                Record movement
              </Button>
              <Button
                variant="outlined"
                startIcon={<EditIcon />}
                onClick={() => setEditOpen(true)}
              >
                Edit
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => setConfirmOpen(true)}
              >
                Delete
              </Button>
            </>
          )}
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={3}>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Field
              label="Current stock"
              value={`${item.currentStock}${item.unit ? ` ${item.unit}` : ""}`}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Field label="Reorder level" value={String(item.reorderLevel)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Field label="Unit" value={item.unit} />
          </Grid>
          {item.looseUnit && (
            <Grid size={{ xs: 6, sm: 3 }}>
              <Field
                label="Sold loose"
                value={`$${item.loosePrice} per ${item.looseUnit}, ${item.loosePerUnit} per pack`}
              />
            </Grid>
          )}
          <Grid size={{ xs: 6, sm: 3 }}>
            <Field label="Barcode" value={item.barcode} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Field label="Sale price" value={formatMoney(item.salePrice)} />
          </Grid>
          {/* Last cost is the supplier price, and beside the sale price it is
              the clinic's margin. Admin only, checked on the role. */}
          {canSeeCost && (
            <Grid size={{ xs: 6, sm: 3 }}>
              <Field label="Last cost" value={formatMoney(item.lastCost)} />
            </Grid>
          )}
          {canViewSuppliers && (
            <Grid size={{ xs: 6, sm: 3 }}>
              <Field label="Usual supplier" value={item.supplierName} />
            </Grid>
          )}
          {item.partnerName && (
            <Grid size={{ xs: 6, sm: 3 }}>
              <Field label="Sourced from" value={item.partnerName} />
            </Grid>
          )}
          {item.partnerName && (
            <Grid size={{ xs: 6, sm: 3 }}>
              <Field
                label="Cost share"
                value={
                  item.partnerCostPct
                    ? `${item.partnerCostPct}%`
                    : "Partner default"
                }
              />
            </Grid>
          )}
          {item.partnerName && (
            <Grid size={{ xs: 6, sm: 3 }}>
              <Field
                label="Profit share"
                value={
                  item.partnerProfitPct
                    ? `${item.partnerProfitPct}%`
                    : "Partner default"
                }
              />
            </Grid>
          )}
          <Grid size={{ xs: 6, sm: 3 }}>
            <Field
              label="Expiry date"
              value={item.expiryDate ? formatDate(item.expiryDate) : null}
            />
          </Grid>
          {item.notes && (
            <Grid size={12}>
              <Field label="Notes" value={item.notes} />
            </Grid>
          )}
        </Grid>
      </Paper>

      <Typography variant="h5" sx={{ mb: 2 }}>
        Stock movements
      </Typography>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Quantity</TableCell>
              {/* A Received movement's unit cost is the supplier price, so it
                  carries the same Admin-only gate the field does. */}
              {canSeeCost && <TableCell align="right">Unit cost</TableCell>}
              <TableCell>By</TableCell>
              <TableCell>Notes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canSeeCost ? 6 : 5} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No movements recorded yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((t) => (
                <TableRow key={t.transactionId} hover>
                  <TableCell>{formatDateTime(t.performedAt)}</TableCell>
                  <TableCell>{t.type}</TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      color: t.quantity < 0 ? "error.main" : "success.main",
                    }}
                  >
                    {t.quantity > 0 ? `+${t.quantity}` : t.quantity}
                  </TableCell>
                  {canSeeCost && (
                    <TableCell align="right">
                      {formatMoney(t.unitCost)}
                    </TableCell>
                  )}
                  <TableCell>{t.performerName ?? "-"}</TableCell>
                  <TableCell>{t.notes ?? "-"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <InventoryItemFormDialog
        open={editOpen}
        item={item}
        canViewSuppliers={canViewSuppliers}
        canSeeCost={canSeeCost}
        canCreateSuppliers={canCreateSuppliers}
        onClose={() => setEditOpen(false)}
        onSaved={() => router.refresh()}
      />
      <StockMovementDialog
        open={moveOpen}
        itemId={item.itemId}
        itemName={item.name}
        unit={item.unit}
        canSeeCost={canSeeCost}
        onClose={() => setMoveOpen(false)}
        onSaved={() => void reload()}
      />
      <AddToOrderDialog
        open={orderOpen}
        items={[item]}
        onClose={() => setOrderOpen(false)}
        onAdded={() => router.refresh()}
      />

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete item?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This soft-deletes {item.name}. The movement history and any invoice
            references are retained, and it can be restored by an administrator.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <Divider sx={{ mt: 4 }} />
    </Box>
  );
}
