"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
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
import { rangeEndLabel, rangeQuery, rangeSummary } from "@/utils/date-range";
import StatCard from "@/components/ui/StatCard";
import DateRangeControl from "@/components/ui/DateRangeControl";
import type { AnalyticsRange, PartnerDTO } from "@/types/entities";
import PartnerFormDialog from "./PartnerFormDialog";
import PartnerGlossary from "./PartnerGlossary";
import OwedBreakdownCard from "./OwedBreakdownCard";

interface Props {
  initialPartners: PartnerDTO[];
  initialRange: AnalyticsRange;
  canWrite: boolean;
}

export default function PartnersTable({
  initialPartners,
  initialRange,
  canWrite,
}: Props) {
  const router = useRouter();
  const [partners, setPartners] = useState(initialPartners);
  const [range, setRange] = useState(initialRange);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PartnerDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  // A request id guards against out-of-order responses when the range is
  // changed rapidly, matching how the analytics sections handle it.
  function changeRange(next: AnalyticsRange) {
    setRange(next);
    const requestId = ++latest.current;
    setLoading(true);
    setError(null);

    const query = rangeQuery(next);
    // Reflect the range in the URL so a reload keeps it. replaceState rather
    // than a router navigation: the data is already being fetched just below,
    // and routing would re-run the server page on top of that for nothing.
    window.history.replaceState(null, "", `?${query}`);

    apiRequest<{ partners: PartnerDTO[] }>(`/api/partners?${query}`)
      .then((res) => {
        if (requestId === latest.current) setPartners(res.partners);
      })
      .catch((err: unknown) => {
        if (requestId === latest.current) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      })
      .finally(() => {
        if (requestId === latest.current) setLoading(false);
      });
  }

  const totals = useMemo(() => {
    let revenue = 0;
    let grossProfit = 0;
    let partnerShare = 0;
    let clinicShare = 0;
    let owed = 0;
    let capitalOwed = 0;
    let profitOwed = 0;
    let profitShareToDate = 0;
    let earnedToDate = 0;
    let paidToDate = 0;
    let capitalDeployed = 0;
    let capitalOnShelf = 0;
    for (const p of partners) {
      const m = p.money;
      if (!m) continue;
      revenue += Number(m.revenue);
      grossProfit += Number(m.grossProfit);
      partnerShare += Number(m.partnerShare);
      clinicShare += Number(m.clinicShare);
      owed += Number(m.balance);
      capitalOwed += Number(m.capitalOwed);
      profitOwed += Number(m.profitOwed);
      profitShareToDate += Number(m.profitShareToDate);
      earnedToDate += Number(m.earnedToDate);
      paidToDate += Number(m.paidToDate);
      capitalDeployed += Number(m.capitalDeployed);
      capitalOnShelf += Number(m.capitalOnShelf);
    }
    return {
      revenue,
      grossProfit,
      partnerShare,
      clinicShare,
      owed,
      capitalOwed,
      profitOwed,
      profitShareToDate,
      earnedToDate,
      paidToDate,
      capitalDeployed,
      capitalOnShelf,
    };
  }, [partners]);

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(partner: PartnerDTO) {
    setEditing(partner);
    setDialogOpen(true);
  }

  async function handleDelete(partner: PartnerDTO) {
    if (
      !window.confirm(
        `Remove ${partner.name}? Their sales history and balance stay on record.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await apiRequest(`/api/partners/${partner.partnerId}`, {
        method: "DELETE",
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    }
  }

  const period = rangeSummary(range).toLowerCase();
  const asOf = rangeEndLabel(range);

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 0.5 }}
      >
        <Typography variant="h4">Partners</Typography>
        {canWrite && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>
            New partner
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        People who fund stock for the clinic. When their items sell they get an
        agreed share of their capital back plus an agreed share of the profit.
      </Typography>

      <PartnerGlossary />

      <Box sx={{ mb: 2 }}>
        <DateRangeControl
          range={range}
          onChange={changeRange}
          disabled={loading}
        />
      </Box>
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Two rows, deliberately separated, because they answer different
          questions: the first is flow, what the partners' stock did over the
          chosen period, the second is position, where the money stood at the
          end of it. Both move with the range, but only the second is cumulative
          from the beginning of time up to that date. */}
      <Typography variant="overline" color="text.secondary">
        Performance ({period})
      </Typography>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          mb: 2,
          mt: 0.5,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(4, 1fr)" },
        }}
      >
        <StatCard label="Revenue" value={formatMoney(totals.revenue)} />
        <StatCard
          label="Gross profit"
          value={formatMoney(totals.grossProfit)}
          hint="Revenue minus cost"
        />
        <StatCard
          label="Partners' share"
          value={formatMoney(totals.partnerShare)}
        />
        <StatCard
          label="Clinic's share"
          value={formatMoney(totals.clinicShare)}
          accent={totals.clinicShare < 0 ? "error" : "success"}
        />
      </Box>

      <Typography variant="overline" color="text.secondary">
        Position (as at {asOf})
      </Typography>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          mb: 2,
          mt: 0.5,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
        }}
      >
        <StatCard
          label="Capital deployed"
          value={formatMoney(totals.capitalDeployed)}
          accent="info"
          hint={`Partners' money in, up to ${asOf}`}
        />
        <StatCard
          label="Still in stock"
          value={formatMoney(totals.capitalOnShelf)}
          hint="Of that, not yet returned to them"
        />
        <OwedBreakdownCard
          balance={String(totals.owed)}
          capitalOwed={String(totals.capitalOwed)}
          profitOwed={String(totals.profitOwed)}
          profitShareToDate={String(totals.profitShareToDate)}
          earnedToDate={String(totals.earnedToDate)}
          paidToDate={String(totals.paidToDate)}
          asOf={asOf}
        />
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Partner</TableCell>
              <TableCell align="right">Deal</TableCell>
              <TableCell align="right">Sold</TableCell>
              <TableCell align="right">Revenue</TableCell>
              <TableCell align="right">Cost</TableCell>
              <TableCell align="right">Gross profit</TableCell>
              <TableCell align="right">Their share</TableCell>
              <TableCell align="right">Clinic share</TableCell>
              <TableCell align="right">Capital</TableCell>
              <TableCell align="right">Owed now</TableCell>
              {canWrite && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {partners.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 11 : 10} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No partners yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              partners.map((p) => (
                <TableRow key={p.partnerId} hover>
                  <TableCell>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", flexWrap: "wrap" }}
                    >
                      {/* Carry the range through so the detail page opens on
                          the same period these figures are showing. */}
                      <Link
                        href={`/partners/${p.partnerId}?${rangeQuery(range)}`}
                      >
                        {p.name}
                      </Link>
                      {!p.isActive && <Chip size="small" label="Inactive" />}
                    </Stack>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                    >
                      {p.itemCount ?? 0} items
                      {p.phone ? ` · ${p.phone}` : ""}
                    </Typography>
                  </TableCell>
                  {/* Both halves, so a deal is never read as just one rate. */}
                  <TableCell align="right">
                    {p.defaultCostPct}% + {p.defaultProfitPct}%
                  </TableCell>
                  <TableCell align="right">{p.money?.unitsSold ?? 0}</TableCell>
                  <TableCell align="right">
                    {formatMoney(p.money?.revenue)}
                  </TableCell>
                  <TableCell align="right">
                    {formatMoney(p.money?.costOfSales)}
                  </TableCell>
                  <TableCell align="right">
                    {formatMoney(p.money?.grossProfit)}
                  </TableCell>
                  <TableCell align="right">
                    {formatMoney(p.money?.partnerShare)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      color:
                        Number(p.money?.clinicShare ?? 0) < 0
                          ? "error.main"
                          : undefined,
                    }}
                  >
                    {formatMoney(p.money?.clinicShare)}
                  </TableCell>
                  <TableCell align="right">
                    {formatMoney(p.money?.capitalDeployed)}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                    >
                      {formatMoney(p.money?.capitalOnShelf)} in stock
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600,
                        color:
                          Number(p.money?.balance ?? 0) > 0
                            ? "warning.main"
                            : undefined,
                      }}
                    >
                      {formatMoney(p.money?.balance)}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                    >
                      {formatMoney(p.money?.capitalOwed)} capital,{" "}
                      {formatMoney(p.money?.profitOwed)} profit
                    </Typography>
                  </TableCell>
                  {canWrite && (
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(p)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remove">
                        <IconButton
                          size="small"
                          onClick={() => void handleDelete(p)}
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
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 1 }}
      >
        Sold, revenue, cost, profit and both shares cover {period}. Capital and
        Owed are balances, so they count everything up to {asOf}.
      </Typography>

      <PartnerFormDialog
        open={dialogOpen}
        partner={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={() => router.refresh()}
      />
    </Box>
  );
}
