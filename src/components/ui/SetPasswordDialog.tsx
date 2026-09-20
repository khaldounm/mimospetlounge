"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiRequest } from "@/utils/api-client";
import type { UserDTO } from "@/types/entities";

interface Props {
  open: boolean;
  user: UserDTO | null;
  onClose: () => void;
  onSaved: () => void;
}

// An admin giving someone a password. Shown only at a clinic that keeps
// passwords on; a passkey-only clinic never renders it and its route is a
// 404. Setting one ends the person's other sessions, and the dialog says so.
export default function SetPasswordDialog({ open, onClose, ...rest }: Props) {
  // Remount the form each time the dialog opens instead of resetting state
  // with an effect. State starts from its defaults on mount.
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      {open && (
        <SetPasswordForm
          key={rest.user?.userId ?? "none"}
          onClose={onClose}
          {...rest}
        />
      )}
    </Dialog>
  );
}

type FormProps = Omit<Props, "open">;

function SetPasswordForm({ user, onClose, onSaved }: FormProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await apiRequest(`/api/users/${user!.userId}/password`, {
        method: "PATCH",
        body: { password },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogTitle>
        {user ? `Set a password for ${user.firstName}` : "Set a password"}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            A passkey is the better way in; this is for someone who cannot use
            one yet. Setting it signs them out everywhere.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="New password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            fullWidth
            helperText="At least 8 characters."
          />
          <TextField
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={saving}>
          {saving ? "Saving..." : "Set password"}
        </Button>
      </DialogActions>
    </form>
  );
}
