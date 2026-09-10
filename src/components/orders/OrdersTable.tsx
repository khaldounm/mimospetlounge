"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/ui/AppLink";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import DescriptionIcon from "@mui/icons-material/Description";
import AddIcon from "@mui/icons-material/Add";
import { formatDate, formatMoney } from "@/utils/format";
import StatCard from "@/components/ui/StatCard";
import TablePaginationBar from "@/components/ui/TablePaginationBar";
import { apiRequest } from "@/utils/api-client";
import NewOrderDialog from "./NewOrderDialog";
import {
  ORDER_STATUS_COLOR,
  NO_SUPPLIER_LABEL,
  UNCATEGORISED_ORDER_LABEL,
  type OrderStatusFilter,
} from "@/constants/order";
import type { OrderTotals } from "@/lib/purchase-orders";
import type { PurchaseOrderDTO, SupplierDTO } from "@/types/entities";

interface Props {
  initialOrders: PurchaseOrderDTO[];
  /** How many orders match the initial filter, across every page. */
  initialTotal: number;
  initialFilter: OrderStatusFilter;
  pageSize: number;
  /** Counts and value for the whole open book, not just the page on screen. */
  totals: OrderTotals;
  suppliers: SupplierDTO[];
  // payables:read. The statement is accounts payable, so without it the button
  // would only lead to a redirect back out of the page.
  showStatement: boolean;
}

interface SupplierGroup {
  key: string;
  supplierName: string;
  orders: PurchaseOrderDTO[];
  value: number;
}

export default function OrdersTable({
  initialOrders,
  initialTotal,
  initialFilter,
  pageSize,
  totals,
  suppliers,
  showStatement,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [orders, setOrders] = useState(initialOrders);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0); // zero-based, matching the pager
  const [loading, setLoading] = useState(false);
  // "Open" is the working view: everything still in flight. The terminal
  // statuses are one click away rather than cluttering the default.
  const [filter, setFilter] = useState<OrderStatusFilter>(initialFilter);
  const firstRender = useRef(true);

  const load = useCallback(async (f: OrderStatusFilter, p: number) => {
    const params = new URLSearchParams({
      status: f,
      page: String(p + 1),
    });
    setLoading(true);
    try {
      const data = await apiRequest<{
        orders: PurchaseOrderDTO[];
        total: number;
      }>(`/api/orders?${params}`);
      setOrders(data.orders);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, []);

  // The first page came down with the document, so only a change from here
  // needs a fetch.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void load(filter, page);
  }, [filter, page, load]);

  // Group the page by supplier, orders inside each group already sorted newest
  // first by the server. The unassigned bucket is pinned to the top: it is the
  // one that needs a decision before anything can be ordered.
  //
  // Grouping is per page, so a supplier with orders either side of a page
  // boundary heads a group on both. The alternative is paging by supplier,
  // which would put an unbounded number of orders back on one page.
  const groups = useMemo(() => {
    const map = new Map<string, SupplierGroup>();
    for (const order of orders) {
      const key = order.supplierId == null ? "none" : String(order.supplierId);
      const group = map.get(key);
      if (group) {
        group.orders.push(order);
        group.value += Number(order.total);
      } else {
        map.set(key, {
          key,
          supplierName: order.supplierName ?? NO_SUPPLIER_LABEL,
          orders: [order],
          value: Number(order.total),
        });
      }
    }

    return [...map.values()].sort((a, b) => {
      if (a.key === "none") return -1;
      if (b.key === "none") return 1;
      return a.supplierName.localeCompare(b.supplierName);
    });
  }, [orders]);

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 0.5 }}
      >
        <Typography variant="h4">Orders</Typography>
        <Stack direction="row" spacing={1}>
          {showStatement && (
            <Button
              component={Link}
              href="/orders/statement"
              variant="outlined"
              startIcon={<DescriptionIcon />}
            >
              Statement
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreating(true)}
          >
            New order
          </Button>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Reorder sheets, one per supplier and product line, so each rep gets the
        sheet they handle. Add low-stock items from Inventory or start an order
        by hand, then place it and receive it when the stock arrives.
      </Typography>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          mb: 2,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
        }}
      >
        <StatCard label="Open drafts" value={String(totals.drafts)} />
        <StatCard
          label="Awaiting delivery"
          value={String(totals.awaiting)}
          accent={totals.awaiting > 0 ? "info" : undefined}
          hint="Placed or part-delivered"
        />
        <StatCard label="Draft value" value={formatMoney(totals.draftValue)} />
      </Box>

      <ToggleButtonGroup
        exclusive
        size="small"
        value={filter}
        onChange={(_e, next: OrderStatusFilter | null) => {
          if (!next) return;
          // A new filter invalidates the current offset.
          setPage(0);
          setFilter(next);
        }}
        sx={{ mb: 2, flexWrap: "wrap" }}
      >
        <ToggleButton value="Open">Open</ToggleButton>
        <ToggleButton value="Draft">Draft</ToggleButton>
        <ToggleButton value="Placed">Placed</ToggleButton>
        <ToggleButton value="Partial">Partial</ToggleButton>
        <ToggleButton value="Received">Received</ToggleButton>
        <ToggleButton value="Cancelled">Cancelled</ToggleButton>
      </ToggleButtonGroup>

      {groups.length === 0 && !loading ? (
        <Paper variant="outlined" sx={{ p: 4 }}>
          <Typography color="text.secondary" align="center">
            No orders here yet. Tick low-stock items in Inventory and choose Add
            to future order, or start one by hand with New order.
          </Typography>
        </Paper>
      ) : (
        groups.map((group) => (
          <Accordion
            key={`${group.key}-${filter}`}
            defaultExpanded
            disableGutters
            elevation={0}
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 2,
              mb: 1.5,
              "&:before": { display: "none" },
              "&:first-of-type": { borderRadius: 2 },
              "&:last-of-type": { borderRadius: 2 },
              "&.Mui-expanded": { mb: 1.5 },
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2 }}>
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                <Typography sx={{ fontWeight: 600 }}>
                  {group.supplierName}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {group.orders.length}
                  {group.orders.length === 1 ? " order" : " orders"}
                </Typography>
                {group.key === "none" && (
                  <Chip
                    size="small"
                    color="warning"
                    label="Assign a supplier to order"
                  />
                )}
                <Typography variant="body2" color="text.secondary">
                  {formatMoney(group.value)}
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Order</TableCell>
                      <TableCell>Category</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Started</TableCell>
                      <TableCell>Placed</TableCell>
                      <TableCell>Received</TableCell>
                      <TableCell align="right">Items</TableCell>
                      <TableCell align="right">Total</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {group.orders.map((o) => (
                      <TableRow key={o.orderId} hover>
                        <TableCell>
                          <Link href={`/orders/${o.orderId}`}>
                            {o.reference || `Order #${o.orderId}`}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {o.category ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={o.category}
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              {UNCATEGORISED_ORDER_LABEL}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            color={ORDER_STATUS_COLOR[o.status]}
                            label={o.status}
                          />
                        </TableCell>
                        <TableCell>{formatDate(o.createdAt)}</TableCell>
                        <TableCell>
                          {o.orderedOn ? formatDate(o.orderedOn) : "-"}
                        </TableCell>
                        <TableCell>
                          {o.receivedOn ? formatDate(o.receivedOn) : "-"}
                        </TableCell>
                        <TableCell align="right">{o.lineCount}</TableCell>
                        <TableCell align="right">
                          {formatMoney(o.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </AccordionDetails>
          </Accordion>
        ))
      )}

      <TablePaginationBar
        page={page}
        count={total}
        pageSize={pageSize}
        onChange={setPage}
        loading={loading}
        noun="orders"
      />

      <NewOrderDialog
        open={creating}
        suppliers={suppliers}
        onClose={() => setCreating(false)}
      />
    </Box>
  );
}
