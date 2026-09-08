"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { apiRequest } from "@/utils/api-client";
import { formatMoney, formatWeekdayDate } from "@/utils/format";
import CollapsibleSection from "@/components/ui/CollapsibleSection";
import type { PartnerDayDTO } from "@/types/entities";

type Action = "attend" | "absent" | "settle" | "unsettle";

// A settled day whose frozen top-up no longer reaches the minimum, because what
// it earned changed after it was agreed. Undo and settle again to correct it.
function stale(d: PartnerDayDTO): boolean {
  if (!d.settled || d.minimum == null) return false;
  return Number(d.earned) + Number(d.topUp) < Number(d.minimum);
}

// The days a partner was here, what their work earned, and what the guarantee
// tops each one up to.
//
// The floor is per day, so each row stands alone: a quiet day is topped up even
// when a busy one cleared the minimum. That is what makes this a table of days
// rather than a single monthly figure.
export default function PartnerDaysCard({
  partnerId,
  dailyMinimum,
  canWrite,
}: {
  partnerId: number;
  dailyMinimum: string | null;
  canWrite: boolean;
}) {
  const [month, setMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [days, setDays] = useState<PartnerDayDTO[]>([]);
  const [markDate, setMarkDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiRequest<{ days: PartnerDayDTO[] }>(
      `/api/partners/${partnerId}/days?month=${month}`,
    )
      .then((d) => {
        if (alive) setDays(d.days);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      alive = false;
    };
  }, [partnerId, month]);

  async function act(action: Action, date: string) {
    setBusy(true);
    setError(null);
    try {
      const d = await apiRequest<{ days: PartnerDayDTO[] }>(
        `/api/partners/${partnerId}/days`,
        { method: "POST", body: { action, date } },
      );
      // The server answers with the month the acted-on day belongs to, which is
      // the one on screen unless the user typed a date outside it.
      if (date.slice(0, 7) === month) setDays(d.days);
      else setMonth(date.slice(0, 7));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const owed = days
    .filter((d) => d.settled)
    .reduce((sum, d) => sum + Number(d.topUp), 0);

  return (
    <CollapsibleSection
      title="Days & guarantee"
      // Carried in the header so the month, the floor and what has been agreed
      // are all readable with the section shut.
      subtitle={
        dailyMinimum == null
          ? undefined
          : `${formatMoney(dailyMinimum)} a day, topped up when the day earns less. Settled days total ${formatMoney(owed)}.`
      }
      // The one section on this page that opens on load: attendance is a thing
      // somebody has to remember to do, and a quiet day nobody marks is a
      // guarantee nobody claims.
      defaultExpanded
      controls={
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
        >
          <TextField
            type="month"
            size="small"
            label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          {canWrite && (
            <>
              <TextField
                type="date"
                size="small"
                label="Mark present"
                value={markDate}
                onChange={(e) => setMarkDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <Button
                variant="outlined"
                disabled={busy || !markDate}
                onClick={() => act("attend", markDate)}
              >
                They were here
              </Button>
            </>
          )}
        </Stack>
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {dailyMinimum == null && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This partner is on no daily minimum. Set one on their profile to
          guarantee a floor for the days they are here.
        </Alert>
      )}

      {days.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          Nothing recorded this month.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell align="right">Earned</TableCell>
              <TableCell align="right">Top-up</TableCell>
              <TableCell>Status</TableCell>
              {canWrite && <TableCell align="right">Action</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {days.map((d) => (
              <TableRow key={d.date} hover>
                <TableCell>{formatWeekdayDate(d.date)}</TableCell>
                <TableCell align="right">{formatMoney(d.earned)}</TableCell>
                <TableCell align="right">
                  {Number(d.topUp) > 0 ? formatMoney(d.topUp) : "-"}
                </TableCell>
                <TableCell>
                  {d.settled ? (
                    // A settled figure is frozen, so voiding an invoice behind
                    // an already-agreed day leaves the day short without
                    // changing what it paid. Say so: the alternative is a vet
                    // quietly underpaid for a day nobody looks at again.
                    stale(d) ? (
                      <Chip
                        size="small"
                        color="warning"
                        label="Settled, now short"
                      />
                    ) : (
                      <Chip size="small" color="success" label="Settled" />
                    )
                  ) : d.attended ? (
                    <Chip size="small" label="Open" />
                  ) : (
                    // Earned on a day nobody marked. The work proves they were
                    // here, but the guarantee pays for attendance, so it stays
                    // unsettleable until somebody says so.
                    <Chip size="small" color="warning" label="Not marked" />
                  )}
                </TableCell>
                {canWrite && (
                  <TableCell align="right">
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ justifyContent: "flex-end" }}
                    >
                      {d.settled ? (
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => act("unsettle", d.date)}
                        >
                          Undo
                        </Button>
                      ) : (
                        <>
                          {d.attended ? (
                            <Button
                              size="small"
                              disabled={busy}
                              onClick={() => act("absent", d.date)}
                            >
                              Not here
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              disabled={busy}
                              onClick={() => act("attend", d.date)}
                            >
                              Mark present
                            </Button>
                          )}
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={
                              busy || !d.attended || dailyMinimum == null
                            }
                            onClick={() => act("settle", d.date)}
                          >
                            Settle
                          </Button>
                        </>
                      )}
                    </Stack>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CollapsibleSection>
  );
}
