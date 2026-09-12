"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { apiRequest } from "@/utils/api-client";
import { formatDateTime, formatTime } from "@/utils/format";
import { BOOKING_STATUSES, type BookingStatus } from "@/types/enums";
import type {
  BookingDTO,
  BookingTypeOption,
  ReminderTemplateOption,
  StaffOption,
} from "@/types/entities";
import BookingFormDialog from "./BookingFormDialog";

interface Props {
  initialBookings: BookingDTO[];
  /** The window the server rendered: today, as YYYY-MM-DD. */
  initialFrom: string;
  staffOptions: StaffOption[];
  typeOptions: BookingTypeOption[];
  reminderOptions: ReminderTemplateOption[];
  canWrite: boolean;
}

const STATUS_COLORS: Record<
  BookingStatus,
  "default" | "info" | "primary" | "success" | "error" | "warning"
> = {
  Scheduled: "info",
  Confirmed: "primary",
  "Checked In": "warning",
  Completed: "success",
  Cancelled: "error",
  "No Show": "default",
};

export default function BookingsTable({
  initialBookings,
  initialFrom,
  staffOptions,
  typeOptions,
  reminderOptions,
  canWrite,
}: Props) {
  const [bookings, setBookings] = useState(initialBookings);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState("");
  const [staffId, setStaffId] = useState("");
  const [status, setStatus] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BookingDTO | null>(null);
  const firstRender = useRef(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (from) params.set("from", new Date(from).toISOString());
    if (to) {
      // Include the whole "to" day.
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      params.set("to", end.toISOString());
    }
    if (staffId) params.set("staffId", staffId);
    if (status) params.set("status", status);
    const qs = params.toString();
    const data = await apiRequest<{ bookings: BookingDTO[] }>(
      `/api/bookings${qs ? `?${qs}` : ""}`,
    );
    setBookings(data.bookings);
  }, [from, to, staffId, status]);

  // The opening window came down with the document, so only a filter change
  // from here needs a fetch. Without the guard the page asked for the same
  // bookings a second time on every visit.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(b: BookingDTO) {
    setEditing(b);
    setDialogOpen(true);
  }

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Typography variant="h4">Bookings</Typography>
        {canWrite && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>
            New booking
          </Button>
        )}
      </Stack>

      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}
      >
        <TextField
          label="From"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          size="small"
        />
        <TextField
          label="To"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          size="small"
        />
        <TextField
          select
          label="Staff"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          size="small"
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All staff</MenuItem>
          {staffOptions.map((s) => (
            <MenuItem key={s.userId} value={String(s.userId)}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          size="small"
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {BOOKING_STATUSES.map((s) => (
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
              <TableCell>When</TableCell>
              <TableCell>Patient</TableCell>
              <TableCell>Owner</TableCell>
              <TableCell>Staff</TableCell>
              <TableCell>Type</TableCell>
              {reminderOptions.length > 0 && <TableCell>Reminder</TableCell>}
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bookings.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={reminderOptions.length > 0 ? 7 : 6}
                  align="center"
                >
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No bookings found.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              bookings.map((b) => (
                <TableRow
                  key={b.bookingId}
                  hover
                  onClick={() => canWrite && openEdit(b)}
                  sx={{ cursor: canWrite ? "pointer" : "default" }}
                >
                  <TableCell>
                    {formatDateTime(b.startsAt)}
                    {" - "}
                    {formatTime(b.endsAt)}
                  </TableCell>
                  <TableCell>{b.patientName}</TableCell>
                  <TableCell>{b.clientName}</TableCell>
                  <TableCell>{b.staffName ?? "Unassigned"}</TableCell>
                  <TableCell>{b.typeName ?? "-"}</TableCell>
                  {reminderOptions.length > 0 && (
                    <TableCell>
                      {b.reminderTemplateName ?? (
                        <Typography
                          component="span"
                          variant="body2"
                          color="text.secondary"
                        >
                          Type default
                        </Typography>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <Chip
                      size="small"
                      label={b.status}
                      color={STATUS_COLORS[b.status]}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <BookingFormDialog
        open={dialogOpen}
        booking={editing}
        staffOptions={staffOptions}
        typeOptions={typeOptions}
        reminderOptions={reminderOptions}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load()}
      />
    </Box>
  );
}
