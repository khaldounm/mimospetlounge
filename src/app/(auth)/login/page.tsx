"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
// import Link from "next/link";
import { signIn } from "next-auth/react";
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useColorMode } from "@/components/ui/ThemeRegistry";
import { CLINIC } from "@/constants/clinic";

const LOGIN_LOGO_HEIGHT = 72;

function LoginForm() {
  const { mode } = useColorMode();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password.");
      setSubmitting(false);
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <Paper elevation={3} sx={{ p: 4, width: "100%", maxWidth: 400 }}>
      <Stack component="form" spacing={3} onSubmit={handleSubmit}>
        <Box sx={{ textAlign: "center" }}>
          <Box
            component="img"
            src={mode === "dark" ? CLINIC.logos.onDark : CLINIC.logos.onLight}
            alt={CLINIC.name}
            sx={{
              height: LOGIN_LOGO_HEIGHT,
              width: "auto",
              maxWidth: "100%",
              objectFit: "contain",
              display: "block",
              mx: "auto",
              mb: 2,
            }}
          />
          <Typography color="text.secondary">Sign in to continue</Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}

        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
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

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={submitting}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </Button>

        {/* <Typography variant="body2" align="center">
          <Link href="/reset-password">Forgot your password?</Link>
        </Typography> */}
      </Stack>
    </Paper>
  );
}

export default function LoginPage() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 2,
      }}
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </Box>
  );
}
