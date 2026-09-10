"use client";

import { useState } from "react";
import Link from "@/components/ui/AppLink";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  Chip,
  IconButton,
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
import DeleteIcon from "@mui/icons-material/Delete";
import { apiRequest } from "@/utils/api-client";
import { formatMoney } from "@/utils/format";
import StatCard from "@/components/ui/StatCard";
import type { SupplierDTO } from "@/types/entities";
import SupplierFormDialog from "./SupplierFormDialog";
import ReviewBadge from "@/components/ui/ReviewBadge";

interface Props {
  initialSuppliers: SupplierDTO[];
  unassignedItemCount: number;
  canWrite: boolean;
  // payables:read. False strips the money columns and the two money tiles: the
  // DTO arrives without `money` at all, so rendering them would show zeros and
  // read as "this supplier is settled" rather than "you cannot see this".
  showMoney: boolean;
}

export default function SuppliersTable({
  initialSuppliers,
  unassignedItemCount,
  canWrite,
  showMoney,
}: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeCount = initialSuppliers.filter((s) => s.isActive).length;

  // Debts and credits are kept apart rather than netted. Summing the raw
  // balances would let a credit on one account cancel a real debt on another,
  // so the headline could read low, or negative, while money was genuinely owed.
  const totals = initialSuppliers.reduce(
    (acc, s) => {
      const balance = Number(s.money?.balance ?? 0);
      if (balance > 0) acc.owed += balance;
      else acc.credit += -balance;
      acc.inProgress += Number(s.money?.inProgress ?? 0);
      return acc;
    },
    { owed: 0, credit: 0, inProgress: 0 },
  );

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(supplier: SupplierDTO) {
    setEditing(supplier);
    setDialogOpen(true);
  }

  async function handleDelete(supplier: SupplierDTO) {
    if (
      !window.confirm(
        `Remove ${supplier.name}? Past orders keep naming them. To just stop offering them when tagging items, edit and switch them to inactive instead.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await apiRequest(`/api/suppliers/${supplier.supplierId}`, {
        method: "DELETE",
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    }
  }

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 0.5 }}
      >
        <Typography variant="h4">Suppliers</Typography>
        {canWrite && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>
            New supplier
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Companies the clinic buys stock from. Tag an inventory item with its
        usual supplier so reordering can group by who to buy from.
      </Typography>

      {error && (
        <Typography color="error" variant="body2" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      <Box
        sx={{
          display: "grid",
          gap: 2,
          mb: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: showMoney ? "repeat(4, 1fr)" : "repeat(2, 1fr)",
          },
        }}
      >
        {showMoney && (
          <StatCard
            label="Owed to suppliers"
            value={formatMoney(totals.owed)}
            accent={totals.owed > 0 ? "warning" : "success"}
            hint={
              totals.credit > 0
                ? `Plus ${formatMoney(totals.credit)} held in credit`
                : "Delivered orders, minus payments"
            }
          />
        )}
        {showMoney && (
          <StatCard
            label="In progress"
            value={formatMoney(totals.inProgress)}
            hint="Ordered, not yet delivered"
          />
        )}
        <StatCard
          label="Suppliers"
          value={`${activeCount} / ${initialSuppliers.length}`}
          hint="Active of total"
        />
        <StatCard
          label="Items with no supplier"
          value={String(unassignedItemCount)}
          accent={unassignedItemCount > 0 ? "warning" : undefined}
        />
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Supplier</TableCell>
              <TableCell>Contact</TableCell>
              <TableCell align="right">Items</TableCell>
              {showMoney && <TableCell align="right">Billed</TableCell>}
              {showMoney && <TableCell align="right">Paid</TableCell>}
              {showMoney && <TableCell align="right">Owed</TableCell>}
              {canWrite && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {initialSuppliers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={(showMoney ? 6 : 3) + (canWrite ? 1 : 0)}
                  align="center"
                >
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No suppliers yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              initialSuppliers.map((s) => (
                <TableRow key={s.supplierId} hover>
                  <TableCell>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", flexWrap: "wrap" }}
                    >
                      <Link href={`/suppliers/${s.supplierId}`}>{s.name}</Link>
                      <ReviewBadge
                        needsReview={s.needsReview}
                        note={s.reviewNote}
                      />
                      {!s.isActive && <Chip size="small" label="Inactive" />}
                    </Stack>
                    {s.contactPerson && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block" }}
                      >
                        {s.contactPerson}
                      </Typography>
                    )}
                  </TableCell>
                  {/* The primary contact only. A supplier is often split
                      across a food rep, a medication rep and an accounts
                      person, so the rest are counted here and listed in full
                      on the supplier's own page. */}
                  <TableCell>
                    {s.phone && (
                      <Typography variant="body2">{s.phone}</Typography>
                    )}
                    {s.email && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block" }}
                      >
                        {s.email}
                      </Typography>
                    )}
                    {!s.phone && !s.email && (
                      <Typography variant="body2" color="text.secondary">
                        No contacts
                      </Typography>
                    )}
                    {s.contacts.length > 1 && (
                      <Typography variant="caption" color="text.secondary">
                        {`+${s.contacts.length - 1} more`}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {s.itemCount ? (
                      <Link href={`/inventory?supplier=${s.supplierId}`}>
                        {s.itemCount}
                      </Link>
                    ) : (
                      0
                    )}
                  </TableCell>
                  {showMoney && (
                    <TableCell align="right">
                      {formatMoney(s.money?.invoiced)}
                      {Number(s.money?.inProgress ?? 0) > 0 && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block" }}
                        >
                          {formatMoney(s.money?.inProgress)} in progress
                        </Typography>
                      )}
                    </TableCell>
                  )}
                  {showMoney && (
                    <TableCell align="right">
                      {formatMoney(s.money?.paid)}
                    </TableCell>
                  )}
                  {showMoney && (
                    <OwedCell balance={Number(s.money?.balance ?? 0)} />
                  )}
                  {canWrite && (
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(s)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remove">
                        <IconButton
                          size="small"
                          onClick={() => void handleDelete(s)}
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
        </Table>
      </TableContainer>

      <SupplierFormDialog
        open={dialogOpen}
        supplier={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={() => router.refresh()}
      />
    </Box>
  );
}

// A negative balance means more has been paid than billed, so it is a credit, not
// a debt of minus something. Shown as a positive figure labelled as credit, and
// flagged rather than left plain: unmatched cash usually means an order was never
// entered, which is worth chasing.
function OwedCell({ balance }: { balance: number }) {
  const inCredit = balance < 0;
  return (
    <TableCell
      align="right"
      sx={{
        fontWeight: 600,
        color:
          balance > 0 ? "warning.main" : inCredit ? "info.main" : undefined,
      }}
    >
      {formatMoney(Math.abs(balance))}
      {inCredit && (
        <Typography
          variant="caption"
          color="info.main"
          sx={{ display: "block", fontWeight: 400 }}
        >
          in credit
        </Typography>
      )}
    </TableCell>
  );
}
