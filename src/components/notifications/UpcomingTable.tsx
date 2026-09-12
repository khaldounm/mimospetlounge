"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
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
import ScheduleIcon from "@mui/icons-material/Schedule";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import PhoneDisabledIcon from "@mui/icons-material/PhoneDisabled";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { apiRequest } from "@/utils/api-client";
import { formatTime, formatWeekdayDate, toDateOnly } from "@/utils/format";
import { hasSendAtNote, parseSendAtNote } from "@/utils/booking-notes";
import {
  BOOKING_REMINDER_LEAD_DAYS,
  NOTIFICATION_STATUS_COLOR,
} from "@/constants/notification";
import TablePaginationBar from "@/components/ui/TablePaginationBar";
import type {
  NotificationDTO,
  ReminderTemplateOption,
  UpcomingBookingDTO,
  UpcomingPageDTO,
} from "@/types/entities";

interface Props {
  initialPage: UpcomingPageDTO;
  pageSize: number;
  // The reminder kinds the row select offers. Empty until the clinic has a
  // template with the booking-reminder trigger.
  reminderOptions: ReminderTemplateOption[];
  canWrite: boolean;
}

interface BulkResult {
  sent: number;
  failed: number;
  skipped: number;
  held: number;
  remaining: number;
}

// What the bulk button shows while it runs: the tally so far over what there
// was to do when it started.
interface BulkProgress {
  done: number;
  of: number;
}

// A reminder that has already gone out. Send is closed off for these, and a
// send-time note on one of them has been overtaken by events.
function alreadySent(b: UpcomingBookingDTO): boolean {
  return b.reminderStatus === "Sent" || b.reminderStatus === "Delivered";
}

// Still on the worklist: nothing sent, or only a failed attempt.
function stillToSend(b: UpcomingBookingDTO): boolean {
  return !alreadySent(b) && b.reminderStatus !== "Pending";
}

// The booking's day in the viewer's clock, matching how the time column and
// the bookings diary render it (bookings are browser-local on purpose).
function localDay(iso: string): string {
  return toDateOnly(new Date(iso)) ?? iso.slice(0, 10);
}

// "Today, Sat 12/09/2026" for the day headers. Relative words where they help,
// the full date always, because "Tomorrow" on a screen left open overnight is
// wrong by the morning.
function dayLabel(day: string): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const date = formatWeekdayDate(day);
  if (day === toDateOnly(today)) return `Today, ${date}`;
  if (day === toDateOnly(tomorrow)) return `Tomorrow, ${date}`;
  return date;
}

export default function UpcomingTable({
  initialPage,
  pageSize,
  reminderOptions,
  canWrite,
}: Props) {
  const [rows, setRows] = useState(initialPage.bookings);
  const [total, setTotal] = useState(initialPage.total);
  const [windowTotal, setWindowTotal] = useState(initialPage.windowTotal);
  const [windowPending, setWindowPending] = useState(initialPage.windowPending);
  // Counted over the whole window by the server, not over what is on screen:
  // the bulk send is not limited to the page or the filter either.
  const [pendingTimed, setPendingTimed] = useState(initialPage.pendingTimed);
  const [page, setPage] = useState(0); // MUI pagination is zero-based
  const [query, setQuery] = useState("");
  // The server rendered the worklist view; "All" is one click away.
  const [pendingOnly, setPendingOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  // Per row, so a slow provider on one row never stops the next click. The
  // value says what the row is waiting on, for the control that shows it.
  const [busy, setBusy] = useState<Record<number, "send" | "attach">>({});
  // One preview open at a time keeps the table readable; the row remembers
  // an edit until it is sent or closed.
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const firstRender = useRef(true);

  const columns = canWrite ? 6 : 5;
  const held = pendingTimed;
  const bulkCount = Math.max(windowPending - held, 0);

  // Every filter runs in SQL, so the browser only ever holds one page.
  async function load(q: string, pending: boolean, p: number) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (pending) params.set("pending", "1");
    params.set("page", String(p + 1));
    setLoading(true);
    try {
      const data = await apiRequest<UpcomingPageDTO>(
        `/api/notifications/reminders?${params}`,
      );
      // Sending the last row on a late page empties it. Stepping back rather
      // than showing nothing matters most at the end of a long worklist, which
      // is exactly where someone has been working for a while.
      if (data.bookings.length === 0 && p > 0 && data.total > 0) {
        setPage(p - 1);
        return;
      }
      setRows(data.bookings);
      setTotal(data.total);
      setWindowTotal(data.windowTotal);
      setWindowPending(data.windowPending);
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

  function setRowBusy(bookingId: number, what: "send" | "attach" | null) {
    setBusy((prev) => {
      const next = { ...prev };
      if (what) next[bookingId] = what;
      else delete next[bookingId];
      return next;
    });
  }

  function patchRow(bookingId: number, patch: Partial<UpcomingBookingDTO>) {
    setRows((prev) =>
      prev.map((b) => (b.bookingId === bookingId ? { ...b, ...patch } : b)),
    );
  }

  // The row answers from what the server said about this one send; nothing
  // else on the page is refetched. The counts move by the same one row, and
  // with the worklist filter on, a sent row leaves the list. Only an emptied
  // page asks the server for the next one.
  async function sendOne(row: UpcomingBookingDTO, body?: string) {
    setError(null);
    setInfo(null);
    setRowBusy(row.bookingId, "send");
    try {
      const data = await apiRequest<{ notification: NotificationDTO }>(
        "/api/notifications/reminders",
        {
          method: "POST",
          body: { bookingId: row.bookingId, ...(body ? { body } : {}) },
        },
      );
      const status = data.notification.status;
      const sent = status === "Sent" || status === "Delivered";
      patchRow(row.bookingId, {
        reminderStatus: status,
        reminderNotificationId: data.notification.notificationId,
      });
      if (previewId === row.bookingId) {
        setPreviewId(null);
        setDraft(null);
      }
      if (sent && stillToSend(row)) {
        setWindowPending((n) => Math.max(n - 1, 0));
        if (hasSendAtNote(row.notes)) {
          setPendingTimed((n) => Math.max(n - 1, 0));
        }
        if (pendingOnly) {
          const remaining = rows.filter((b) => b.bookingId !== row.bookingId);
          setRows(remaining);
          setTotal((n) => Math.max(n - 1, 0));
          if (remaining.length === 0) void load(query, pendingOnly, page);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reminder");
    } finally {
      setRowBusy(row.bookingId, null);
    }
  }

  // Changing the kind on a row: the select shows the pick straight away, the
  // server writes it to the booking and hands back the row re-rendered, so
  // the preview is the text that will now go out.
  async function attach(row: UpcomingBookingDTO, value: string) {
    const templateId = Number(value);
    const option = reminderOptions.find((o) => o.templateId === templateId);
    if (!option || templateId === row.templateId) return;
    setError(null);
    patchRow(row.bookingId, {
      templateId,
      templateName: option.name,
      reminderTemplateId: templateId,
    });
    setRowBusy(row.bookingId, "attach");
    try {
      const data = await apiRequest<{ booking: UpcomingBookingDTO }>(
        `/api/notifications/reminders/${row.bookingId}`,
        { method: "PATCH", body: { templateId } },
      );
      // The server's row carries the fresh preview; the status is already on
      // screen and has not changed.
      patchRow(row.bookingId, data.booking);
      if (previewId === row.bookingId) setDraft(null);
    } catch (err) {
      patchRow(row.bookingId, row);
      setError(
        err instanceof Error ? err.message : "Failed to change reminder",
      );
    } finally {
      setRowBusy(row.bookingId, null);
    }
  }

  // The whole window, one short request at a time. Each answer says how many
  // are left, the button counts up between them, and no single request has to
  // outlive a serverless function's patience. Rows a batch could not send
  // (failed, no number, held) stay at the front of the list, so the next
  // request steps over exactly that many.
  async function sendAll() {
    setError(null);
    setInfo(null);
    const tally = { sent: 0, failed: 0, skipped: 0, held: 0 };
    setBulk({ done: 0, of: windowPending });
    try {
      let skip = 0;
      let remaining = windowPending;
      // Bounded: every batch either sends something or steps past it, so this
      // ends, but a guard is cheaper than being wrong about that.
      for (let batch = 0; remaining > 0 && batch < 100; batch += 1) {
        const data = await apiRequest<{ result: BulkResult }>(
          "/api/notifications/reminders",
          { method: "POST", body: { all: true, skip } },
        );
        const r = data.result;
        tally.sent += r.sent;
        tally.failed += r.failed;
        tally.skipped += r.skipped;
        tally.held += r.held;
        skip += r.failed + r.skipped + r.held;
        remaining = r.remaining;
        const processed = tally.sent + skip;
        setBulk({ done: processed, of: Math.max(processed + remaining, 1) });
      }
      const parts = [`${tally.sent} sent`];
      if (tally.failed) parts.push(`${tally.failed} failed`);
      if (tally.skipped) {
        parts.push(`${tally.skipped} skipped (no usable number)`);
      }
      if (tally.held) {
        parts.push(
          `${tally.held} held for ${tally.held === 1 ? "its" : "their"} set time`,
        );
      }
      setInfo(parts.join(", ") + ".");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reminders");
    } finally {
      setBulk(null);
      await load(query, pendingOnly, page);
    }
  }

  function togglePreview(bookingId: number) {
    setDraft(null);
    setPreviewId((current) => (current === bookingId ? null : bookingId));
  }

  const emptyMessage = query.trim()
    ? "No bookings match this search."
    : pendingOnly
      ? `Nothing left to send in the next ${BOOKING_REMINDER_LEAD_DAYS} days.`
      : `No upcoming bookings in the next ${BOOKING_REMINDER_LEAD_DAYS} days.`;

  return (
    <Box>
      <Stack
        direction="row"
        sx={{
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
          flexWrap: "wrap",
          gap: 1,
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Chip
            label={`Still to send · ${windowPending}`}
            color={pendingOnly ? "primary" : "default"}
            variant={pendingOnly ? "filled" : "outlined"}
            onClick={() => changeFilter(() => setPendingOnly(true))}
          />
          <Chip
            label={`All · ${windowTotal}`}
            color={pendingOnly ? "default" : "primary"}
            variant={pendingOnly ? "outlined" : "filled"}
            onClick={() => changeFilter(() => setPendingOnly(false))}
          />
          <TextField
            label="Search client or patient"
            value={query}
            onChange={(e) => changeFilter(() => setQuery(e.target.value))}
            size="small"
            sx={{ minWidth: 240, ml: 1 }}
          />
        </Stack>
        {canWrite && (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            {/* The bulk send leaves timed bookings alone, and says so here
                where the button is, so the number on the button and the rows
                that stay behind add up. */}
            {held > 0 && (
              <Typography variant="body2" color="text.secondary">
                {held === 1
                  ? "1 held for its set time"
                  : `${held} held for their set time`}
              </Typography>
            )}
            <Button
              variant="contained"
              startIcon={<SendIcon />}
              onClick={() => void sendAll()}
              disabled={bulk !== null || bulkCount === 0}
            >
              {bulk
                ? `Sending… ${bulk.done} of ${bulk.of}`
                : `Send ${bulkCount} now`}
            </Button>
          </Stack>
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

      <TableContainer component={Paper}>
        <Table
          size="small"
          sx={{
            // Banded, because this is a worklist read across six columns to a
            // button at the far right, and a mis-read row sends the wrong
            // client a message. Day headers carry their own colour.
            "& tbody tr.row:nth-of-type(odd)": {
              backgroundColor: "action.hover",
            },
            // Restated at the same specificity, and after the band, or the
            // pointer would stop registering on every second row: the band is
            // already painted in the hover colour.
            "& tbody tr.row:hover": { backgroundColor: "action.selected" },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 90 }}>Time</TableCell>
              <TableCell>Patient</TableCell>
              <TableCell>Booking</TableCell>
              <TableCell sx={{ width: 240 }}>Reminder</TableCell>
              <TableCell>Status</TableCell>
              {canWrite && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    {emptyMessage}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((b, i) => {
                const day = localDay(b.startsAt);
                const firstOfDay =
                  i === 0 || localDay(rows[i - 1].startsAt) !== day;
                const dayPending = firstOfDay
                  ? rows.filter(
                      (r) => localDay(r.startsAt) === day && stillToSend(r),
                    ).length
                  : 0;
                const sendAt = parseSendAtNote(b.notes);
                const unreadable = !sendAt && hasSendAtNote(b.notes);
                const spent = alreadySent(b);
                const rowBusy = busy[b.bookingId];
                const previewOpen = previewId === b.bookingId;
                const selectValue = reminderOptions.some(
                  (o) => o.templateId === b.templateId,
                )
                  ? String(b.templateId)
                  : "";
                const canSend =
                  canWrite &&
                  !rowBusy &&
                  !spent &&
                  b.reminderStatus !== "Pending" &&
                  b.templateId !== null &&
                  b.recipient !== null;

                return (
                  <Fragment key={b.bookingId}>
                    {firstOfDay && (
                      <TableRow>
                        <TableCell
                          colSpan={columns}
                          sx={{
                            backgroundColor: "background.default",
                            fontWeight: 500,
                            py: 0.75,
                          }}
                        >
                          {dayLabel(day)}
                          {dayPending > 0 && (
                            <Typography
                              component="span"
                              variant="body2"
                              color="text.secondary"
                              sx={{ ml: 1 }}
                            >
                              · {dayPending} to send
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow className="row" hover>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {formatTime(b.startsAt)}
                      </TableCell>
                      <TableCell>
                        {b.patientName}
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ lineHeight: 1.3 }}
                        >
                          {b.clientName}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
                          <Chip size="small" label={b.typeName ?? "No type"} />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ lineHeight: 1.2 }}
                          >
                            {b.bookingStatus}
                          </Typography>
                        </Stack>
                      </TableCell>
                      {/* The kind the send will use. Attached by hand it says
                          so, because "why did Luna get the deworming text on a
                          consultation" is a question the row should answer. */}
                      <TableCell>
                        {reminderOptions.length === 0 ||
                        b.templateId === null ? (
                          <Typography variant="body2" color="text.secondary">
                            No booking reminder template
                          </Typography>
                        ) : (
                          <Stack
                            spacing={0.25}
                            sx={{ alignItems: "flex-start" }}
                          >
                            <TextField
                              select
                              size="small"
                              value={selectValue}
                              onChange={(e) => void attach(b, e.target.value)}
                              disabled={!canWrite || Boolean(rowBusy) || spent}
                              slotProps={{
                                select: { displayEmpty: true },
                                htmlInput: { "aria-label": "Reminder" },
                              }}
                              sx={{
                                minWidth: 210,
                                "& .MuiInputBase-input": { py: 0.5 },
                              }}
                            >
                              {selectValue === "" && (
                                <MenuItem value="" disabled>
                                  {b.templateName}
                                </MenuItem>
                              )}
                              {reminderOptions.map((o) => (
                                <MenuItem
                                  key={o.templateId}
                                  value={String(o.templateId)}
                                >
                                  {o.name}
                                </MenuItem>
                              ))}
                            </TextField>
                            {b.isOverride && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                changed from the type default
                              </Typography>
                            )}
                          </Stack>
                        )}
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
                          {rowBusy === "send" ? (
                            <Chip size="small" color="info" label="Sending…" />
                          ) : b.reminderStatus ? (
                            <Chip
                              size="small"
                              color={
                                NOTIFICATION_STATUS_COLOR[b.reminderStatus]
                              }
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
                                // once the reminder has gone, where it is a
                                // record that the note was overtaken rather
                                // than a thing to act on.
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
                          {b.recipient === null && b.templateId !== null && (
                            <Tooltip title="Add a valid phone number to the client">
                              <Chip
                                size="small"
                                color="error"
                                variant="outlined"
                                icon={<PhoneDisabledIcon fontSize="small" />}
                                label="No usable number"
                              />
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                      {canWrite && (
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          {b.preview !== null && (
                            <Tooltip
                              title={
                                previewOpen ? "Hide message" : "Show message"
                              }
                            >
                              <IconButton
                                size="small"
                                onClick={() => togglePreview(b.bookingId)}
                                aria-label={
                                  previewOpen ? "Hide message" : "Show message"
                                }
                              >
                                {previewOpen ? (
                                  <VisibilityOffOutlinedIcon fontSize="small" />
                                ) : (
                                  <VisibilityOutlinedIcon fontSize="small" />
                                )}
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip
                            title={
                              spent
                                ? "Reminder already sent"
                                : b.recipient === null
                                  ? "No usable phone number"
                                  : "Send this reminder"
                            }
                          >
                            <span>
                              <Button
                                size="small"
                                startIcon={<SendIcon fontSize="small" />}
                                onClick={() => void sendOne(b)}
                                disabled={!canSend}
                              >
                                {b.reminderStatus === "Failed"
                                  ? "Retry"
                                  : "Send"}
                              </Button>
                            </span>
                          </Tooltip>
                        </TableCell>
                      )}
                    </TableRow>
                    {previewOpen && b.preview !== null && (
                      <TableRow>
                        <TableCell
                          colSpan={columns}
                          sx={{ py: 1.5, pl: { xs: 2, md: 12 } }}
                        >
                          <Paper
                            variant="outlined"
                            sx={{ p: 2, maxWidth: 640 }}
                          >
                            <Stack
                              direction="row"
                              sx={{
                                justifyContent: "space-between",
                                mb: 1,
                                gap: 2,
                              }}
                            >
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                To {b.clientName}
                                {b.recipient ? ` · ${b.recipient}` : ""}
                              </Typography>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                {b.templateName}
                              </Typography>
                            </Stack>
                            {draft === null ? (
                              <Typography
                                variant="body2"
                                sx={{ whiteSpace: "pre-wrap" }}
                              >
                                {b.preview}
                              </Typography>
                            ) : (
                              <TextField
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                multiline
                                minRows={3}
                                fullWidth
                                size="small"
                                helperText="Sent to this booking only; the template is unchanged"
                              />
                            )}
                            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<SendIcon fontSize="small" />}
                                disabled={
                                  !canSend ||
                                  (draft !== null && draft.trim() === "")
                                }
                                onClick={() =>
                                  void sendOne(b, draft ?? undefined)
                                }
                              >
                                {draft === null ? "Send this" : "Send edited"}
                              </Button>
                              {draft === null ? (
                                <Button
                                  size="small"
                                  startIcon={
                                    <EditOutlinedIcon fontSize="small" />
                                  }
                                  disabled={!canSend}
                                  onClick={() => setDraft(b.preview)}
                                >
                                  Edit once
                                </Button>
                              ) : (
                                <Button
                                  size="small"
                                  onClick={() => setDraft(null)}
                                >
                                  Discard edit
                                </Button>
                              )}
                            </Stack>
                          </Paper>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
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
