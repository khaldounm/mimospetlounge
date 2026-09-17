import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handle, parseBody, requirePermission } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { costComponentInclude } from "@/lib/services";
import { serviceVisibility, toServiceDTO } from "@/lib/invoices";
import { writeAudit } from "@/lib/audit";
import {
  serviceUpdateSchema,
  toCostComponentRows,
  touchesPartnerDeal,
} from "@/schemas/service";

async function getServiceId(params: Promise<{ serviceId: string }>) {
  const { serviceId } = await params;
  const id = Number(serviceId);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid id");
  return id;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("invoices:read");
    const serviceId = await getServiceId(params);
    const visible = serviceVisibility(session.user);

    const service = await prisma.service.findUnique({
      where: { serviceId },
      include: {
        ...(visible.deal ? { partner: { select: { name: true } } } : {}),
        ...(visible.cost || visible.recipe
          ? { costComponents: costComponentInclude }
          : {}),
      },
    });
    if (!service) throw new ApiError(404, "Service not found");

    return NextResponse.json({ service: toServiceDTO(service, visible) });
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("invoices:write");
    const serviceId = await getServiceId(params);
    const visible = serviceVisibility(session.user);
    const data = await parseBody(request, serviceUpdateSchema);
    // See the POST handler: the deal is a partners:write term, not catalogue
    // upkeep, so reception editing a price cannot move a partner's cut.
    if (
      touchesPartnerDeal(data) &&
      !hasPermission(session.user, "partners:write")
    ) {
      throw new ApiError(403, "You cannot set the partner deal on a service");
    }
    // See the POST handler: cost is orders:*, not invoices:*.
    if (
      data.costComponents !== undefined &&
      !hasPermission(session.user, "orders:write")
    ) {
      throw new ApiError(403, "You cannot set the cost of a service");
    }

    const existing = await prisma.service.findUnique({ where: { serviceId } });
    if (!existing) throw new ApiError(404, "Service not found");

    const service = await prisma.service.update({
      where: { serviceId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.partnerId !== undefined ? { partnerId: data.partnerId } : {}),
        ...(data.partnerCostPct !== undefined
          ? { partnerCostPct: data.partnerCostPct }
          : {}),
        ...(data.partnerProfitPct !== undefined
          ? { partnerProfitPct: data.partnerProfitPct }
          : {}),
        // The recipe is replaced wholesale, never merged: the form edits the
        // whole list, so a row the user deleted has to disappear. Absent leaves
        // the existing components untouched, which is what lets a price edit
        // stay a price edit. Nested writes run inside the update's own
        // transaction, so a service is never briefly left with no cost.
        // Safe for a caller who cannot see cost too: they were sent every row
        // (unpriced), so what they send back is the whole list, not a subset.
        ...(data.costComponents
          ? {
              costComponents: {
                deleteMany: {},
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
      action: "update",
      entity: "service",
      entityId: serviceId,
      changes: data,
    });

    return NextResponse.json({ service: toServiceDTO(service, visible) });
  });
}

// Services are referenced by historical line items, so we deactivate rather than
// hard-delete. Past invoices keep their frozen labels; the service just stops
// appearing in the picker.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("invoices:write");
    const serviceId = await getServiceId(params);

    const existing = await prisma.service.findUnique({ where: { serviceId } });
    if (!existing) throw new ApiError(404, "Service not found");

    await prisma.service.update({
      where: { serviceId },
      data: { isActive: false },
    });

    await writeAudit(session, {
      action: "delete",
      entity: "service",
      entityId: serviceId,
      changes: { isActive: false },
    });

    return NextResponse.json({ ok: true });
  });
}
