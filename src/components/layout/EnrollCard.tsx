"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Button, Stack, Typography } from "@mui/material";
import FingerprintRoundedIcon from "@mui/icons-material/FingerprintRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import AuthFrame from "@/components/layout/AuthFrame";
import { usePasskeyEnrollment, usePasskeySignIn } from "@/hooks/usePasskeys";
import { CLINIC } from "@/constants/clinic";

type Props =
  | { token: string; firstName: string }
  | { token?: undefined; firstName?: undefined };

// What an enrollment link opens onto. One button: it registers the passkey
// and then, without a second click, signs the person in with it. If the
// second ceremony is cancelled the passkey is still saved and the button
// becomes "Sign in" instead of asking them to do it all again.
export default function EnrollCard(props: Props) {
  const router = useRouter();

  if (props.token === undefined) {
    return (
      <AuthFrame
        title="This link has expired"
        subtitle="Or it was already used. Links work once and for a short time."
      >
        <Stack spacing={2}>
          <Typography color="text.secondary">
            Ask an admin at {CLINIC.name} for a new one. It arrives on WhatsApp.
          </Typography>
          <Button
            variant="outlined"
            size="large"
            onClick={() => router.push("/login")}
            sx={{ alignSelf: "flex-start" }}
          >
            Go to sign in
          </Button>
        </Stack>
      </AuthFrame>
    );
  }

  return <Enroll token={props.token} firstName={props.firstName} />;
}

function Enroll({ token, firstName }: { token: string; firstName: string }) {
  const router = useRouter();
  const { phase, error, enroll } = usePasskeyEnrollment(token);
  const signIn = usePasskeySignIn();
  const [saved, setSaved] = useState(false);

  async function handleClick() {
    if (saved) {
      if (await signIn.signInWithPasskey()) router.push("/");
      return;
    }
    const passkey = await enroll();
    if (!passkey) return;
    setSaved(true);
    if (await signIn.signInWithPasskey()) router.push("/");
  }

  const signingIn = signIn.phase !== "idle";
  const busy = phase !== "idle" || signingIn;
  const label = saved
    ? signIn.phase === "done"
      ? "Signed in"
      : signingIn
        ? "Signing you in..."
        : "Sign in"
    : phase === "waiting"
      ? "Waiting for your device..."
      : phase === "verifying"
        ? "Saving..."
        : "Set up my passkey";

  return (
    <AuthFrame
      title={`Hi ${firstName}`}
      subtitle={`Set up your passkey for ${CLINIC.name}`}
    >
      <Stack spacing={2}>
        <Typography color="text.secondary">
          {saved
            ? "Your passkey is saved. Sign in with it to finish."
            : "One tap, then confirm with Face ID or your fingerprint. From then on that is how you sign in: nothing to type, nothing to remember."}
        </Typography>
        <Box>
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={() => void handleClick()}
            disabled={busy}
            startIcon={
              signIn.phase === "done" ? (
                <CheckRoundedIcon />
              ) : (
                <FingerprintRoundedIcon />
              )
            }
            sx={{
              height: 56,
              fontSize: 16,
              "&.Mui-disabled": {
                bgcolor: "primary.main",
                color: "primary.contrastText",
                opacity: 0.85,
              },
            }}
          >
            {label}
          </Button>
          {(error ?? signIn.error) && (
            <Typography variant="body2" color="error" sx={{ mt: 1 }}>
              {error ?? signIn.error}
            </Typography>
          )}
        </Box>
      </Stack>
    </AuthFrame>
  );
}
