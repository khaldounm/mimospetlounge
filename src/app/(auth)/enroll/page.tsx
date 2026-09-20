import Box from "@mui/material/Box";
import { lookupEnrollment } from "@/lib/enrollment";
import EnrollCard from "@/components/layout/EnrollCard";

// Where an enrollment link lands. The token is checked here, on the server,
// so the page can greet the right person or say the link is dead before any
// ceremony starts. It is checked again by both /api/enroll routes; this
// lookup only decides what to show.
export const dynamic = "force-dynamic";

export default async function EnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const holder = t ? await lookupEnrollment(t) : null;

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
      {holder && t ? (
        <EnrollCard token={t} firstName={holder.firstName} />
      ) : (
        <EnrollCard />
      )}
    </Box>
  );
}
