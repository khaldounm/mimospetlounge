"use client";

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import EnrollmentLinkPanel from "@/components/ui/EnrollmentLinkPanel";
import type { UserDTO } from "@/types/entities";

interface Props {
  open: boolean;
  user: UserDTO | null;
  isSelf: boolean;
  onClose: () => void;
  // Fires as soon as a link is issued, not on close: the row has already
  // changed by then (passkeys gone, sessions ended).
  onIssued: () => void;
}

// The answer to every phone problem: lost, stolen, replaced, or a new person.
// Pressing either button in the panel wipes the passkeys, ends the sessions
// and mints the link, so the explanation has to be read before the press,
// which is why it sits above the buttons rather than behind a confirm.
export default function ResetAccessDialog({
  open,
  user,
  isSelf,
  onClose,
  onIssued,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {user && (
        <>
          <DialogTitle>Reset access for {user.firstName}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography color="text.secondary">
                This removes every passkey {user.firstName} has, signs them out
                of every device, and creates a one-time link to set up a new
                passkey. Send it to their WhatsApp, or copy it and pass it on.
              </Typography>
              {isSelf && (
                <Alert severity="warning">
                  This is your own account. It signs you out here too, so send
                  or copy the link before you close this.
                </Alert>
              )}
              <EnrollmentLinkPanel
                key={user.userId}
                user={user}
                onIssued={onIssued}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Close</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
