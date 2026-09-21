import { NextResponse } from "next/server";
import { ApiError, handle, requirePermission } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { getSupplierItemLines } from "@/lib/analytics";
import { supplierItemsQuerySchema } from "@/schemas/analytics";

// One supplier's best or slowest selling products, fetched when that list is
// opened and not before. It names a supplier and what sold of its products,
// which is the purchases section's business, so it takes the same pair of
// permissions the section does: analytics:read to be here at all, orders:read
// to see suppliers. Billed figures only: no cost, no margin, no client.
export async function GET(request: Request) {
  return handle(async () => {
    const session = await requirePermission("analytics:read");
    if (!hasPermission(session.user, "orders:read")) {
      throw new ApiError(403, "Forbidden");
    }

    const search = new URL(request.url).searchParams;
    const parsed = supplierItemsQuerySchema.safeParse({
      supplierId: search.get("supplierId"),
      order: search.get("order"),
      from: search.get("from"),
      to: search.get("to"),
    });
    if (!parsed.success) {
      throw new ApiError(
        400,
        parsed.error.issues[0]?.message ?? "Invalid query",
      );
    }

    const { supplierId, order, from, to } = parsed.data;
    const data = await getSupplierItemLines(supplierId, order, { from, to });
    return NextResponse.json({ range: { from, to }, data });
  });
}
