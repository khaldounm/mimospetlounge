import { NextResponse } from "next/server";
import { ApiError, handle, requirePermission } from "@/lib/api";
import { canSeeCost, hasPermission } from "@/lib/permissions";
import { getAnalyticsSection, getInventorySnapshot } from "@/lib/analytics";
import { analyticsPanelQuerySchema } from "@/schemas/analytics";
import type { ClientsAnalytics } from "@/types/entities";

// Serves one analytics section. The dashboard calls this the first time a
// section is expanded, and again whenever the user changes its date range.
//
// Nothing is computed until a section is opened: the page used to run every
// section at first paint to fill seven accordions that were all closed.
export async function GET(request: Request) {
  return handle(async () => {
    const session = await requirePermission("analytics:read");

    const params = new URL(request.url).searchParams;
    const from = params.get("from");
    const to = params.get("to");
    const parsed = analyticsPanelQuerySchema.safeParse({
      section: params.get("section"),
      // Left out entirely when absent, so a snapshot request matches the
      // branch that takes no range.
      ...(from !== null ? { from } : {}),
      ...(to !== null ? { to } : {}),
    });
    if (!parsed.success) {
      throw new ApiError(
        400,
        parsed.error.issues[0]?.message ?? "Invalid query",
      );
    }
    const query = parsed.data;

    // Net profit folds in running costs, which are gated by costs:read.
    if (
      query.section === "profit" &&
      !hasPermission(session.user, "costs:read")
    ) {
      throw new ApiError(403, "Forbidden");
    }
    // Purchases exposes what the clinic pays suppliers, so it follows the
    // purchasing permission rather than analytics:read alone.
    if (
      query.section === "purchases" &&
      !hasPermission(session.user, "orders:read")
    ) {
      throw new ApiError(403, "Forbidden");
    }

    // The absence of a range is what tells the two apart, and it is also how
    // the parse discriminated them.
    if (!("from" in query)) {
      const data = await getInventorySnapshot();
      // The shelf breakdown prices the stock both ways and names the margin
      // between them, which discloses exactly what an item's lastCost does. So
      // it takes the one cost gate the rest of the app uses. Stripped here
      // rather than in the component, so what may not be shown is never sent to
      // the browser. The headline stockValuation is left as it always was.
      if (!canSeeCost(session.user)) {
        return NextResponse.json({
          section: query.section,
          data: {
            ...data,
            consignedCost: null,
            clinicProfit: null,
            partnerShare: null,
            partnerShareCostPart: null,
            retailValue: null,
            itemsMissingCost: null,
            itemsMissingPrice: null,
          },
        });
      }
      return NextResponse.json({ section: query.section, data });
    }

    const range = { from: query.from, to: query.to };
    const data = await getAnalyticsSection(query.section, range);

    // The clients section counts anyone, but its two lists name them and carry
    // their phone number, email and balance. Those are client records, so they
    // follow the permission client records follow everywhere else. The counts
    // are aggregates and stay: they are the same figures this section has always
    // shown. Stripped here rather than in the component, so nothing that is not
    // allowed on the screen is sent to the browser in the first place.
    if (
      query.section === "clients" &&
      !hasPermission(session.user, "patients:read")
    ) {
      const clients = data as ClientsAnalytics;
      return NextResponse.json({
        section: query.section,
        range,
        data: { ...clients, topClients: null, lapsedClients: null },
      });
    }

    return NextResponse.json({ section: query.section, range, data });
  });
}
