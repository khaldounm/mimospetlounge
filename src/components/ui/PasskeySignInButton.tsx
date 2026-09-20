"use client";

import { Box, Button, Typography } from "@mui/material";
import FingerprintRoundedIcon from "@mui/icons-material/FingerprintRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import { usePasskeySignIn, type PasskeyPhase } from "@/hooks/usePasskeys";

interface Props {
  onSignedIn: () => void;
}

// The button says what is happening instead of spinning. "Waiting" is the
// stretch where the browser's own prompt is up and the person is on their
// phone; the pulse under the label is the only motion on the page.
const LABELS: Record<PasskeyPhase, string> = {
  idle: "Sign in with passkey",
  waiting: "Waiting for your device...",
  verifying: "Checking...",
  done: "Signed in",
};

function Pulse() {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        bgcolor: "currentColor",
        animation: "passkeyPulse 1.2s ease-in-out infinite",
        "@keyframes passkeyPulse": {
          "0%, 100%": { opacity: 0.25 },
          "50%": { opacity: 1 },
        },
      }}
    />
  );
}

export default function PasskeySignInButton({ onSignedIn }: Props) {
  const { phase, error, signInWithPasskey } = usePasskeySignIn();

  async function handleClick() {
    if (await signInWithPasskey()) onSignedIn();
  }

  const icon =
    phase === "done" ? (
      <CheckRoundedIcon />
    ) : phase === "idle" ? (
      <FingerprintRoundedIcon />
    ) : (
      <Pulse />
    );

  return (
    <Box>
      <Button
        variant="contained"
        size="large"
        fullWidth
        onClick={handleClick}
        disabled={phase !== "idle"}
        startIcon={icon}
        sx={{
          height: 56,
          fontSize: 16,
          // Keep the label readable while the button is disabled mid-ceremony:
          // the default disabled grey reads as broken, not busy.
          "&.Mui-disabled": {
            bgcolor: "primary.main",
            color: "primary.contrastText",
            opacity: 0.85,
          },
        }}
      >
        {LABELS[phase]}
      </Button>
      {error && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
