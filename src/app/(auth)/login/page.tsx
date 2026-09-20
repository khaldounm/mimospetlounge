import { Suspense } from "react";
import Box from "@mui/material/Box";
import LoginCard from "@/components/layout/LoginCard";

export default function LoginPage() {
  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
        py: 6,
      }}
    >
      {/* LoginCard reads the callbackUrl from useSearchParams, which needs a
          Suspense boundary above it or the whole route de-opts to client
          rendering. */}
      <Suspense fallback={null}>
        <LoginCard />
      </Suspense>
    </Box>
  );
}
