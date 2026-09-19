import { NextResponse } from "next/server";
import { ApiError, handle, requirePermission } from "@/lib/api";
import { getCategoryTopLines } from "@/lib/analytics";
import { categoryTopQuerySchema } from "@/schemas/analytics";
import type { CategoryGroupKey } from "@/constants/analytics";

// The lines behind one row of the category table, fetched when that row is
// opened and not before. Billed figures only, the same as the table, so it
// needs nothing beyond analytics:read: no cost, no margin, no client.
export async function GET(request: Request) {
  return handle(async () => {
    await requirePermission("analytics:read");

    const search = new URL(request.url).searchParams;
    const parsed = categoryTopQuerySchema.safeParse({
      group: search.get("group"),
      category: search.get("category"),
      mode: search.get("mode"),
      from: search.get("from"),
      to: search.get("to"),
    });
    if (!parsed.success) {
      throw new ApiError(
        400,
        parsed.error.issues[0]?.message ?? "Invalid query",
      );
    }

    const { group, category, mode, from, to } = parsed.data;
    const data = await getCategoryTopLines(
      group as CategoryGroupKey,
      category,
      { from, to },
      mode,
    );
    return NextResponse.json({ range: { from, to }, data });
  });
}
