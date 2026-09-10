"use client";

import { useEffect, useRef, useState } from "react";
import {
  Alert,
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
  Tooltip,
  Typography,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import ScheduleIcon from "@mui/icons-material/Schedule";
import { apiRequest } from "@/utils/api-client";
import { formatDateTime } from "@/utils/format";
import { hasSendAtNote, parseSendAtNote } from "@/utils/booking-notes";
import {
  BOOKING_REMINDER_LEAD_DAYS,
  NOTIFICATION_STATUS_COLOR,
} from "@/constants/notification";
import TablePaginationBar from "@/components/ui/TablePaginationBar";
import type { NotificationDTO, UpcomingBookingDTO } from "@/types/entities";

interface Props {
  initialUpcoming: UpcomingBookingDTO[];
  initialTotal: number;
  initialPendingTimed: number;
  pageSize: number;
  canWrite: boolean;
}

interface UpcomingPageResponse {
  bookings: UpcomingBookingDTO[];
  total: number;
  pendingTimed: number;
}

// A reminder that has already gone out. The Send button is closed off for
// these, and a send-time note on one of them has been overtaken by events.
function alreadySent(b: UpcomingBookingDTO): boolean {
  return b.reminderStatus === "Sent" || b.reminderStatus === "Delivered";
}

export default function UpcomingTable({
  initialUpcoming,
  initialTotal,
  initialPendingTimed,
  pageSize,
  canWrite,
}: Props) {
  const [bookings, setBookings] = useState(initialUpcoming);
  const [total, setTotal] = useState(initialTotal);
  // Counted over the whole window by the server, not over what is on screen:
  // Generate reminders is not limited to the page or the filter either.
  const [pendingTimed, setPendingTimed] = useState(initialPendingTimed);
  const [page, setPage] = useState(0); // MUI pagination is zero-based
  const [query, setQuery] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const firstRender = useRef(true);

  // Every filter runs in SQL, so the browser only ever holds one page.
  async function load(q: string, pending: boolean, p: number) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (pending) params.set("pending", "1");
    params.set("page", String(p + 1));
    setLoading(true);
    try {
      const data = await apiRequest<UpcomingPageResponse>(
        `/api/notifications/reminders?${params}`,
      );
      // Sending the last row on a late page empties it. Stepping back rather
      // than showing nothing matters most at the end of a long worklist, which
      // is exactly where someone has been working for a while.
      if (data.bookings.length === 0 && p > 0 && data.total > 0) {
        setPage(p - 1);
        return;
      }
      setBookings(data.bookings);
      setTotal(data.total);
      setPendingTimed(data.pendingTimed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => void load(query, pendingOnly, page), 200);
    return () => clearTimeout(t);
    // load is recreated each render; the three values below are the real inputs.
  }, [query, pendingOnly, page]);

  // A changed filter invalidates the current offset: page 3 of everything is
  // not page 3 of what is still to send.
  function changeFilter(next: () => void) {
    setPage(0);
    next();
  }

  async function refresh() {
    await load(query, pendingOnly, page);
  }

  async function sendOne(bookingId: number) {
    setError(null);
    setInfo(null);
    setBusyId(bookingId);
    try {
      const data = await apiRequest<{ notification: NotificationDTO }>(
        "/api/notifications/reminders",
        { method: "POST", body: { bookingId } },
      );
      setBookings((prev) =>
        prev.map((b) =>
          b.bookingId === bookingId
            ? {
                ...b,
                reminderStatus: data.notification.status,
                reminderNotificationId: data.notification.notificationId,
              }
            : b,
        ),
      );
      // Patched in place first so the row answers immediately, then reloaded:
      // the totals and the send-time count are the server's to know, and with
      // "Still to send" on, the row has just left the worklist.
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reminder");
    } finally {
      setBusyId(null);
    }
  }

  async function generateAll() {
    setError(null);
    setInfo(null);
    setGenerating(true);
    try {
      const data = await apiRequest<{
        result: { sent: number; failed: number; skipped: number };
      }>("/api/notifications/reminders", {
        method: "POST",
        body: { all: true },
      });
      const { sent, failed, skipped } = data.result;
      setInfo(`Reminders: ${sent} sent, ${failed} failed, ${skipped} skipped.`);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate reminders",
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Typography variant="body2" color="text.secondary">
          Bookings in the next {BOOKING_REMINDER_LEAD_DAYS} days. Send a
          reminder per row, or generate for all eligible bookings at once.
        </Typography>
        {canWrite && (
          <Button
            variant="contained"
            startIcon={<NotificationsActiveIcon />}
            onClick={() => void generateAll()}
            disabled={generating || bookings.length === 0}
          >
            {generating ? "Generating…" : "Generate reminders"}
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {info && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setInfo(null)}>
          {info}
        </Alert>
      )}

      {/* Generate reminders sends every eligible booking the moment it is
          pressed, which is exactly what a note asking for a specific time is
          trying to prevent. Saying so here is the difference between the note
          being honoured and it being quietly overrun. */}
      {canWrite && pendingTimed > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {pendingTimed === 1
            ? "One booking asks for its reminder at a set time."
            : `${pendingTimed} bookings ask for their reminders at a set time.`}{" "}
          Generate reminders sends all of them now. Use Send on the row when the
          time comes instead.
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
        <TextField
          label="Search client or patient"
          value={query}
          onChange={(e) => changeFilter(() => setQuery(e.target.value))}
          size="small"
          sx={{ minWidth: 260 }}
        />
        <TextField
          select
          label="Show"
          value={pendingOnly ? "pending" : "all"}
          onChange={(e) =>
            changeFilter(() => setPendingOnly(e.target.value === "pending"))
          }
          size="small"
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="all">All bookings</MenuItem>
          <MenuItem value="pending">Still to send</MenuItem>
        </TextField>
      </Stack>

      <TableContainer component={Paper}>
        <Table
          size="small"
          sx={{
            // Banded, because this is a worklist read across six columns to a
            // button at the far right, and a mis-read row sends the wrong
            // client a message.
            "& tbody tr:nth-of-type(odd)": { backgroundColor: "action.hover" },
            // Restated at the same specificity, and after the band, or the
            // pointer would stop registering on every second row: the band is
            // already painted in the hover colour.
            "& tbody tr:hover": { backgroundColor: "action.selected" },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell>When</TableCell>
              <TableCell>Patient</TableCell>
              <TableCell>Client</TableCell>
              <TableCell>Booking</TableCell>
              <TableCell>Reminder</TableCell>
              {canWrite && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {bookings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 6 : 5} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    {query.trim() || pendingOnly
                      ? "No bookings match these filters."
                      : `No upcoming bookings in the next ${BOOKING_REMINDER_LEAD_DAYS} days.`}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              bookings.map((b) => {
                const sendAt = parseSendAtNote(b.notes);
                const unreadable = !sendAt && hasSendAtNote(b.notes);
                const spent = alreadySent(b);
                return (
                  <TableRow key={b.bookingId} hover>
                    <TableCell>{formatDateTime(b.startsAt)}</TableCell>
                    <TableCell>{b.patientName}</TableCell>
                    <TableCell>{b.clientName}</TableCell>
                    <TableCell>
                      <Chip size="small" label={b.bookingStatus} />
                    </TableCell>
                    {/* The send time sits with the reminder rather than with
                      the appointment: it is an instruction about this column,
                      and a second time in the When cell would read as the
                      booking having moved. It also lands right beside the Send
                      button, in the same glance as the press. */}
                    <TableCell>
                      <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
                        {b.reminderStatus ? (
                          <Chip
                            size="small"
                            color={NOTIFICATION_STATUS_COLOR[b.reminderStatus]}
                            label={b.reminderStatus}
                          />
                        ) : (
                          <Chip
                            size="small"
                            variant="outlined"
                            label="Not sent"
                          />
                        )}
                        {(sendAt || unreadable) && (
                          <Tooltip title={b.notes ?? ""}>
                            <Chip
                              size="small"
                              color="warning"
                              // Loud while it is still an instruction; quieter
                              // once the reminder has gone, where it is a record
                              // that the note was overtaken rather than a thing
                              // to act on.
                              variant={spent ? "outlined" : "filled"}
                              icon={<ScheduleIcon fontSize="small" />}
                              label={
                                sendAt
                                  ? `Send at ${sendAt.label}`
                                  : "Check send time"
                              }
                            />
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                    {canWrite && (
                      <TableCell align="right">
                        <Tooltip
                          title={
                            b.reminderStatus === "Sent" ||
                            b.reminderStatus === "Delivered"
                              ? "Reminder already sent"
                              : "Send reminder"
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              startIcon={<SendIcon fontSize="small" />}
                              onClick={() => void sendOne(b.bookingId)}
                              disabled={
                                busyId === b.bookingId ||
                                b.reminderStatus === "Sent" ||
                                b.reminderStatus === "Delivered" ||
                                b.reminderStatus === "Pending"
                              }
                            >
                              {b.reminderStatus === "Failed" ? "Retry" : "Send"}
                            </Button>
                          </span>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <TablePaginationBar
          page={page}
          count={total}
          pageSize={pageSize}
          onChange={setPage}
          loading={loading}
          noun="bookings"
        />
      </TableContainer>
    </Box>
  );
}
