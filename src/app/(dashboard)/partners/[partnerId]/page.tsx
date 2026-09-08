import { notFound } from "next/navigation";
import { liveSession } from "@/lib/session-user";
import { hasPermission } from "@/lib/permissions";
import { getPartnerHeader } from "@/lib/partners";
import { rangeFromParams, resolvePreset } from "@/utils/date-range";
import { PARTNER_DEFAULT_PRESET_ID } from "@/constants/partner";
import PartnerDetail from "@/components/partners/PartnerDetail";

export const dynamic = "force-dynamic";

export default async function PartnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ partnerId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { partnerId } = await params;
  const id = Number(partnerId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const session = await liveSession();
  const canWrite = hasPermission(session?.user, "partners:write");

  // Carried in from the list's link so clicking a partner keeps the period the
  // figures were being read at, rather than resetting to the default and showing
  // a different one under the same heading.
  const { from, to } = await searchParams;
  const range =
    rangeFromParams(from, to) ?? resolvePreset(PARTNER_DEFAULT_PRESET_ID)!;
  // Header figures only. The sales, payout and item ledgers each fetch their
  // own first page when their section is opened.
  const header = await getPartnerHeader(id, range);
  if (!header) notFound();

  return (
    <PartnerDetail
      partner={header.partner}
      initialRange={range}
      canWrite={canWrite}
    />
  );
}
