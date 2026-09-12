"use client";

import { useState } from "react";
import {
  Alert,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiRequest } from "@/utils/api-client";
import type {
  BookingTypeOption,
  ReminderTemplateOption,
} from "@/types/entities";

interface Props {
  bookingTypes: BookingTypeOption[];
  // The reminder kinds on offer: active templates with the booking-reminder
  // trigger. Derived by the parent from its live template list, so a template
  // created a moment ago is already pickable here.
  reminderOptions: ReminderTemplateOption[];
  canWrite: boolean;
}

// Which reminder template a new booking of each type starts with. One select
// per type, saved the moment it changes: this is set once and read forever,
// and a Save button would be one more thing between the decision and the
// bookings that inherit it.
export default function ReminderDefaultsCard({
  bookingTypes,
  reminderOptions,
  canWrite,
}: Props) {
  const [types, setTypes] = useState(bookingTypes);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setDefault(typeId: number, value: string) {
    const templateId = value === "" ? null : Number(value);
    const before = types;
    // Optimistic: the select shows the new value while the request is out,
    // and snaps back if the server refuses it.
    setTypes((prev) =>
      prev.map((t) =>
        t.typeId === typeId ? { ...t, defaultTemplateId: templateId } : t,
      ),
    );
    setError(null);
    setBusyId(typeId);
    try {
      await apiRequest(`/api/notifications/reminder-defaults/${typeId}`, {
        method: "PATCH",
        body: { templateId },
      });
    } catch (err) {
      setTypes(before);
      setError(err instanceof Error ? err.message : "Failed to save default");
    } finally {
      setBusyId(null);
    }
  }

  if (types.length === 0) return null;

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
        Default reminder by booking type
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        A new booking starts with its type&apos;s reminder. Any booking can be
        switched to another reminder on its form or on the Upcoming tab.
        {reminderOptions.length === 0 &&
          " Create a template with the Booking reminder trigger to have something to pick."}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 2 }}>
        {types.map((t) => {
          // A default pointing at a template that is no longer on offer
          // (deactivated since) reads as generic, which is what it resolves to.
          const current =
            t.defaultTemplateId !== null &&
            reminderOptions.some((o) => o.templateId === t.defaultTemplateId)
              ? String(t.defaultTemplateId)
              : "";
          return (
            <TextField
              key={t.typeId}
              select
              size="small"
              label={t.name}
              value={current}
              onChange={(e) => void setDefault(t.typeId, e.target.value)}
              disabled={!canWrite || busyId === t.typeId}
              // Shown with the generic option's name rather than an empty
              // box, so an unset type reads as what it will send.
              slotProps={{
                inputLabel: { shrink: true },
                select: { displayEmpty: true },
              }}
              sx={{ minWidth: 240 }}
            >
              <MenuItem value="">Generic booking reminder</MenuItem>
              {reminderOptions.map((o) => (
                <MenuItem key={o.templateId} value={String(o.templateId)}>
                  {o.name}
                </MenuItem>
              ))}
            </TextField>
          );
        })}
      </Stack>
    </Paper>
  );
}
