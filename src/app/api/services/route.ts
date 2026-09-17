import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handle, parseBody, requirePermission } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { costComponentInclude } from "@/lib/services";
import { serviceVisibility, toServiceDTO } from "@/lib/invoices";
import { writeAudit } from "@/lib/audit";
import {
  serviceCreateSchema,
  toCostComponentRows,
  touchesPartnerDeal,
} from "@/schemas/service";

export async function GET(request: Request) {
  return handle(async () => {
    const session = await requirePermission("invoices:read");
    const visible = serviceVisibility(session.user);

    const sp = new URL(request.url).searchParams;
    const q = sp.get("q")?.trim();
    const activeOnly = sp.get("activeOnly") === "true";

    const services = await prisma.service.findMany({
      where: {
        ...(activeOnly ? { isActive: true } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { category: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
      // Each join is skipped entirely for a caller who would only have the
      // result stripped back out again.
      include: {
        ...(visible.deal ? { partner: { select: { name: true } } } : {}),
        ...(visible.cost || visible.recipe
          ? { costComponents: costComponentInclude }
          : {}),
      },
    });

    return NextResponse.json({
      services: services.map((s) => toServiceDTO(s, visible)),
    });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requirePermission("invoices:write");
    const visible = serviceVisibility(session.user);
    const data = await parseBody(request, serviceCreateSchema);
    // Who takes a cut, and how much, is a commercial term rather than catalogue
    // upkeep. Reception and vets maintain services; only a partners:write
    // holder sets the deal on one. Rejected rather than silently dropped, so a
    // caller is never told a deal saved when it did not.
    if (
      touchesPartnerDeal(data) &&
      !hasPermission(session.user, "partners:write")
    ) {
      throw new ApiError(403, "You cannot set the partner deal on a service");
    }
    // What a service costs is purchasing knowledge, gated the way every other
    // cost figure in this app is: orders:*, deliberately separate from
    // inventory:* so clinical staff never see what the clinic pays.
    if (
      data.costComponents !== undefined &&
      !hasPermission(session.user, "orders:write")
    ) {
      throw new ApiError(403, "You cannot set the cost of a service");
    }

    const service = await prisma.service.create({
      data: {
        name: data.name,
        category: data.category,
        price: data.price,
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        description: data.description,
        partnerId: data.partnerId,
        partnerCostPct: data.partnerCostPct,
        partnerProfitPct: data.partnerProfitPct,
        ...(data.costComponents
          ? {
              costComponents: {
                create: toCostComponentRows(data.costComponents),
              },
            }
          : {}),
      },
      include: {
        partner: { select: { name: true } },
        costComponents: costComponentInclude,
      },
    });

    await writeAudit(session, {
      action: "create",
      entity: "service",
      entityId: service.serviceId,
      changes: data,
    });

    return NextResponse.json(
      { service: toServiceDTO(service, visible) },
      { status: 201 },
    );
  });
}
