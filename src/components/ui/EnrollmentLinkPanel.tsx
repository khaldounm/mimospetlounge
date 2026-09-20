"use client";

import { useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import { apiRequest } from "@/utils/api-client";
import { normalizePhone } from "@/utils/phone";
import { ENROLLMENT_LINK_TTL_MINUTES } from "@/constants/passkeys";
import type { UserDTO } from "@/types/entities";

interface Issued {
  url: string;
  expiresAt: string;
  sentTo: string | null;
}

interface Props {
  user: Pick<UserDTO, "userId" | "firstName" | "phone">;
  // Called once a link exists, so the surrounding list can refresh: issuing
  // wipes the person's passkeys and their row changes.
  onIssued?: () => void;
}

// The one control for handing someone a way in: two buttons that both mint a
// link, one delivers it by WhatsApp, the other hands it over to copy. After
// either, the link is on screen with its two facts (once, minutes). Pressing
// again mints a fresh link and the previous one dies, which the panel says.
export default function EnrollmentLinkPanel({ user, onIssued }: Props) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState<"whatsapp" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const phone = normalizePhone(user.phone);

  async function issue(channel: "whatsapp" | "link") {
    setBusy(channel);
    setError(null);
    setCopied(false);
    try {
      const result = await apiRequest<Issued>(
        `/api/users/${user.userId}/enroll`,
        { method: "POST", body: { channel } },
      );
      setIssued(result);
      onIssued?.();
      if (channel === "link") await copy(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a link");
    } finally {
      setBusy(null);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the link is on screen to select.
    }
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        <Tooltip
          title={
            phone
              ? `Sends to ${phone}`
              : "No valid phone number on file. Add one under Edit."
          }
        >
          <span>
            <Button
              variant="contained"
              startIcon={<WhatsAppIcon />}
              disabled={!phone || busy !== null}
              onClick={() => void issue("whatsapp")}
            >
              {busy === "whatsapp"
                ? "Sending..."
                : issued?.sentTo
                  ? "Send again"
                  : "Send via WhatsApp"}
            </Button>
          </span>
        </Tooltip>
        <Button
          variant="outlined"
          startIcon={<ContentCopyRoundedIcon />}
          disabled={busy !== null}
          onClick={() => void issue("link")}
        >
          {busy === "link" ? "Creating..." : "Copy link"}
        </Button>
      </Stack>

      {error && (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      )}

      {issued && (
        <Box>
          {issued.sentTo && (
            <Typography
              variant="body2"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                color: "success.main",
                mb: 1,
              }}
            >
              <CheckRoundedIcon fontSize="small" /> Sent to {issued.sentTo}
            </Typography>
          )}
          <TextField
            value={issued.url}
            size="small"
            fullWidth
            slotProps={{
              input: {
                readOnly: true,
                endAdornment: (
                  <Tooltip title={copied ? "Copied" : "Copy"}>
                    <IconButton
                      size="small"
                      onClick={() => void copy(issued.url)}
                      aria-label="Copy link"
                    >
                      {copied ? (
                        <CheckRoundedIcon fontSize="small" />
                      ) : (
                        <ContentCopyRoundedIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Tooltip>
                ),
              },
            }}
            onFocus={(e) => e.target.select()}
          />
          <Typography variant="caption" color="text.secondary">
            Works once, on {user.firstName}&apos;s phone, for{" "}
            {ENROLLMENT_LINK_TTL_MINUTES} minutes. Sending or copying again
            replaces this link.
          </Typography>
        </Box>
      )}
    </Stack>
  );
}
