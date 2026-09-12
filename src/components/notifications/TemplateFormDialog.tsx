"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import { apiRequest } from "@/utils/api-client";
import { NOTIFICATION_CHANNELS } from "@/types/enums";
import {
  NOTIFICATION_PLACEHOLDERS,
  TEMPLATE_TRIGGERS,
} from "@/constants/notification";
import type { NotificationTemplateDTO } from "@/types/entities";

interface Props {
  open: boolean;
  template?: NotificationTemplateDTO | null;
  onClose: () => void;
  onSaved: (template: NotificationTemplateDTO) => void;
}

const PLACEHOLDER_HINT = `Supports: ${NOTIFICATION_PLACEHOLDERS.map(
  (p) => p.token,
).join(", ")}`;

export default function TemplateFormDialog({ open, onClose, ...rest }: Props) {
  // Remount the form (via key) each time the dialog opens instead of syncing
  // props into state with an effect. State is initialized directly from props.
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {open && (
        <TemplateForm
          key={rest.template?.templateId ?? "new"}
          onClose={onClose}
          {...rest}
        />
      )}
    </Dialog>
  );
}

type FormProps = Omit<Props, "open">;

function TemplateForm({ template, onClose, onSaved }: FormProps) {
  const editing = Boolean(template);
  const [name, setName] = useState(template?.name ?? "");
  const [channel, setChannel] = useState<string>(
    template?.channel ?? "WhatsApp",
  );
  const [triggerEvent, setTriggerEvent] = useState(
    template?.triggerEvent ?? "",
  );
  const [body, setBody] = useState(template?.body ?? "");
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = { name, channel, triggerEvent, body, isActive };
      const data = editing
        ? await apiRequest<{ template: NotificationTemplateDTO }>(
            `/api/notifications/templates/${template!.templateId}`,
            { method: "PATCH", body: payload },
          )
        : await apiRequest<{ template: NotificationTemplateDTO }>(
            "/api/notifications/templates",
            { method: "POST", body: payload },
          );
      onSaved(data.template);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogTitle>{editing ? "Edit template" : "New template"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
          />
          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              required
              fullWidth
            >
              {NOTIFICATION_CHANNELS.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Used for"
              value={triggerEvent}
              onChange={(e) => setTriggerEvent(e.target.value)}
              fullWidth
              helperText="Booking reminders can be attached to bookings"
              // "" is a real choice here (picked by hand), so it is shown by
              // name rather than as an empty box.
              slotProps={{
                inputLabel: { shrink: true },
                select: { displayEmpty: true },
              }}
            >
              {TEMPLATE_TRIGGERS.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
              {/* A value typed before this was a select stays selectable as
                  itself, so opening an old template does not silently change
                  what it was for. */}
              {triggerEvent &&
                !TEMPLATE_TRIGGERS.some((t) => t.value === triggerEvent) && (
                  <MenuItem value={triggerEvent}>{triggerEvent}</MenuItem>
                )}
            </TextField>
          </Stack>
          <TextField
            label="Message body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            fullWidth
            multiline
            minRows={4}
            helperText={PLACEHOLDER_HINT}
          />
          <FormControlLabel
            control={
              <Switch
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
            }
            label="Active"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={saving}>
          {saving ? "Saving…" : editing ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </form>
  );
}
