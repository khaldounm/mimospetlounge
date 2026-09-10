"use client";

import { useCallback, useState } from "react";
import Link from "@/components/ui/AppLink";
import { useRouter } from "next/navigation";
import {
  Alert,
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
import EditIcon from "@mui/icons-material/Edit";
import PaymentsIcon from "@mui/icons-material/Payments";
import DeleteIcon from "@mui/icons-material/Delete";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { apiRequest } from "@/utils/api-client";
import { formatDate, formatMoney } from "@/utils/format";
import { ORDER_STATUS_COLOR } from "@/constants/order";
import { SETTLEMENT_KIND_LABEL } from "@/constants/supplier";
import StatCard from "@/components/ui/StatCard";
import TablePaginationBar from "@/components/ui/TablePaginationBar";
import type {
  PayableOrderOption,
  PurchaseOrderDTO,
  SupplierDTO,
  SupplierPaymentDTO,
} from "@/types/entities";
import SupplierFormDialog from "./SupplierFormDialog";
import SupplierPaymentFormDialog from "./SupplierPaymentFormDialog";
import SupplierCreditFormDialog from "./SupplierCreditFormDialog";

interface Props {
  supplier: SupplierDTO;
  /** Page one of each table, rendered by the server. */
  initialOrders: PurchaseOrderDTO[];
  ordersTotal: number;
  initialPayments: SupplierPaymentDTO[];
  paymentsTotal: number;
  pageSize: number;
  payableOrders: PayableOrderOption[];
  canWrite: boolean;
  // payables:read. Without it the supplier still opens, showing who they are
  // and what was bought, with every figure about what is owed, paid or
  // credited left out. The DTO arrives without `money`, so these blocks would
  // otherwise render zeros and read as a settled account.
  showMoney: boolean;
  // payables:write. Separate from canWrite (orders:write), so someone who may
  // edit the supplier record is not offered buttons that will 403.
  canRecordPayments: boolean;
}

export default function SupplierDetail({
  supplier,
  initialOrders,
  ordersTotal,
  initialPayments,
  paymentsTotal,
  pageSize,
  payableOrders,
  canWrite,
  showMoney,
  canRecordPayments,
}: Props) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Page one is never held in state, only pages after it. Copying a prop into
  // useState freezes it at first mount, and this page leans on router.refresh()
  // to bring fresh figures down after a payment; reading page one straight from
  // props means a refresh reaches the table as well as the cards.
  const [ordersPage, setOrdersPage] = useState(0);
  const [laterOrders, setLaterOrders] = useState<PurchaseOrderDTO[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const orders = ordersPage === 0 ? initialOrders : laterOrders;

  const [paymentsPage, setPaymentsPage] = useState(0);
  const [laterPayments, setLaterPayments] = useState<SupplierPaymentDTO[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const payments = paymentsPage === 0 ? initialPayments : laterPayments;

  const loadOrders = useCallback(
    async (p: number) => {
      setOrdersPage(p);
      if (p === 0) return;
      setOrdersLoading(true);
      try {
        const data = await apiRequest<{ orders: PurchaseOrderDTO[] }>(
          `/api/suppliers/${supplier.supplierId}/orders?page=${p + 1}`,
        );
        setLaterOrders(data.orders);
      } finally {
        setOrdersLoading(false);
      }
    },
    [supplier.supplierId],
  );

  const loadPayments = useCallback(
    async (p: number) => {
      setPaymentsPage(p);
      if (p === 0) return;
      setPaymentsLoading(true);
      try {
        const data = await apiRequest<{ payments: SupplierPaymentDTO[] }>(
          `/api/suppliers/${supplier.supplierId}/payments?page=${p + 1}`,
        );
        setLaterPayments(data.payments);
      } finally {
        setPaymentsLoading(false);
      }
    },
    [supplier.supplierId],
  );

  // Anything that settles the account changes what both tables hold, and the
  // refreshed props only reach page one, so both pagers go back to it.
  const refresh = useCallback(() => {
    setOrdersPage(0);
    setPaymentsPage(0);
    router.refresh();
  }, [router]);

  // Read straight from props rather than seeding state from them. Copying a prop
  // into useState freezes it at first mount, so router.refresh() would bring
  // fresh figures down and the cards would keep showing the old ones.
  const money = supplier.money;
  const balance = Number(money?.balance ?? 0);
  const inCredit = balance < 0;
  const broughtForward = Number(money?.openingBalance ?? 0);
  const credited = Number(money?.credited ?? 0);

  async function deletePayment(payment: SupplierPaymentDTO) {
    const what = payment.kind === "Credit" ? "credit note entry" : "payment";
    if (!window.confirm(`Delete the ${formatMoney(payment.amount)} ${what}?`)) {
      return;
    }
    setError(null);
    try {
      await apiRequest(
        `/api/suppliers/${supplier.supplierId}/payments/${payment.paymentId}`,
        { method: "DELETE" },
      );
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
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
            <Typography variant="h4">{supplier.name}</Typography>
            {!supplier.isActive && <Chip label="Inactive" />}
          </Stack>
          <Typography color="text.secondary">
            {[supplier.contactPerson, supplier.phone, supplier.email]
              .filter(Boolean)
              .join(" · ") || "No contact details"}
          </Typography>
        </Box>
        {canWrite && (
          <Stack direction="row" spacing={1}>
            {canRecordPayments && (
              <Button
                variant="contained"
                startIcon={<PaymentsIcon />}
                onClick={() => setPayOpen(true)}
              >
                Record payment
              </Button>
            )}
            {canRecordPayments && (
              <Button
                variant="outlined"
                startIcon={<ReceiptLongIcon />}
                onClick={() => setCreditOpen(true)}
              >
                Record credit
              </Button>
            )}
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={() => setEditOpen(true)}
            >
              Edit
            </Button>
          </Stack>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {showMoney && (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            mb: 2,
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, 1fr)",
              md: `repeat(${4 + (broughtForward !== 0 ? 1 : 0) + (credited !== 0 ? 1 : 0)}, 1fr)`,
            },
          }}
        >
          {/* Only shown when there is one. An account opened at zero does not
            need a row explaining itself. The date is whatever the balance was
            struck on, not a year end: plenty of accounts never close on one. */}
          {broughtForward !== 0 && (
            <StatCard
              label="Opening balance"
              value={formatMoney(money?.openingBalance)}
              hint={
                money?.openingBalanceAsOf
                  ? `As at ${formatDate(money.openingBalanceAsOf)}`
                  : undefined
              }
            />
          )}
          <StatCard
            label="Billed"
            value={formatMoney(money?.invoiced)}
            hint={`${money?.orderCount ?? 0} delivered order(s)`}
          />
          <StatCard label="Paid" value={formatMoney(money?.paid)} />
          {/* Only shown once a credit note exists. On an account that has never
            had one the card would be a permanent zero explaining nothing. */}
          {credited !== 0 && (
            <StatCard
              label="Credited"
              value={formatMoney(money?.credited)}
              hint="Settled by credit note, not cash"
            />
          )}
          {/* A negative balance is money paid with no bill to match it, which is a
            credit rather than a debt. Shown as such and flagged, not coloured
            green: unmatched cash needs looking at, it is not "settled". */}
          <StatCard
            label={inCredit ? "In credit" : "Owed now"}
            value={formatMoney(Math.abs(balance))}
            accent={inCredit ? "info" : balance > 0 ? "warning" : "success"}
            hint={
              broughtForward !== 0
                ? "Opening balance plus billed, less settled"
                : inCredit
                  ? "Settled more than has been billed"
                  : credited !== 0
                    ? "Billed, less paid and credited"
                    : "Billed minus paid"
            }
          />
          <StatCard
            label="In progress"
            value={formatMoney(money?.inProgress)}
            hint={`${money?.openOrderCount ?? 0} order(s) not yet delivered`}
          />
        </Box>
      )}

      {showMoney && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          An order counts as billed once it is Received, meaning fully delivered
          or closed short. Orders still in draft, placed or part-delivered show
          under In progress and are not owed yet.
          {broughtForward !== 0 &&
            " The opening balance is what the account stood at on the date it" +
              " was struck, so it counts towards the balance without having an" +
              " order here to point at."}
        </Typography>
      )}

      <Typography variant="h5" sx={{ mb: 2 }}>
        Contacts
      </Typography>
      <TableContainer component={Paper} sx={{ mb: 4 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Handles</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Email</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {supplier.contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No contacts yet. Add them from Edit.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              supplier.contacts.map((c) => (
                <TableRow key={c.contactId} hover>
                  <TableCell>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", flexWrap: "wrap" }}
                    >
                      <Typography variant="body2">{c.name}</Typography>
                      {c.isPrimary && <Chip size="small" label="Primary" />}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {c.role || (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                  {/* No categories means a general contact, typically whoever
                      settles the account rather than someone who sells. */}
                  <TableCell>
                    {c.categories.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        General
                      </Typography>
                    ) : (
                      <Stack
                        direction="row"
                        sx={{ flexWrap: "wrap", gap: 0.5 }}
                      >
                        {c.categories.map((category) => (
                          <Chip
                            key={category}
                            size="small"
                            variant="outlined"
                            label={category}
                          />
                        ))}
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.phone || (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.email || (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="h5" sx={{ mb: 2 }}>
        Orders
      </Typography>
      <TableContainer component={Paper} sx={{ mb: 4 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Order</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Placed</TableCell>
              <TableCell>Received</TableCell>
              <TableCell align="right">Items</TableCell>
              <TableCell align="right">Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No orders with this supplier yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => (
                <TableRow key={o.orderId} hover>
                  <TableCell>
                    <Link href={`/orders/${o.orderId}`}>
                      {o.reference || `Order #${o.orderId}`}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={ORDER_STATUS_COLOR[o.status]}
                      label={o.status}
                    />
                  </TableCell>
                  <TableCell>
                    {o.orderedOn ? formatDate(o.orderedOn) : "-"}
                  </TableCell>
                  <TableCell>
                    {o.receivedOn ? formatDate(o.receivedOn) : "-"}
                  </TableCell>
                  <TableCell align="right">{o.lineCount}</TableCell>
                  <TableCell align="right">{formatMoney(o.total)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePaginationBar
        page={ordersPage}
        count={ordersTotal}
        pageSize={pageSize}
        onChange={(p) => void loadOrders(p)}
        loading={ordersLoading}
        noun="orders"
      />

      {showMoney && (
        <Typography variant="h5" sx={{ mb: 2, mt: 2 }}>
          Payments
        </Typography>
      )}
      {showMoney && (
        <>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Kind</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Against</TableCell>
                  <TableCell>Method</TableCell>
                  <TableCell>Reference</TableCell>
                  <TableCell>Added by</TableCell>
                  {canWrite && <TableCell align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canWrite ? 8 : 7} align="center">
                      <Typography color="text.secondary" sx={{ py: 2 }}>
                        Nothing settled yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  payments.map((p) => (
                    <TableRow key={p.paymentId} hover>
                      <TableCell>{formatDate(p.paidOn)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={p.kind === "Credit" ? "info" : "default"}
                          label={SETTLEMENT_KIND_LABEL[p.kind]}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {formatMoney(p.amount)}
                      </TableCell>
                      <TableCell>
                        {p.orderId ? (
                          <Link href={`/orders/${p.orderId}`}>
                            {p.orderReference}
                          </Link>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            The account
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{p.method ?? "-"}</TableCell>
                      <TableCell>{p.reference ?? "-"}</TableCell>
                      <TableCell>{p.createdByName ?? "-"}</TableCell>
                      {canWrite && (
                        <TableCell align="right">
                          <Tooltip title="Delete">
                            <IconButton
                              size="small"
                              onClick={() => void deletePayment(p)}
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

          <TablePaginationBar
            page={paymentsPage}
            count={paymentsTotal}
            pageSize={pageSize}
            onChange={(p) => void loadPayments(p)}
            loading={paymentsLoading}
            noun="settlements"
          />
        </>
      )}

      <SupplierFormDialog
        open={editOpen}
        supplier={supplier}
        onClose={() => setEditOpen(false)}
        onSaved={refresh}
      />
      <SupplierPaymentFormDialog
        open={payOpen}
        supplierId={supplier.supplierId}
        supplierName={supplier.name}
        balance={money?.balance ?? "0"}
        payableOrders={payableOrders}
        onClose={() => setPayOpen(false)}
        onSaved={refresh}
      />
      <SupplierCreditFormDialog
        open={creditOpen}
        supplierId={supplier.supplierId}
        supplierName={supplier.name}
        balance={money?.balance ?? "0"}
        payableOrders={payableOrders}
        onClose={() => setCreditOpen(false)}
        onSaved={refresh}
      />
    </Box>
  );
}
