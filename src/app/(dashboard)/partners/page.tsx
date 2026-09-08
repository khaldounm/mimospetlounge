import { liveSession } from "@/lib/session-user";
import { hasPermission } from "@/lib/permissions";
import { getPartnersWithStats } from "@/lib/partners";
import { rangeFromParams, resolvePreset } from "@/utils/date-range";
import { PARTNER_DEFAULT_PRESET_ID } from "@/constants/partner";
import PartnersTable from "@/components/partners/PartnersTable";

// Balances change as items sell and payouts are recorded; always render fresh.
export const dynamic = "force-dynamic";

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await liveSession();
  const canWrite = hasPermission(session?.user, "partners:write");

  // The range comes off the URL so a chosen period survives a reload and can be
  // linked to, falling back to the default when absent. The first paint is
  // seeded with it so no fetch is needed until the range is changed.
  const { from, to } = await searchParams;
  const range =
    rangeFromParams(from, to) ?? resolvePreset(PARTNER_DEFAULT_PRESET_ID)!;
  const partners = await getPartnersWithStats(range);

  return (
    <PartnersTable
      initialPartners={partners}
      initialRange={range}
      canWrite={canWrite}
    />
  );
}
