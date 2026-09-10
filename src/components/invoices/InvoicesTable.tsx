"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/ui/AppLink";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
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
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import MedicalServicesIcon from "@mui/icons-material/MedicalServices";
import { apiRequest } from "@/utils/api-client";
import { formatDate, formatMoney } from "@/utils/format";
import { INVOICE_STATUS_COLOR } from "@/constants/invoice";
import TablePaginationBar from "@/components/ui/TablePaginationBar";
import { INVOICE_STATUSES } from "@/types/enums";
import type { InvoiceDTO, InvoiceListItemDTO } from "@/types/entities";
import InvoiceFormDialog from "./InvoiceFormDialog";
import RegisterCloseDialog from "./RegisterCloseDialog";

interface Props {
  initialInvoices: InvoiceListItemDTO[];
  initialTotal: number;
  pageSize: number;
  canWrite: boolean;
}

export default function InvoicesTable({
  initialInvoices,
  initialTotal,
  pageSize,
  canWrite,
}: Props) {
  const router = useRouter();
  const [invoices, setInvoices] = useState(initialInvoices);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0); // MUI pagination is zero-based
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const firstRender = useRef(true);

  // Every filter runs in SQL, so the browser only ever holds one page.
  async function load(s: string, q: string, p: number) {
    const params = new URLSearchParams();
    if (s) params.set("status", s);
    if (q.trim()) params.set("q", q.trim());
    params.set("page", String(p + 1));
    setLoading(true);
    try {
      const data = await apiRequest<{
        invoices: InvoiceListItemDTO[];
        total: number;
      }>(`/api/invoices?${params}`);
      setInvoices(data.invoices);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => void load(status, query, page), 200);
    return () => clearTimeout(t);
    // load is recreated each render; the three values below are the real inputs.
  }, [status, query, page]);

  // A changed filter invalidates the current offset: page 12 of "all" is not
  // page 12 of "Overdue".
  function changeFilter(next: () => void) {
    setPage(0);
    next();
  }

  function handleCreated(invoice: InvoiceDTO) {
    router.push(`/invoices/${invoice.invoiceId}`);
  }

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Typography variant="h4">Invoices</Typography>
        <Stack direction="row" spacing={1}>
          <Button component={Link} href="/services" variant="outlined">
            Services
          </Button>
          <Button
            variant="outlined"
            startIcon={<PointOfSaleIcon />}
            onClick={() => setRegisterOpen(true)}
          >
            Close register
          </Button>
          {canWrite && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setDialogOpen(true)}
            >
              New invoice
            </Button>
          )}
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
        <TextField
          label="Search client or invoice no."
          value={query}
          onChange={(e) => changeFilter(() => setQuery(e.target.value))}
          size="small"
          sx={{ minWidth: 260 }}
        />
        <TextField
          select
          label="Status"
          value={status}
          onChange={(e) => changeFilter(() => setStatus(e.target.value))}
          size="small"
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All</MenuItem>
          {INVOICE_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Number</TableCell>
              <TableCell>Client</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell align="right">Balance</TableCell>
              <TableCell>Due</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No invoices found.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((inv) => (
                <TableRow key={inv.invoiceId} hover>
                  <TableCell>
                    <Link href={`/invoices/${inv.invoiceId}`}>
                      {inv.number}
                    </Link>
                  </TableCell>
                  <TableCell>{inv.clientName}</TableCell>
                  <TableCell>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", flexWrap: "wrap" }}
                    >
                      <Chip
                        size="small"
                        color={INVOICE_STATUS_COLOR[inv.status]}
                        label={inv.status}
                      />
                      {inv.isOverdue && (
                        <Chip size="small" color="error" label="Overdue" />
                      )}
                      {inv.onVetHold && (
                        <Chip
                          size="small"
                          color="warning"
                          icon={<MedicalServicesIcon />}
                          label="Vet hold"
                        />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">{formatMoney(inv.total)}</TableCell>
                  <TableCell align="right">
                    {formatMoney(inv.balance)}
                  </TableCell>
                  <TableCell>
                    {inv.dueDate ? formatDate(inv.dueDate) : "-"}
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
          noun="invoices"
        />
      </TableContainer>

      {/* Reading a day back is invoices:read, which every role that reaches
          this page already has. Filing the count is invoices:write: the same
          grant that lets someone take money at the counter lets them account
          for what left it. */}
      <RegisterCloseDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        canClose={canWrite}
      />

      <InvoiceFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={handleCreated}
      />
    </Box>
  );
}
