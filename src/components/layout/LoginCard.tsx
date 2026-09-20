"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button, Collapse, Stack, TextField, Typography } from "@mui/material";
import AuthFrame from "@/components/layout/AuthFrame";
import PasskeySignInButton from "@/components/ui/PasskeySignInButton";
import { usePasskeySupport } from "@/hooks/usePasskeys";
import { CLINIC } from "@/constants/clinic";
import { PASSKEY_ONLY } from "@/constants/passkeys";

// The sign-in screen: one action. Passkeys lead; at a clinic that keeps
// passwords on, the password form sits folded under a text link for anyone
// who has not moved yet, and opens by itself in a browser that cannot do
// passkeys. At a passkey-only clinic there is no second door to show, and a
// browser without passkeys is told to use one that has them.
export default function LoginCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const passkeys = usePasskeySupport();

  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function enter() {
    router.push(callbackUrl);
    router.refresh();
  }

  async function handlePassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("That email and password do not match.");
      setSubmitting(false);
      return;
    }
    enter();
  }

  // Until the browser has answered, nothing is offered: a button that appears
  // and then vanishes is worse than a beat of empty space.
  const passwords = !PASSKEY_ONLY;
  const passwordOpen = passwords && (passkeys === false || showPassword);

  return (
    <AuthFrame title="Welcome back" subtitle={`Sign in to ${CLINIC.name}`}>
      <Stack spacing={2}>
        {passkeys && <PasskeySignInButton onSignedIn={enter} />}

        {passkeys === false && !passwords && (
          <Typography color="text.secondary">
            This browser cannot use passkeys. Open the app in Chrome, Safari or
            Edge, or on your phone.
          </Typography>
        )}

        {passkeys && passwords && (
          <Button
            variant="text"
            size="small"
            onClick={() => setShowPassword((v) => !v)}
            // No side padding, so the text sits on the column edge with
            // everything else. A negative margin would not do it: the Stack's
            // child reset (margin: 0) outranks a class on the button.
            sx={{ alignSelf: "flex-start", px: 0, color: "text.secondary" }}
          >
            {showPassword ? "Hide password sign-in" : "Use password instead"}
          </Button>
        )}

        <Collapse in={passwordOpen} unmountOnExit>
          <Stack component="form" spacing={2} onSubmit={handlePassword}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              fullWidth
            />
            {error && (
              <Typography variant="body2" color="error">
                {error}
              </Typography>
            )}
            <Button
              type="submit"
              variant={passkeys ? "outlined" : "contained"}
              size="large"
              disabled={submitting}
              sx={{ height: 48 }}
            >
              {submitting ? "Signing in..." : "Sign in with password"}
            </Button>
          </Stack>
        </Collapse>
      </Stack>
    </AuthFrame>
  );
}
