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
  Typography,
} from "@mui/material";
import { apiRequest } from "@/utils/api-client";
import PhoneField from "@/components/ui/PhoneField";
import EnrollmentLinkPanel from "@/components/ui/EnrollmentLinkPanel";
import type { RoleOption, UserDTO } from "@/types/entities";

interface Props {
  open: boolean;
  user?: UserDTO | null;
  roleOptions: RoleOption[];
  isSelf?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function UserFormDialog({ open, onClose, ...rest }: Props) {
  // Remount the form (via key) each time the dialog opens instead of syncing
  // props into state with an effect. State is initialized directly from props.
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {open && (
        <UserForm
          key={rest.user?.userId ?? "new"}
          onClose={onClose}
          {...rest}
        />
      )}
    </Dialog>
  );
}

type FormProps = Omit<Props, "open">;

function UserForm({
  user,
  roleOptions,
  isSelf = false,
  onClose,
  onSaved,
}: FormProps) {
  const editing = Boolean(user);
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [roleId, setRoleId] = useState<number | "">(
    user?.roleId ?? roleOptions[0]?.roleId ?? "",
  );
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A new account has no password and no passkey until its link is used, so
  // creating one is two steps: the details, then the link. The dialog stays
  // open on the second step with the row already saved.
  const [created, setCreated] = useState<UserDTO | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (editing) {
        await apiRequest(`/api/users/${user!.userId}`, {
          method: "PATCH",
          body: { firstName, lastName, email, phone, roleId, isActive },
        });
        onSaved();
        onClose();
      } else {
        const { user: saved } = await apiRequest<{ user: UserDTO }>(
          "/api/users",
          {
            method: "POST",
            body: { firstName, lastName, email, phone, roleId },
          },
        );
        onSaved();
        setCreated(saved);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <>
        <DialogTitle>Send {created.firstName} their sign-in link</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography color="text.secondary">
              The account is saved. {created.firstName} opens the link on their
              phone, confirms with Face ID or fingerprint, and is signed in. No
              password.
            </Typography>
            <EnrollmentLinkPanel user={created} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={onClose}>
            Done
          </Button>
        </DialogActions>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogTitle>{editing ? "Edit user" : "New user"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction="row" spacing={2}>
            <TextField
              label="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              fullWidth
            />
          </Stack>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
          />
          <PhoneField value={phone} onChange={setPhone} fullWidth />
          <TextField
            select
            label="Role"
            value={roleId}
            onChange={(e) => setRoleId(Number(e.target.value))}
            required
            fullWidth
          >
            {roleOptions.map((r) => (
              <MenuItem key={r.roleId} value={r.roleId}>
                {r.name}
              </MenuItem>
            ))}
          </TextField>

          {editing && (
            <FormControlLabel
              control={
                <Switch
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  disabled={isSelf}
                />
              }
              label={
                isSelf
                  ? "Active (you cannot deactivate your own account)"
                  : "Active"
              }
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={saving}>
          {saving ? "Saving…" : editing ? "Save" : "Save and continue"}
        </Button>
      </DialogActions>
    </form>
  );
}
