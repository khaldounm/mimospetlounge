"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  Box,
  Button,
  Collapse,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useColorMode } from "@/components/ui/ThemeRegistry";
import PasskeySignInButton from "@/components/ui/PasskeySignInButton";
import { usePasskeySupport } from "@/hooks/usePasskeys";
import { CLINIC } from "@/constants/clinic";

const LOGO_HEIGHT = { xs: 56, sm: 72 };

// The sign-in screen. One column on the page ground, no card: the logo, a
// caramel rule, a headline and one action. Passkeys lead; the password form
// sits folded under a text link for anyone who has not moved yet, and opens
// by itself in a browser that cannot do passkeys.
export default function LoginCard() {
  const { mode } = useColorMode();
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
  const passwordOpen = passkeys === false || showPassword;

  return (
    <Stack
      spacing={4}
      sx={{
        width: "100%",
        maxWidth: 420,
        animation: "loginFadeUp 220ms ease-out",
        "@keyframes loginFadeUp": {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "none" },
        },
      }}
    >
      <Stack spacing={3}>
        <Box
          component="img"
          src={mode === "dark" ? CLINIC.logos.onDark : CLINIC.logos.onLight}
          alt={CLINIC.name}
          sx={{
            height: LOGO_HEIGHT,
            width: "auto",
            maxWidth: "100%",
            objectFit: "contain",
            objectPosition: "left",
            display: "block",
          }}
        />
        <Box sx={{ width: 40, height: 2, bgcolor: "secondary.main" }} />
        <Box>
          <Typography variant="h2" component="h1">
            Welcome back
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Sign in to {CLINIC.name}
          </Typography>
        </Box>
      </Stack>

      <Stack spacing={2}>
        {passkeys && <PasskeySignInButton onSignedIn={enter} />}

        {passkeys && (
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

      <Typography variant="caption" color="text.secondary">
        {CLINIC.name}
      </Typography>
    </Stack>
  );
}
