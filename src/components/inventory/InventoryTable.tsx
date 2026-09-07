"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import { apiRequest } from "@/utils/api-client";
import { formatDate, formatMoney } from "@/utils/format";
import type { InventoryItemDTO, SupplierDTO } from "@/types/entities";
import TablePaginationBar from "@/components/ui/TablePaginationBar";
import type { InventoryCategoryCount } from "@/lib/inventory";
import AddToOrderDialog from "@/components/orders/AddToOrderDialog";
import InventoryCategoryTabs from "./InventoryCategoryTabs";
import InventoryItemFormDialog from "./InventoryItemFormDialog";
import ReviewBadge from "@/components/ui/ReviewBadge";

// Filter value for items that have no usual supplier assigned yet. Matches the
// sentinel the inventory API understands.
const NO_SUPPLIER = "none";

interface Props {
  initialItems: InventoryItemDTO[];
  initialTotal: number;
  pageSize: number;
  categories: InventoryCategoryCount[];
  /** Category from the route, or null on the all-categories view. */
  activeCategory: string | null;
  canWrite: boolean;
  canViewSuppliers: boolean;
  /** Admin only. Cost is a harder gate than the supplier columns: see canSeeCost. */
  canSeeCost: boolean;
  canCreateSuppliers: boolean;
  /** orders:write. Gates row selection and the push into a future order. */
  canOrder: boolean;
  suppliers: SupplierDTO[];
  /** Preselected supplier filter, from the ?supplier= link on the suppliers page. */
  initialSupplierFilter: string;
}

export default function InventoryTable({
  initialItems,
  initialTotal,
  pageSize,
  categories,
  activeCategory,
  canWrite,
  canViewSuppliers,
  canSeeCost,
  canCreateSuppliers,
  canOrder,
  suppliers,
  initialSupplierFilter,
}: Props) {
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0); // zero-based, matching the pager
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState(initialSupplierFilter);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const firstRender = useRef(true);

  // Wrapped so the debounce effect can depend on it: it closes over the
  // category from the route, and a bare function would be a new value on every
  // render.
  const load = useCallback(
    async (q: string, lowStock: boolean, supplier: string, p: number) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (lowStock) params.set("lowStock", "true");
      if (supplier) params.set("supplier", supplier);
      // The category comes from the route, not from client state, so reloading
      // this URL shows the same rows.
      if (activeCategory) params.set("category", activeCategory);
      params.set("page", String(p + 1));
      setLoading(true);
      try {
        const data = await apiRequest<{
          items: InventoryItemDTO[];
          total: number;
        }>(`/api/inventory?${params}`);
        setItems(data.items);
        setTotal(data.total);
      } finally {
        setLoading(false);
      }
    },
    [activeCategory],
  );

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(
      () => void load(query, lowStockOnly, supplierFilter, page),
      300,
    );
    return () => clearTimeout(t);
  }, [query, lowStockOnly, supplierFilter, page, load]);

  // A new filter invalidates the current offset.
  function changeFilter(next: () => void) {
    setPage(0);
    next();
  }

  // Only items still on screen can be acted on: a selection left over from a
  // previous filter would order things the user can no longer see.
  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.itemId)),
    [items, selected],
  );

  function toggleSelected(itemId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleAll(pageItems: InventoryItemDTO[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of pageItems) {
        if (checked) next.add(item.itemId);
        else next.delete(item.itemId);
      }
      return next;
    });
  }

  function handleAdded(
    results: { supplierName: string | null; itemsAdded: number }[],
  ) {
    const total = results.reduce((sum, r) => sum + r.itemsAdded, 0);
    const orders = results.length;
    setToast(
      `Added ${total} item(s) to ${orders} order${orders === 1 ? "" : "s"}.`,
    );
    setSelected(new Set());
  }
  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Typography variant="h4">Inventory</Typography>
        <Stack direction="row" spacing={1}>
          {canOrder && selectedItems.length > 0 && (
            <Button
              variant="contained"
              color="secondary"
              startIcon={<ShoppingCartIcon />}
              onClick={() => setOrderDialogOpen(true)}
            >
              Add {selectedItems.length} to future order
            </Button>
          )}
          {canWrite && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setDialogOpen(true)}
            >
              New item
            </Button>
          )}
        </Stack>
      </Stack>

      <InventoryCategoryTabs categories={categories} active={activeCategory} />

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { sm: "center" }, mb: 2 }}
      >
        <TextField
          placeholder="Search by name, category, or barcode"
          value={query}
          onChange={(e) => changeFilter(() => setQuery(e.target.value))}
          fullWidth
          size="small"
        />
        {canViewSuppliers && (
          <TextField
            select
            label="Supplier"
            value={supplierFilter}
            onChange={(e) =>
              changeFilter(() => setSupplierFilter(e.target.value))
            }
            size="small"
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">All suppliers</MenuItem>
            <MenuItem value={NO_SUPPLIER}>Not assigned</MenuItem>
            {suppliers.map((s) => (
              <MenuItem key={s.supplierId} value={String(s.supplierId)}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        <FormControlLabel
          control={
            <Switch
              checked={lowStockOnly}
              onChange={(e) =>
                changeFilter(() => setLowStockOnly(e.target.checked))
              }
            />
          }
          label="Low stock"
          sx={{ whiteSpace: "nowrap" }}
        />
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {canOrder && (
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={
                      items.length > 0 &&
                      items.every((i) => selected.has(i.itemId))
                    }
                    indeterminate={
                      items.some((i) => selected.has(i.itemId)) &&
                      !items.every((i) => selected.has(i.itemId))
                    }
                    onChange={(e) => toggleAll(items, e.target.checked)}
                    slotProps={{
                      input: { "aria-label": "Select everything on this page" },
                    }}
                  />
                </TableCell>
              )}
              <TableCell>Name</TableCell>
              {!activeCategory && <TableCell>Category</TableCell>}
              {canViewSuppliers && <TableCell>Supplier</TableCell>}
              <TableCell align="right">Stock</TableCell>
              <TableCell align="right">Reorder</TableCell>
              {/* Cost price is what the clinic pays a supplier, and it gives
                  away the clinic's margin against the sale price beside it. It
                  is Admin only, checked on the role rather than on a Settings
                  toggle, and stripped from the DTO as well as hidden here. */}
              {canSeeCost && <TableCell align="right">Cost price</TableCell>}
              <TableCell align="right">Sale price</TableCell>
              <TableCell>Expiry</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    No items found.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              items.map((it) => (
                <TableRow key={it.itemId} hover>
                  {canOrder && (
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selected.has(it.itemId)}
                        onChange={() => toggleSelected(it.itemId)}
                        slotProps={{
                          input: { "aria-label": `Select ${it.name}` },
                        }}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", flexWrap: "wrap" }}
                    >
                      <Link href={`/inventory/${it.itemId}`}>{it.name}</Link>
                      <ReviewBadge
                        needsReview={it.needsReview}
                        note={it.reviewNote}
                        // A flagged item with no barcode is not a job half
                        // done: the clinic decided these are found by name.
                        // Saying so beats a "Check" the counter cannot clear.
                        // Keyed on the note, not on a null barcode: an item
                        // flagged for its NAME can also lack a barcode, and
                        // mislabelling that one hides the actual problem.
                        label={
                          it.reviewNote?.startsWith("No barcode")
                            ? "No barcode"
                            : undefined
                        }
                      />
                      {it.partnerName && (
                        <Chip
                          size="small"
                          variant="outlined"
                          color="info"
                          label={it.partnerName}
                        />
                      )}
                      {it.isLowStock && (
                        <Chip size="small" color="warning" label="Low stock" />
                      )}
                      {it.isExpired && (
                        <Chip size="small" color="error" label="Expired" />
                      )}
                    </Stack>
                  </TableCell>
                  {!activeCategory && (
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {it.category ?? "-"}
                      </Typography>
                    </TableCell>
                  )}
                  {canViewSuppliers && (
                    <TableCell>
                      {it.supplierName ?? (
                        <Typography variant="body2" color="text.secondary">
                          Not assigned
                        </Typography>
                      )}
                    </TableCell>
                  )}
                  <TableCell align="right">
                    {it.currentStock}
                    {it.unit ? ` ${it.unit}` : ""}
                  </TableCell>
                  <TableCell align="right">{it.reorderLevel}</TableCell>
                  {canSeeCost && (
                    <TableCell align="right">
                      {formatMoney(it.lastCost)}
                    </TableCell>
                  )}
                  <TableCell align="right">
                    {formatMoney(it.salePrice)}
                  </TableCell>
                  <TableCell>
                    {it.expiryDate ? formatDate(it.expiryDate) : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <TablePaginationBar
          page={page}
          count={total}
          pageSize={pageSize}
          onChange={setPage}
          loading={loading}
          noun="items"
        />
      </TableContainer>

      <InventoryItemFormDialog
        open={dialogOpen}
        canViewSuppliers={canViewSuppliers}
        canSeeCost={canSeeCost}
        canCreateSuppliers={canCreateSuppliers}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load(query, lowStockOnly, supplierFilter, page)}
      />

      <AddToOrderDialog
        open={orderDialogOpen}
        items={selectedItems}
        onClose={() => setOrderDialogOpen(false)}
        onAdded={handleAdded}
      />

      <Snackbar
        open={toast !== null}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        message={toast ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
