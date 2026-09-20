"use client";

import { Box, Stack, Typography } from "@mui/material";
import { useColorMode } from "@/components/ui/ThemeRegistry";
import { CLINIC } from "@/constants/clinic";

const LOGO_HEIGHT = { xs: 56, sm: 72 };

interface Props {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

// The frame every signed-out screen shares: the clinic's logo, a caramel
// rule, a headline and a line under it, then whatever the screen is for, and
// the clinic's name at the foot. One column on the page ground, no card.
export default function AuthFrame({ title, subtitle, children }: Props) {
  const { mode } = useColorMode();

  return (
    <Stack
      spacing={4}
      sx={{
        width: "100%",
        maxWidth: 420,
        animation: "authFadeUp 220ms ease-out",
        "@keyframes authFadeUp": {
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
            {title}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        </Box>
      </Stack>

      {children}

      <Typography variant="caption" color="text.secondary">
        {CLINIC.name}
      </Typography>
    </Stack>
  );
}
