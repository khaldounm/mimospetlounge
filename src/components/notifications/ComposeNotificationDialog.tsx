"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { apiRequest } from "@/utils/api-client";
import { NOTIFICATION_CHANNELS } from "@/types/enums";
import { NOTIFICATION_PLACEHOLDERS } from "@/constants/notification";
import type { NotificationDTO } from "@/types/entities";

export interface ClientOption {
  clientId: number;
  label: string;
}
export interface PatientOption {
  patientId: number;
  clientId: number;
  label: string;
}
export interface BookingOption {
  bookingId: number;
  clientId: number;
  label: string;
}
export interface TemplateOption {
  templateId: number;
  name: string;
  channel: string | null;
  body: string;
}

// Optional initial selections, e.g. when following up on a missed booking.
export interface ComposePrefill {
  clientId?: number;
  patientId?: number;
  bookingId?: number;
  dueDate?: string;
  // The recall's record title ("CBC test"), for {{service_name}}.
  serviceName?: string;
}

interface Props {
  open: boolean;
  clientOptions: ClientOption[];
  patientOptions: PatientOption[];
  bookingOptions: BookingOption[];
  templateOptions: TemplateOption[];
  prefill?: ComposePrefill;
  onClose: () => void;
  onSaved: (notification: NotificationDTO) => void;
}

const PLACEHOLDER_HINT = `Placeholders filled in when queued: ${NOTIFICATION_PLACEHOLDERS.map(
  (p) => p.token,
).join(", ")}`;

export default function ComposeNotificationDialog({
  open,
  onClose,
  ...rest
}: Props) {
  // Remount the form each time the dialog opens instead of resetting state with
  // an effect. State starts from its defaults on mount.
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {open && <ComposeNotificationForm onClose={onClose} {...rest} />}
    </Dialog>
  );
}

type FormProps = Omit<Props, "open">;

function ComposeNotificationForm({
  clientOptions,
  patientOptions,
  bookingOptions,
  templateOptions,
  prefill,
  onClose,
  onSaved,
}: FormProps) {
  // The form remounts on open, so deriving initial state from the prefill here
  // is enough; no effect needed to sync later prop changes.
  const [clientId, setClientId] = useState(
    prefill?.clientId != null ? String(prefill.clientId) : "",
  );
  const [patientId, setPatientId] = useState(
    prefill?.patientId != null ? String(prefill.patientId) : "",
  );
  const [bookingId, setBookingId] = useState(
    prefill?.bookingId != null ? String(prefill.bookingId) : "",
  );
  const [templateId, setTemplateId] = useState("");
  const [channel, setChannel] = useState<string>("WhatsApp");
  const [body, setBody] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Patients + bookings are scoped to the chosen client.
  const patients = useMemo(
    () => patientOptions.filter((p) => String(p.clientId) === clientId),
    [patientOptions, clientId],
  );
  const bookings = useMemo(
    () => bookingOptions.filter((b) => String(b.clientId) === clientId),
    [bookingOptions, clientId],
  );

  function changeClient(id: string) {
    setClientId(id);
    setPatientId("");
    setBookingId("");
  }

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templateOptions.find((o) => String(o.templateId) === id);
    if (t) {
      if (t.channel) setChannel(t.channel);
      setBody(t.body);
    }
  }

  async function submit(sendNow: boolean) {
    setError(null);
    setSaving(true);
    try {
      const data = await apiRequest<{ notification: NotificationDTO }>(
        "/api/notifications",
        {
          method: "POST",
          body: {
            clientId,
            patientId,
            bookingId,
            templateId,
            channel,
            body,
            scheduledAt,
            dueDate: prefill?.dueDate,
            serviceName: prefill?.serviceName,
          },
        },
      );
      let notification = data.notification;
      if (sendNow) {
        const sent = await apiRequest<{ notification: NotificationDTO }>(
          `/api/notifications/${notification.notificationId}`,
          { method: "PATCH", body: { action: "send" } },
        );
        notification = sent.notification;
      }
      onSaved(notification);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compose");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogTitle>Compose notification</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            select
            label="Client"
            value={clientId}
            onChange={(e) => changeClient(e.target.value)}
            required
            fullWidth
          >
            {clientOptions.map((o) => (
              <MenuItem key={o.clientId} value={String(o.clientId)}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Patient (optional)"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              fullWidth
              disabled={!clientId}
            >
              <MenuItem value="">None</MenuItem>
              {patients.map((o) => (
                <MenuItem key={o.patientId} value={String(o.patientId)}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Booking (optional)"
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
              fullWidth
              disabled={!clientId}
            >
              <MenuItem value="">None</MenuItem>
              {bookings.map((o) => (
                <MenuItem key={o.bookingId} value={String(o.bookingId)}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Template (optional)"
              value={templateId}
              onChange={(e) => pickTemplate(e.target.value)}
              fullWidth
            >
              <MenuItem value="">None</MenuItem>
              {templateOptions.map((o) => (
                <MenuItem key={o.templateId} value={String(o.templateId)}>
                  {o.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              required
              fullWidth
              helperText="Only WhatsApp sends; others queue"
            >
              {NOTIFICATION_CHANNELS.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <TextField
            label="Message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            fullWidth
            multiline
            minRows={4}
            helperText={PLACEHOLDER_HINT}
          />

          <TextField
            label="Schedule for (optional)"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Leave blank to send now or queue immediately"
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void submit(false)} disabled={saving}>
          {saving ? "Saving…" : "Queue"}
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit(true)}
          disabled={saving}
        >
          {saving ? "Sending…" : "Send now"}
        </Button>
      </DialogActions>
    </>
  );
}
