import { NextResponse } from "next/server";
import { ApiError, handle, parseId, requirePermission } from "@/lib/api";
import { getPartnerItems } from "@/lib/partners";
import { partnerPagedQuerySchema } from "@/schemas/partner";

// One page of a partner's item performance over the selected range. Its own
// endpoint because the section it fills is collapsed until someone opens it,
// and because every item the partner sources is listed whether it sold or not,
// which is far and away the heaviest table on the page.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ partnerId: string }> },
) {
  return handle(async () => {
    await requirePermission("partners:read");
    const partnerId = parseId((await params).partnerId, "partner id");

    const sp = new URL(request.url).searchParams;
    const parsed = partnerPagedQuerySchema.safeParse({
      from: sp.get("from"),
      to: sp.get("to"),
      page: sp.get("page") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0].message);
    }
    const { from, to, page } = parsed.data;

    return NextResponse.json(
      await getPartnerItems(partnerId, { from, to }, page),
    );
  });
}
