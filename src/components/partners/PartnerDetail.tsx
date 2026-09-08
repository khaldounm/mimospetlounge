"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import PaymentsIcon from "@mui/icons-material/Payments";
import { apiRequest } from "@/utils/api-client";
import { formatMoney } from "@/utils/format";
import { rangeEndLabel, rangeQuery, rangeSummary } from "@/utils/date-range";
import StatCard from "@/components/ui/StatCard";
import DateRangeControl from "@/components/ui/DateRangeControl";
import { usePartnerLedger } from "@/hooks/usePartnerLedger";
import type {
  AnalyticsRange,
  PartnerDTO,
  PartnerEarningDTO,
  PartnerItemPerformanceDTO,
  PartnerPayoutDTO,
} from "@/types/entities";
import PartnerFormDialog from "./PartnerFormDialog";
import PartnerPayoutFormDialog from "./PartnerPayoutFormDialog";
import PartnerGlossary from "./PartnerGlossary";
import OwedBreakdownCard from "./OwedBreakdownCard";
import PartnerDaysCard from "./PartnerDaysCard";
import PartnerSalesSection from "./PartnerSalesSection";
import PartnerPayoutsSection from "./PartnerPayoutsSection";
import PartnerItemsSection from "./PartnerItemsSection";

interface Props {
  partner: PartnerDTO;
  initialRange: AnalyticsRange;
  canWrite: boolean;
}

interface HeaderResponse {
  partner: PartnerDTO;
}

export default function PartnerDetail({
  partner: initialPartner,
  initialRange,
  canWrite,
}: Props) {
  const router = useRouter();
  const [partner, setPartner] = useState(initialPartner);
  const [range, setRange] = useState(initialRange);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const latest = useRef(0);

  // The three ledgers live here because they all follow one date range. Each
  // stays silent until its own section is opened, so owning them costs nothing.
  const partnerId = partner.partnerId;
  const sales = usePartnerLedger<PartnerEarningDTO>(
    partnerId,
    "sales",
    initialRange,
  );
  const payouts = usePartnerLedger<PartnerPayoutDTO>(
    partnerId,
    "payouts",
    initialRange,
  );
  const items = usePartnerLedger<PartnerItemPerformanceDTO>(
    partnerId,
    "items",
    initialRange,
  );

  const money = partner.money;
  const period = rangeSummary(range).toLowerCase();
  const asOf = rangeEndLabel(range);

  // Refetches the header figures. The three ledgers below follow `range` on
  // their own, and each one refetches only if it is open, so changing the dates
  // costs nothing for a section nobody has looked at.
  const reloadHeader = useCallback(
    (next: AnalyticsRange) => {
      const requestId = ++latest.current;
      setLoading(true);
      setError(null);

      apiRequest<HeaderResponse>(
        `/api/partners/${partnerId}?${rangeQuery(next)}`,
      )
        .then((res) => {
          if (requestId !== latest.current) return;
          setPartner(res.partner);
        })
        .catch((err: unknown) => {
          if (requestId === latest.current) {
            setError(err instanceof Error ? err.message : "Failed to load");
          }
        })
        .finally(() => {
          if (requestId === latest.current) setLoading(false);
        });
    },
    [partnerId],
  );

  function changeRange(next: AnalyticsRange) {
    setRange(next);
    // Keep the URL in step so a reload, or a back into this page, stays on the
    // period being read. See the note in PartnersTable on replaceState.
    window.history.replaceState(null, "", `?${rangeQuery(next)}`);
    reloadHeader(next);
    // Each of these refetches only if its section is open. A closed one just
    // records the new dates and fetches them if it is ever opened.
    sales.setRange(next);
    payouts.setRange(next);
    items.setRange(next);
  }

  // Recording or deleting a payout moves the balance and changes the payout
  // ledger. The figures live in state (the range picker needs them to), and
  // router.refresh() alone only replaces props, so the cards would otherwise
  // keep showing the balance from before it happened.
  const payoutChanged = useCallback(() => {
    reloadHeader(range);
    payouts.reload();
    router.refresh();
  }, [reloadHeader, range, payouts, router]);

  const sellThrough = Number(money?.sellThroughPct ?? 0);
  const hasGuarantee = Number(money?.guaranteeEarned ?? 0) !== 0;
  // A partner who only consigns stock has nothing to say here, and an empty
  // services row on every one of their periods is noise.
  const hasServices =
    Number(money?.serviceRevenue ?? 0) !== 0 ||
    Number(money?.serviceEarned ?? 0) !== 0 ||
    hasGuarantee;

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
            <Typography variant="h4">{partner.name}</Typography>
            {!partner.isActive && <Chip label="Inactive" />}
          </Stack>
          <Typography color="text.secondary">
            {partner.defaultCostPct}% of cost + {partner.defaultProfitPct}% of
            profit
            {partner.phone ? ` · ${partner.phone}` : ""}
          </Typography>
        </Box>
        {canWrite && (
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              startIcon={<PaymentsIcon />}
              onClick={() => setPayoutOpen(true)}
            >
              Record payout
            </Button>
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

      <PartnerDaysCard
        partnerId={partner.partnerId}
        dailyMinimum={partner.dailyMinimum}
        canWrite={canWrite}
      />

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

      <Typography variant="overline" color="text.secondary">
        Inventory ({period})
      </Typography>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          mb: 2,
          mt: 0.5,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            md: "repeat(4, 1fr)",
          },
        }}
      >
        <StatCard
          label="Revenue"
          value={formatMoney(money?.revenue)}
          hint={`${money?.unitsSold ?? 0} units sold`}
        />
        <StatCard
          label="Cost of sales"
          value={formatMoney(money?.costOfSales)}
          hint="What the stock cost them"
        />
        <StatCard
          label="Gross profit"
          value={formatMoney(money?.grossProfit)}
          hint="Revenue minus cost"
        />
        <StatCard
          label="Split"
          value={`${formatMoney(money?.partnerShare)} / ${formatMoney(money?.clinicShare)}`}
          hint="Theirs / clinic's"
          accent={Number(money?.clinicShare ?? 0) < 0 ? "error" : "success"}
        />
      </Box>

      {/* Services stated the same way the stock above is: billed, their cut,
          what the clinic kept. Range-scoped, so it answers "what did they earn
          on services" for whatever period is set rather than accumulating in a
          corner forever. Hidden outright for a pure consignment partner, who
          has no services and no guarantee to report. */}
      {hasServices && (
        <>
          <Typography variant="overline" color="text.secondary">
            Services ({period})
          </Typography>
          <Box
            sx={{
              display: "grid",
              gap: 2,
              mb: 2,
              mt: 0.5,
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, 1fr)",
                md: "repeat(4, 1fr)",
              },
            }}
          >
            <StatCard
              label="Billed"
              value={formatMoney(money?.serviceRevenue)}
              hint="What customers paid for work they performed"
            />
            <StatCard
              label="Split"
              value={`${formatMoney(money?.serviceEarned)} / ${formatMoney(money?.serviceClinicShare)}`}
              hint="Theirs / clinic's"
              accent={
                Number(money?.serviceClinicShare ?? 0) < 0 ? "error" : "success"
              }
            />
            {hasGuarantee && (
              <StatCard
                label="Day guarantee"
                value={formatMoney(money?.guaranteeEarned)}
                hint="Topped up on settled days below their minimum"
              />
            )}
          </Box>
        </>
      )}

      <Typography variant="overline" color="text.secondary">
        Position (as at {asOf})
      </Typography>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          mb: 2,
          mt: 0.5,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            md: "repeat(4, 1fr)",
          },
        }}
      >
        <StatCard
          label="Capital deployed"
          value={formatMoney(money?.capitalDeployed)}
          accent="info"
          hint={`Their money in, up to ${asOf}`}
        />
        <StatCard
          label="Recovered by sales"
          value={formatMoney(money?.capitalRecoveredToDate)}
          hint="Of that, freed up by selling"
        />
        <StatCard
          label="Still in stock"
          value={formatMoney(money?.capitalOnShelf)}
          hint="Of that, not yet sold"
        />
        <OwedBreakdownCard
          balance={money?.balance}
          capitalOwed={money?.capitalOwed}
          profitOwed={money?.profitOwed}
          profitShareToDate={money?.profitShareToDate}
          earnedToDate={money?.earnedToDate}
          paidToDate={money?.paidToDate}
          asOf={asOf}
        />
      </Box>

      <Paper variant="outlined" sx={{ p: 2, mb: 4 }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", mb: 1 }}>
          <Typography variant="body2">Sell-through</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {sellThrough}%
          </Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, Math.max(0, sellThrough))}
          sx={{ height: 8, borderRadius: 1 }}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 1 }}
        >
          Share of everything this partner had funded as at {asOf} that had come
          back through sales. The rest was still sitting in stock.
        </Typography>
      </Paper>

      {/* Three ledgers, each collapsed and each fetching its own page the
          first time it is opened. By item comes last: it lists every line the
          partner sources whether it sold or not, so it is the longest table
          here and the least often the reason someone opened the page. */}
      <PartnerSalesSection
        ledger={sales}
        range={range}
        lastMovementAt={partner.lastMovementAt}
      />
      <PartnerPayoutsSection
        partnerId={partnerId}
        ledger={payouts}
        range={range}
        canWrite={canWrite}
        onChanged={payoutChanged}
      />
      <PartnerItemsSection ledger={items} range={range} />

      <PartnerFormDialog
        open={editOpen}
        partner={partner}
        onClose={() => setEditOpen(false)}
        onSaved={() => router.refresh()}
      />
      <PartnerPayoutFormDialog
        open={payoutOpen}
        partnerId={partner.partnerId}
        partnerName={partner.name}
        balance={money?.balance ?? "0"}
        onClose={() => setPayoutOpen(false)}
        onSaved={payoutChanged}
      />
    </Box>
  );
}
