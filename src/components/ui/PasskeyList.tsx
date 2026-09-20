"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Button, Divider, Paper, Stack, Typography } from "@mui/material";
import KeyRoundedIcon from "@mui/icons-material/KeyRounded";
import PhoneIphoneRoundedIcon from "@mui/icons-material/PhoneIphoneRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import { forgetPasskey, usePasskeyRegistration } from "@/hooks/usePasskeys";
import { apiRequest } from "@/utils/api-client";
import { formatDate } from "@/utils/format";
import type { PasskeyDTO } from "@/types/passkeys";

interface Props {
  initial: PasskeyDTO[];
  // Whether this account still has a password. Without one, the last passkey
  // cannot be removed, and the row says so rather than letting the request
  // fail.
  hasPassword: boolean;
}

// One passkey: what holds it, when it was added, when it last signed in, and a
// two-tap remove. The confirmation is inline rather than a dialog: it is a
// small, reversible-by-re-adding action and a modal would make more of it.
function PasskeyRow({
  passkey,
  removable,
  onRemoved,
}: {
  passkey: PasskeyDTO;
  removable: boolean;
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      await apiRequest(`/api/account/passkeys/${passkey.id}`, {
        method: "DELETE",
      });
      // If this device is the one holding it, it stops offering it now
      // rather than at the next failed sign-in.
      forgetPasskey(passkey.id);
      onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove it");
      setRemoving(false);
      setConfirming(false);
    }
  }

  const Icon = passkey.backedUp ? PhoneIphoneRoundedIcon : KeyRoundedIcon;
  const used = passkey.lastUsedAt
    ? `last used ${formatDate(passkey.lastUsedAt)}`
    : "not used yet";

  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center", py: 1.5 }}>
      <Icon sx={{ color: "text.secondary" }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600 }}>{passkey.label}</Typography>
        <Typography variant="body2" color="text.secondary">
          Added {formatDate(passkey.createdAt)}, {used}
        </Typography>
        {error && (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        )}
      </Box>
      {confirming ? (
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => setConfirming(false)}>
            Keep
          </Button>
          <Button
            size="small"
            color="error"
            variant="outlined"
            onClick={remove}
            disabled={removing}
          >
            Remove
          </Button>
        </Stack>
      ) : (
        <Button
          size="small"
          onClick={() => setConfirming(true)}
          disabled={!removable}
          title={
            removable ? undefined : "Add another passkey before removing this"
          }
        >
          Remove
        </Button>
      )}
    </Stack>
  );
}

export default function PasskeyList({ initial, hasPassword }: Props) {
  const router = useRouter();
  const [passkeys, setPasskeys] = useState(initial);
  const { phase, error, register } = usePasskeyRegistration();

  async function add() {
    const created = await register();
    if (!created) return;
    setPasskeys((list) => [...list, created]);
    router.refresh();
  }

  function removed(id: string) {
    setPasskeys((list) => list.filter((p) => p.id !== id));
    router.refresh();
  }

  const lastOne = passkeys.length === 1 && !hasPassword;

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 480 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6">Passkeys</Typography>
          <Typography variant="body2" color="text.secondary">
            Sign in with Face ID, your fingerprint or your phone instead of
            typing a password. Each device you add is its own passkey.
          </Typography>
        </Box>

        {passkeys.length > 0 ? (
          <Stack divider={<Divider />}>
            {passkeys.map((p) => (
              <PasskeyRow
                key={p.id}
                passkey={p}
                removable={!lastOne}
                onRemoved={() => removed(p.id)}
              />
            ))}
          </Stack>
        ) : (
          <Typography color="text.secondary">No passkeys yet.</Typography>
        )}

        <Box>
          <Button
            variant="outlined"
            startIcon={<AddRoundedIcon />}
            onClick={add}
            disabled={phase !== "idle"}
          >
            {phase === "waiting"
              ? "Waiting for your device..."
              : phase === "verifying"
                ? "Saving..."
                : "Add a passkey"}
          </Button>
          {error && (
            <Typography variant="body2" color="error" sx={{ mt: 1 }}>
              {error}
            </Typography>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}
