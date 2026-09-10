"use client";

import Link from "@/components/ui/AppLink";
import {
  Alert,
  Button,
  Checkbox,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import { BarChart } from "@mui/x-charts/BarChart";
import { PieChart } from "@mui/x-charts/PieChart";
import { useState } from "react";
import { useAnalyticsSection } from "@/hooks/useAnalyticsSection";
import { formatDate } from "@/utils/format";
import { formatRangeLabel, rangeSummary } from "@/utils/date-range";
import DateRangeControl from "@/components/ui/DateRangeControl";
import DownloadCsvButton from "@/components/ui/DownloadCsvButton";
import OfferPickerDialog from "@/components/offers/OfferPickerDialog";
import CollapsibleSection from "@/components/ui/CollapsibleSection";
import {
  CHART_HEIGHT,
  ChartCard,
  ChartGrid,
  EmptyChart,
  KpiCard,
  KpiGrid,
  SectionPlaceholder,
  money,
  toPieData,
} from "./AnalyticsPrimitives";
import type {
  AnalyticsRange,
  ClientActivityRow,
  ClientsAnalytics,
} from "@/types/entities";
import type { ClientListKind } from "@/schemas/analytics";

// The day a client was last seen. One who has never been billed and never had
// an appointment is told so, rather than shown a blank cell that reads as
// missing data instead of as a fact.
function LastActivity({ date }: { date: string | null }) {
  if (!date) {
    return (
      <Typography variant="body2" color="text.secondary" component="span">
        Never
      </Typography>
    );
  }
  return <>{formatDate(date)}</>;
}

// A client's name, linked to their record. Every one of these lists is read in
// order to go and do something about one of the rows.
function ClientLink({ row }: { row: ClientActivityRow }) {
  return (
    <Link
      href={`/clients/${row.clientId}`}
      style={{ color: "inherit", textDecoration: "none" }}
    >
      {row.name || `Client ${row.clientId}`}
    </Link>
  );
}

// Under each table: what is on screen against what the file holds, so nobody
// reads ten rows as the whole answer.
function ListFooter({ shown, total }: { shown: number; total: number }) {
  if (total === 0) return null;
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ display: "block", mt: 1 }}
    >
      {shown < total
        ? `Showing ${shown} of ${total}. Download for the full list.`
        : `${total} client${total === 1 ? "" : "s"}.`}
    </Typography>
  );
}

function EmptyRow({ span, children }: { span: number; children: string }) {
  return (
    <TableRow>
      <TableCell colSpan={span}>
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          {children}
        </Typography>
      </TableCell>
    </TableRow>
  );
}

// The download icon on a list card. The file is built by the server for the
// dates on screen, so it holds every row rather than the page above it.
function ListDownload({
  list,
  range,
  title,
  empty,
}: {
  list: ClientListKind;
  range: AnalyticsRange;
  title: string;
  empty: boolean;
}) {
  const query = new URLSearchParams({ list, from: range.from, to: range.to });
  return (
    <DownloadCsvButton
      url={`/api/analytics/clients/export?${query.toString()}`}
      filename={`${list}-clients-${range.from}-to-${range.to}.csv`}
      title={title}
      disabled={empty}
    />
  );
}

// Who spent the most over the dates the section is set to. Walk-ins are absent
// by construction: a counter sale belongs to no account.
//
// Rows are selectable so an offer can be given to several at once. One button
// for the whole selection rather than an Apply on every row: rewarding the top
// ten is one decision, and ten dialogs is not how anyone would take it.
function TopClientsCard({
  rows,
  total,
  range,
  canGrantOffer,
  canManageOffers,
}: {
  rows: ClientActivityRow[];
  total: number;
  range: AnalyticsRange;
  canGrantOffer: boolean;
  canManageOffers: boolean;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const allPicked = rows.length > 0 && picked.length === rows.length;

  function toggle(clientId: number) {
    setPicked((prev) =>
      prev.includes(clientId)
        ? prev.filter((id) => id !== clientId)
        : [...prev, clientId],
    );
  }

  return (
    <ChartCard
      title="Top clients"
      full
      action={
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {canGrantOffer && (
            <Button
              size="small"
              startIcon={<LocalOfferIcon />}
              disabled={picked.length === 0}
              onClick={() => setPickerOpen(true)}
            >
              {picked.length > 0
                ? `Apply offer (${picked.length})`
                : "Apply offer"}
            </Button>
          )}
          <ListDownload
            list="top"
            range={range}
            title="Download every client billed in these dates"
            empty={total === 0}
          />
        </Stack>
      }
    >
      {note && (
        <Alert
          severity="success"
          sx={{ mb: 1.5 }}
          onClose={() => setNote(null)}
        >
          {note}
        </Alert>
      )}
      <Table size="small">
        <TableHead>
          <TableRow>
            {canGrantOffer && (
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={allPicked}
                  indeterminate={picked.length > 0 && !allPicked}
                  disabled={rows.length === 0}
                  onChange={() =>
                    setPicked(allPicked ? [] : rows.map((r) => r.clientId))
                  }
                  slotProps={{
                    input: { "aria-label": "Select every client shown" },
                  }}
                />
              </TableCell>
            )}
            <TableCell>Client</TableCell>
            <TableCell>Phone</TableCell>
            <TableCell align="right">Invoices</TableCell>
            <TableCell align="right">Billed</TableCell>
            <TableCell align="right">Last activity</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow span={canGrantOffer ? 6 : 5}>
              Nobody was billed in these dates.
            </EmptyRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.clientId} hover>
                {canGrantOffer && (
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={picked.includes(row.clientId)}
                      onChange={() => toggle(row.clientId)}
                      slotProps={{
                        input: { "aria-label": `Select ${row.name}` },
                      }}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <ClientLink row={row} />
                </TableCell>
                <TableCell>{row.phone ?? "-"}</TableCell>
                <TableCell align="right">{row.invoices}</TableCell>
                <TableCell align="right">{money(row.billed)}</TableCell>
                <TableCell align="right">
                  <LastActivity date={row.lastActivity} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <ListFooter shown={rows.length} total={total} />

      <OfferPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        clientIds={picked}
        clientLabel={
          picked.length === 1 ? "1 client" : `${picked.length} clients`
        }
        canManage={canManageOffers}
        onGranted={(result) => {
          // Says what actually happened. Granting the same offer to the same
          // list twice adds nothing, and reporting it as a fresh success would
          // be how someone ends up believing they discounted twice.
          setNote(
            [
              result.granted > 0
                ? `${result.offerName} given to ${result.granted} client${result.granted === 1 ? "" : "s"}.`
                : null,
              result.alreadyHeld > 0
                ? `${result.alreadyHeld} already had it.`
                : null,
            ]
              .filter(Boolean)
              .join(" "),
          );
          setPicked([]);
        }}
      />
    </ChartCard>
  );
}

// Who was not seen at all over those dates. The recall list: most recently seen
// first, because the freshest lapses are the ones still worth a phone call.
function LapsedClientsCard({
  rows,
  total,
  range,
}: {
  rows: ClientActivityRow[];
  total: number;
  range: AnalyticsRange;
}) {
  return (
    <ChartCard
      title="Lapsed clients"
      full
      action={
        <ListDownload
          list="lapsed"
          range={range}
          title="Download every client not seen in these dates"
          empty={total === 0}
        />
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        On file, with no invoice and no appointment between{" "}
        {formatRangeLabel(range)}. Most recently seen first. Lifetime billed is
        everything they have ever been charged, so the list can be worked from
        the top or by what the clinic stands to lose.
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Client</TableCell>
            <TableCell>Phone</TableCell>
            <TableCell align="right">Last activity</TableCell>
            <TableCell align="right">Lifetime billed</TableCell>
            <TableCell align="right">Balance</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow span={5}>
              Every client on file was seen in these dates.
            </EmptyRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.clientId} hover>
                <TableCell>
                  <ClientLink row={row} />
                </TableCell>
                <TableCell>{row.phone ?? "-"}</TableCell>
                <TableCell align="right">
                  <LastActivity date={row.lastActivity} />
                </TableCell>
                <TableCell align="right">{money(row.lifetimeBilled)}</TableCell>
                <TableCell align="right">{money(row.accountBalance)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <ListFooter shown={rows.length} total={total} />
    </ChartCard>
  );
}

// Clients and patients.
//
// The head-count figures are a position and stay a snapshot of right now: how
// many clients are on file, how many animals, and how many animals each. What
// happened to those clients is a flow, so the two lists, the lapsed count and
// the new-clients trend all follow the dates picked at the top of the section.
//
// The section opens on a year rather than on the current month. "Who has not
// been in this month" is very nearly the entire client book, and a recall list
// that long is not a list.
//
// The lists arrive null for a reader allowed into analytics but not into client
// records, in which case the counts are shown without the names behind them.
export default function ClientsSection({
  initialRange,
  canGrantOffer,
  canManageOffers,
}: {
  initialRange: AnalyticsRange;
  canGrantOffer: boolean;
  canManageOffers: boolean;
}) {
  const { range, data, loading, error, setRange, load } =
    useAnalyticsSection<ClientsAnalytics>("clients", initialRange);

  return (
    <CollapsibleSection
      title="Clients & patients"
      subtitle={`Head count now, activity ${rangeSummary(range).toLowerCase()}`}
      loading={loading}
      onExpand={load}
      controls={<DateRangeControl range={range} onChange={setRange} />}
    >
      {data ? (
        <>
          <KpiGrid>
            <KpiCard
              label="Active clients"
              value={String(data.totalActive)}
              hint="On file today"
            />
            <KpiCard
              label="New in period"
              value={String(data.newInPeriod)}
              hint={formatRangeLabel(range)}
            />
            <KpiCard
              label="Lapsed"
              value={String(data.lapsed)}
              hint="No visit in this period"
            />
            <KpiCard
              label="Total patients"
              value={String(data.totalPatients)}
            />
            <KpiCard
              label="Patients / client"
              value={String(data.avgPatientsPerClient)}
            />
          </KpiGrid>

          <ChartGrid>
            <ChartCard title="New clients">
              <BarChart
                height={CHART_HEIGHT}
                xAxis={[
                  {
                    data: data.newTrend.map((t) => t.label),
                    scaleType: "band",
                  },
                ]}
                series={[
                  {
                    data: data.newTrend.map((t) => t.count),
                    label: "New clients",
                  },
                ]}
              />
            </ChartCard>

            <ChartCard title="Patients by species">
              {data.speciesMix.length > 0 ? (
                <PieChart
                  height={CHART_HEIGHT}
                  series={[{ data: toPieData(data.speciesMix) }]}
                />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>

            {data.topClients && (
              <TopClientsCard
                rows={data.topClients}
                total={data.tradingCount}
                range={range}
                canGrantOffer={canGrantOffer}
                canManageOffers={canManageOffers}
              />
            )}

            {data.lapsedClients && (
              <LapsedClientsCard
                rows={data.lapsedClients}
                total={data.lapsed}
                range={range}
              />
            )}
          </ChartGrid>
        </>
      ) : (
        <SectionPlaceholder error={error} />
      )}
    </CollapsibleSection>
  );
}
